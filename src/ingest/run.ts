/**
 * 取り込み本体。
 *   npm run ingest                  → DOCS_DIR 配下を全件処理（未変更はスキップ）
 *   npm run ingest -- --force       → ハッシュが同じでも入れ直す
 *   npm run ingest -- --dry-run     → DB・OpenAI を呼ばず、抽出とチャンク数だけ表示
 *   npm run ingest -- --prune       → 取り込み元に無くなった文書を DB からも削除
 *   npm run ingest -- --retry-failed→ 前回失敗したファイルだけ再試行
 *
 * 1 ファイルの処理は「analyze（抽出・メタデータ・ハッシュ・チャンク）」と「persist（Embedding・保存）」の 2 段階。
 * dry-run は analyze だけで止まるので DB や OpenAI に触れない。
 */
import { createHash } from "node:crypto";
import path from "node:path";
import type { Sql } from "postgres";
import { config } from "../config.js";
import { ingestSql, toVectorLiteral } from "../db/client.js";
import { LocalFolderSource } from "../sources/LocalFolderSource.js";
import type { DocumentSource, SourceFile } from "../sources/DocumentSource.js";
import { extractText } from "./extract.js";
import { extractMetadata, type DocumentMetadata } from "./metadata.js";
import { chunkPages, type Chunk } from "./chunk.js";
import type { EmbeddingClient } from "./embed.js";

