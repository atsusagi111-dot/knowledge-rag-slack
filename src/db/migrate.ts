/**
 * supabase/migrations/*.sql を番号順に適用する小さなマイグレーションツール。
 * 適用済みのファイル名は schema_migrations テーブルに記録し、二重適用しない。
 *
 * 実行: 模擬案件7 フォルダで  npm run db:migrate
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ingestSql } from "./client.js";
import { config } from "../config.js";
import { runCli } from "../lib/cli.js";

const MIGRATIONS_DIR = path.resolve("supabase/migrations");

/** マイグレーション SQL を番号順に読み、ロールのパスワードを埋めて返す（テストからも使う） */
export async function loadMigrations(ragBotPassword: string): Promise<{ file: string; body: string }[]> {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  return Promise.all(
    files.map(async (file) => ({
      file,
      body: (await readFile(path.join(MIGRATIONS_DIR, file), "utf8")).replaceAll("__RAG_BOT_PASSWORD__", ragBotPassword.replaceAll("'", "''")),
    })),
  );
}

async function main() {
  const sql = ingestSql();
  await sql`create table if not exists schema_migrations (
    filename text primary key,
    applied_at timestamptz not null default now()
  )`;
  const applied = new Set((await sql<{ filename: string }[]>`select filename from schema_migrations`).map((r) => r.filename));

  let count = 0;
  const migrations = await loadMigrations(config.db.ragBotPassword);
  for (const { file, body } of migrations) {
    if (applied.has(file)) {
      console.log(`skip    ${file}`);
      continue;
    }
    console.log(`apply   ${file}`);
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into schema_migrations (filename) values (${file})`;
    });
    count++;
  }
  console.log(`done: ${count} 件適用, ${migrations.length - count} 件スキップ`);
}

runCli(main);
