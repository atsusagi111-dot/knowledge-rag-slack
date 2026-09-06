/** 無料枠の使用量チェック:  npm run db:stats */
import { ingestSql } from "../db/client.js";
import { runCli } from "../lib/cli.js";

runCli(async () => {
  const sql = ingestSql();
  const [[db], tables, [docs], [chunks], [byDept]] = await Promise.all([
    sql`select pg_size_pretty(pg_database_size(current_database())) as size, pg_database_size(current_database())::bigint as bytes`,
    sql<{ name: string; size: string; rows: number }[]>`
      select relname as name, pg_size_pretty(pg_total_relation_size(relid)) as size, n_live_tup::int as rows
      from pg_stat_user_tables order by pg_total_relation_size(relid) desc`,
    sql`select count(*)::int as n from documents`,
    sql`select count(*)::int as n, coalesce(sum(token_count),0)::int as tokens from chunks`,
    sql`select json_object_agg(department_id, n) as j from (select department_id, count(*)::int as n from documents group by 1) t`,
  ]);

  const pct = ((Number(db.bytes) / (500 * 1024 * 1024)) * 100).toFixed(1);
  console.log(`DB サイズ: ${db.size}  (無料枠 500MB の ${pct}%)`);
  console.log(`文書: ${docs.n} 件 / チャンク: ${chunks.n} 件 / 合計トークン: ${chunks.tokens}`);
  console.log(`部署別文書数: ${JSON.stringify(byDept.j ?? {})}`);
  console.log("\nテーブル別サイズ:");
  for (const t of tables) console.log(`  ${t.name.padEnd(20)} ${t.size.padStart(10)}  ${t.rows} rows`);
});