export interface IngestOptions {
  force?: boolean;
  dryRun?: boolean;
  /** 取り込み元に存在しなくなった文書を DB から削除する（機密扱い変更・退役時の同期） */
  prune?: boolean;
  /** ingest_failures に記録されたファイルだけを再試行する（週次リトライ用） */
  retryFailed?: boolean;
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

type Status = "inserted" | "updated" | "skipped";

export async function ingest(source: DocumentSource, opts: IngestOptions, embedder: EmbeddingClient): Promise<IngestSummary> {
  const summary: IngestSummary = { inserted: 0, updated: 0, skipped: 0, failed: 0, chunks: 0, pruned: 0 };
  const sql = opts.dryRun ? null : ingestSql();

  // 既存文書のハッシュを 1 回で取得（ファイルごとの問い合わせを避ける）
  const existing = new Map<string, { id: string; hash: string }>();
  if (sql) {
    for (const r of await sql<{ id: string; source_path: string; content_hash: string }[]>`
      select id, source_path, content_hash from documents where source_type = ${source.type}`) {
      existing.set(r.source_path, { id: r.id, hash: r.content_hash });
    }
  }

  // --retry-failed: 前回失敗したファイルだけを対象にする
  let onlyPaths: Set<string> | null = null;
  if (opts.retryFailed && sql) {
    onlyPaths = new Set((await sql<{ source_path: string }[]>`select source_path from ingest_failures where source_type = ${source.type}`).map((f) => f.source_path));
    console.log(`再試行対象: ${onlyPaths.size} 件`);
    if (onlyPaths.size === 0) return summary;
  }

  const seen: string[] = [];
  for await (const file of source.list()) {
    seen.push(file.path);
    if (onlyPaths && !onlyPaths.has(file.path)) continue;
    try {
      const analyzed = await analyze(source, file);
      const prev = existing.get(file.path);
      let status: Status = "skipped";
      let chunkCount = analyzed.chunks.length;
      if (!sql) {
        // dry-run
      } else if (prev && prev.hash === analyzed.hash && !opts.force) {
        chunkCount = 0;
      } else {
        await persist(sql, embedder, source.type, file, analyzed);
        status = prev ? "updated" : "inserted";
        await sql`delete from ingest_failures where source_type = ${source.type} and source_path = ${file.path}`;
      }
      summary[status]++;
      summary.chunks += chunkCount;
      console.log(`${status.padEnd(8)} ${file.path}  (${analyzed.meta.departmentId}, ${chunkCount} chunks)`);
    } catch (e) {
      summary.failed++;
      const message = (e as Error).message;
      console.error(`failed   ${file.path}: ${message}`);
      if (sql) {
        await sql`
          insert into ingest_failures (source_type, source_path, error)
          values (${source.type}, ${file.path}, ${message})
          on conflict (source_type, source_path) do update
            set error = excluded.error, attempts = ingest_failures.attempts + 1, last_at = now()`;
      }
    }
  }

  if (opts.prune && sql && !onlyPaths) {
    // 取り込み元から消えた文書を DB からも削除する（chunks は on delete cascade で一緒に消える）。
    // 機密扱いの変更（他部署に見せない・退役）は「元ファイルを消す/移す → --prune」で DB に反映される
    const pruned = await sql<{ source_path: string; department_id: string }[]>`
      delete from documents where source_type = ${source.type} and source_path <> all(${seen}::text[])
      returning source_path, department_id`;
    for (const d of pruned) console.log(`pruned   ${d.source_path}  (${d.department_id})`);
    summary.pruned = pruned.length;
  }
  return summary;
}

interface Analyzed {
  meta: DocumentMetadata & { departmentId: NonNullable<DocumentMetadata["departmentId"]> };
  hash: string;
  pageCount: number;
  chunks: Chunk[];
}

/** 抽出・メタデータ・ハッシュ・チャンク分割。DB にも OpenAI にも触れない */
export async function analyze(source: DocumentSource, file: SourceFile): Promise<Analyzed> {
  const extracted = await extractText(await source.read(file), file.fileType);
  if (extracted.fullText.length < 20) throw new Error("テキストがほとんど抽出できませんでした（画像 PDF の可能性）");
  const meta = extractMetadata(extracted.fullText, file.name, file.departmentHint);
  if (!meta.departmentId) {
    throw new Error("部署を特定できません。冒頭に「部署: 戦略」の行を入れるか、部署名フォルダに置いてください");
  }
  return {
    meta: { ...meta, departmentId: meta.departmentId },
    hash: createHash("sha256").update(extracted.fullText).digest("hex"),
    pageCount: extracted.pages.length,
    chunks: chunkPages(extracted.pages, config.chunk, meta.title),
  };
}

/** Embedding を作り、documents と chunks を保存する（1 トランザクション、chunks は 1 文で一括挿入） */
async function persist(sql: Sql, embedder: EmbeddingClient, sourceType: string, file: SourceFile, a: Analyzed): Promise<void> {
  const embeddings = await embedder.embed(a.chunks.map((c) => c.content));
  await sql.begin(async (tx) => {
    // department_locked（管理者が手で部署を変えた文書）は、取り込みで部署を上書きしない
    const [doc] = await tx<{ id: string; department_id: string }[]>`
      insert into documents (source_type, source_path, content_hash, title, department_id, doc_type,
                             client_name, created_year, file_type, page_count)
      values (${sourceType}, ${file.path}, ${a.hash}, ${a.meta.title}, ${a.meta.departmentId}, ${a.meta.docType},
              ${a.meta.clientName}, ${a.meta.createdYear}, ${file.fileType}, ${a.pageCount})
      on conflict (source_type, source_path) do update set
        content_hash = excluded.content_hash, title = excluded.title,
        department_id = case when documents.department_locked then documents.department_id else excluded.department_id end,
        doc_type = excluded.doc_type, client_name = excluded.client_name, created_year = excluded.created_year,
        file_type = excluded.file_type, page_count = excluded.page_count, ingested_at = now()
      returning id, department_id`;
    await tx`delete from chunks where document_id = ${doc.id}`;
    if (a.chunks.length === 0) return;
    await tx`
      insert into chunks (document_id, department_id, chunk_index, section_title, page_start, page_end, content, token_count, embedding)
      select ${doc.id}::uuid, ${doc.department_id}, t.idx, t.title, t.p1, t.p2, t.content, t.tokens, t.emb::vector
      from unnest(
        ${a.chunks.map((c) => c.index)}::int[],
        ${a.chunks.map((c) => c.sectionTitle)}::text[],
        ${a.chunks.map((c) => c.pageStart)}::int[],
        ${a.chunks.map((c) => c.pageEnd)}::int[],
        ${a.chunks.map((c) => c.content)}::text[],
        ${a.chunks.map((c) => c.tokenCount)}::int[],
        ${embeddings.map(toVectorLiteral)}::text[]
      ) as t(idx, title, p1, p2, content, tokens, emb)`;
  });
}

/** CLI から呼ぶ入口（src/cli/ingest.ts が使う） */
export async function runIngestCli(opts: IngestOptions, dir: string, embedder: EmbeddingClient): Promise<void> {
  const flags = (Object.keys(opts) as (keyof IngestOptions)[]).filter((k) => opts[k]).join(", ");
  console.log(`取り込み元: ${path.resolve(dir)}${flags ? `  (${flags})` : ""}`);
  const s = await ingest(new LocalFolderSource(dir), opts, embedder);
  console.log(`\n結果: 新規 ${s.inserted} / 更新 ${s.updated} / スキップ ${s.skipped} / 失敗 ${s.failed} / 削除 ${s.pruned} / チャンク ${s.chunks}`);
  if (s.failed > 0) process.exitCode = 1;
}
