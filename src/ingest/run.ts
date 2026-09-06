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
}

export interface IngestSummary {
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  chunks: number;
}

export async function ingest(
  source: DocumentSource,
  opts: IngestOptions = {},
  embedder: EmbeddingClient = opts.dryRun ? (null as unknown as EmbeddingClient) : defaultEmbeddingClient(),
): Promise<IngestSummary> {
  const summary: IngestSummary = { inserted: 0, updated: 0, skipped: 0, failed: 0, chunks: 0 };
  const sql = opts.dryRun ? null : ingestSql();

  for await (const file of source.list()) {
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
  const chunks = chunkPages(extracted.pages);

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
    const [doc] = await tx<{ id: string }[]>`
      insert into documents (source_type, source_path, content_hash, title, department_id, doc_type,
                             client_name, created_year, file_type, page_count)
      values (${source.type}, ${file.path}, ${hash}, ${meta.title}, ${meta.departmentId!}, ${meta.docType},
              ${meta.clientName}, ${meta.createdYear}, ${file.fileType}, ${extracted.pages.length})
      on conflict (source_type, source_path) do update set
        content_hash = excluded.content_hash, title = excluded.title, department_id = excluded.department_id,
        doc_type = excluded.doc_type, client_name = excluded.client_name, created_year = excluded.created_year,
        file_type = excluded.file_type, page_count = excluded.page_count, ingested_at = now()
      returning id`;
    // 古いチャンクを消して入れ直す（差し替えはほぼ無い前提なので単純に）
    await tx`delete from chunks where document_id = ${doc.id}`;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      await tx`
        insert into chunks (document_id, department_id, chunk_index, section_title, page_start, page_end,
                            content, token_count, embedding)
        values (${doc.id}, ${meta.departmentId!}, ${c.index}, ${c.sectionTitle}, ${c.pageStart}, ${c.pageEnd},
                ${c.content}, ${c.tokenCount}, ${toVectorLiteral(embeddings[i])}::vector)`;
    }
  });

  return { status: existing[0] ? "updated" : "inserted", chunks: chunks.length, department: meta.departmentId };
}

/** CLI から呼ぶ入口（src/cli/ingest.ts が使う） */
export async function runIngestCli(argv: string[]): Promise<void> {
  const opts: IngestOptions = { force: argv.includes("--force"), dryRun: argv.includes("--dry-run") };
  const dir = argv.find((a) => !a.startsWith("--")) ?? config.docsDir;
  console.log(`取り込み元: ${path.resolve(dir)}  ${opts.dryRun ? "(dry-run)" : ""}${opts.force ? "(force)" : ""}`);
  try {
    const s = await ingest(new LocalFolderSource(dir), opts);
    console.log(`\n結果: 新規 ${s.inserted} / 更新 ${s.updated} / スキップ ${s.skipped} / 失敗 ${s.failed} / チャンク ${s.chunks}`);
    if (s.failed > 0) process.exitCode = 1;
  } finally {
    await closeAll();
  }
}
