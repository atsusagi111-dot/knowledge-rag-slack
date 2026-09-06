/**
 * 取り込み本体。
 *   npm run ingest              → DOCS_DIR 配下を全件処理（未変更はスキップ）
 *   npm run ingest -- --force   → ハッシュが同じでも入れ直す
 *   npm run ingest -- --dry-run → DB・OpenAI を呼ばず、抽出とチャンク数だけ表示
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { config } from "../config.js";
import { ingestSql, closeAll, toVectorLiteral } from "../db/client.js";
import { LocalFolderSource } from "../sources/LocalFolderSource.js";
import type { DocumentSource, SourceFile } from "../sources/DocumentSource.js";
import { extractText } from "./extract.js";
import { extractMetadata } from "./metadata.js";
import { chunkPages } from "./chunk.js";
import { defaultEmbeddingClient, type EmbeddingClient } from "./embed.js";

export interface IngestOptions {
  force?: boolean;
  dryRun?: boolean;
  /** 取り込み元に存在しなくなった文書を DB から削除する（機密扱い変更・退役時の同期） */
  prune?: boolean;
}

export interface IngestSummary {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  chunks: number;
  /** --prune で削除した文書数 */
  pruned: number;
}

export async function ingest(
  source: DocumentSource,
  opts: IngestOptions = {},
  embedder: EmbeddingClient = opts.dryRun ? (null as unknown as EmbeddingClient) : defaultEmbeddingClient(),
): Promise<IngestSummary> {
  const summary: IngestSummary = { inserted: 0, updated: 0, skipped: 0, failed: 0, chunks: 0, pruned: 0 };
  const sql = opts.dryRun ? null : ingestSql();

  const seen = new Set<string>();
  for await (const file of source.list()) {
    seen.add(file.path);
    try {
      const result = await ingestOne(source, file, opts, embedder, sql);
      summary[result.status]++;
      summary.chunks += result.chunks;
      console.log(`${result.status.padEnd(8)} ${file.path}  (${result.department ?? "部署不明"}, ${result.chunks} chunks)`);
    } catch (e) {
      summary.failed++;
      console.error(`failed   ${file.path}: ${(e as Error).message}`);
    }
  }

  if (opts.prune && sql) {
    // 取り込み元から消えた文書を DB からも削除する（chunks は on delete cascade で一緒に消える）。
    // 機密扱いの変更（他部署に見せない・退役）は「元ファイルを消す/移す → --prune」で DB に反映される
    const existing = await sql<{ id: string; source_path: string; department_id: string }[]>`
      select id, source_path, department_id from documents where source_type = ${source.type}`;
    for (const d of existing) {
      if (seen.has(d.source_path)) continue;
      await sql`delete from documents where id = ${d.id}`;
      summary.pruned++;
      console.log(`pruned   ${d.source_path}  (${d.department_id})`);
    }
  }
  return summary;
}

async function ingestOne(
  source: DocumentSource,
  file: SourceFile,
  opts: IngestOptions,
  embedder: EmbeddingClient,
  sql: ReturnType<typeof ingestSql> | null,
): Promise<{ status: "inserted" | "updated" | "skipped"; chunks: number; department: string | null }> {
  const buffer = await source.read(file);
  const extracted = await extractText(buffer, file.fileType);
  if (extracted.fullText.length < 20) throw new Error("テキストがほとんど抽出できませんでした（画像 PDF の可能性）");

  const meta = extractMetadata(extracted.fullText, file.name, file.departmentHint);
  if (!meta.departmentId) {
    throw new Error("部署を特定できません。冒頭に「部署: 戦略」の行を入れるか、部署名フォルダに置いてください");
  }
  const hash = createHash("sha256").update(extracted.fullText).digest("hex");
  const chunks = chunkPages(extracted.pages, config.chunk, meta.title);

  if (opts.dryRun || !sql) {
    return { status: "skipped", chunks: chunks.length, department: meta.departmentId };
  }

  const existing = await sql<{ id: string; content_hash: string }[]>`
    select id, content_hash from documents
    where source_type = ${source.type} and source_path = ${file.path}`;
  if (existing[0] && existing[0].content_hash === hash && !opts.force) {
    return { status: "skipped", chunks: 0, department: meta.departmentId };
  }

  const embeddings = await embedder.embed(chunks.map((c) => c.content));

  await sql.begin(async (tx) => {
    // department_locked（管理者が手で部署を変えた文書）は、取り込みで部署を上書きしない
    const [doc] = await tx<{ id: string; department_id: string }[]>`
      insert into documents (source_type, source_path, content_hash, title, department_id, doc_type,
                             client_name, created_year, file_type, page_count)
      values (${source.type}, ${file.path}, ${hash}, ${meta.title}, ${meta.departmentId!}, ${meta.docType},
              ${meta.clientName}, ${meta.createdYear}, ${file.fileType}, ${extracted.pages.length})
      on conflict (source_type, source_path) do update set
        content_hash = excluded.content_hash, title = excluded.title,
        department_id = case when documents.department_locked then documents.department_id else excluded.department_id end,
        doc_type = excluded.doc_type, client_name = excluded.client_name, created_year = excluded.created_year,
        file_type = excluded.file_type, page_count = excluded.page_count, ingested_at = now()
      returning id, department_id`;
    // 古いチャンクを消して入れ直す（差し替えはほぼ無い前提なので単純に）
    await tx`delete from chunks where document_id = ${doc.id}`;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      await tx`
        insert into chunks (document_id, department_id, chunk_index, section_title, page_start, page_end,
                            content, token_count, embedding)
        values (${doc.id}, ${doc.department_id}, ${c.index}, ${c.sectionTitle}, ${c.pageStart}, ${c.pageEnd},
                ${c.content}, ${c.tokenCount}, ${toVectorLiteral(embeddings[i])}::vector)`;
    }
  });

  return { status: existing[0] ? "updated" : "inserted", chunks: chunks.length, department: meta.departmentId };
}

/** CLI から呼ぶ入口（src/cli/ingest.ts が使う） */
export async function runIngestCli(argv: string[]): Promise<void> {
  const opts: IngestOptions = {
    force: argv.includes("--force"),
    dryRun: argv.includes("--dry-run"),
    prune: argv.includes("--prune"),
  };
  const dir = argv.find((a) => !a.startsWith("--")) ?? config.docsDir;
  console.log(`取り込み元: ${path.resolve(dir)}  ${opts.dryRun ? "(dry-run)" : ""}${opts.force ? "(force)" : ""}${opts.prune ? "(prune)" : ""}`);
  try {
    const s = await ingest(new LocalFolderSource(dir), opts);
    console.log(`\n結果: 新規 ${s.inserted} / 更新 ${s.updated} / スキップ ${s.skipped} / 失敗 ${s.failed} / 削除 ${s.pruned} / チャンク ${s.chunks}`);
    if (s.failed > 0) process.exitCode = 1;
  } finally {
    await closeAll();
  }
}
