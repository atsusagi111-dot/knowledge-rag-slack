/**
 * supabase/migrations/*.sql を番号順に適用する小さなマイグレーションツール。
 * 適用済みのファイル名は schema_migrations テーブルに記録し、二重適用しない。
 *
 * 実行: 模擬案件7 フォルダで  npm run db:migrate
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ingestSql, closeAll } from "./client.js";
import { config } from "../config.js";

const MIGRATIONS_DIR = path.resolve("supabase/migrations");

async function main() {
  const sql = ingestSql();
  await sql`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )`;

  const applied = new Set(
    (await sql<{ filename: string }[]>`select filename from schema_migrations`).map((r) => r.filename),
  );

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip    ${file}`);
      continue;
    }
    let body = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    // ロール作成 SQL の中のプレースホルダを .env の値で置換
    body = body.replaceAll("__RAG_BOT_PASSWORD__", config.db.ragBotPassword.replaceAll("'", "''"));
    console.log(`apply   ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (filename) values (${file})`;
    });
    count++;
  }
  console.log(`done: ${count} 件適用, ${files.length - count} 件スキップ`);
}

main()
  .catch((e) => {
    console.error("マイグレーション失敗:", e);
    process.exitCode = 1;
  })
  .finally(closeAll);
