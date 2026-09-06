/** 接続テスト:  npm run db:ping */
import { ingestSql, botSql } from "../db/client.js";
import { runCli } from "../lib/cli.js";

runCli(async () => {
  const [v] = await ingestSql()`select version() as version, current_user as role`;
  console.log(`ok  (ingest 接続) role=${v.role}`);
  console.log(`    ${String(v.version).split(",")[0]}`);
  const [ext] = await ingestSql()`select count(*)::int as n from pg_extension where extname = 'vector'`;
  console.log(ext.n > 0 ? "ok  pgvector 有効" : "NG  pgvector が有効になっていません（Database → Extensions → vector）");
  try {
    const [b] = await botSql()`select current_user as role`;
    console.log(`ok  (bot 接続) role=${b.role}`);
  } catch (e) {
    console.log(`--  bot 接続は未設定または失敗（db:migrate 後に確認）: ${(e as Error).message.split("\n")[0]}`);
  }
});
