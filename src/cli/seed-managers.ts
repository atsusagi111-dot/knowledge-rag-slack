/**
 * 部署管理者（月次レポートの送付先）を CSV から投入する。
 *   npm run db:seed-managers                       → data/master/department_managers.csv
 *   npm run db:seed-managers -- --sync             → CSV に無い行は削除
 * CSV 形式: department_id,slack_user_id,display_name
 */
import { readFile } from "node:fs/promises";
import { ingestSql, closeAll } from "../db/client.js";
import { resolveDepartment } from "../ingest/metadata.js";
import { parseCsv } from "../lib/csv.js";

async function main() {
  const args = process.argv.slice(2);
  const sync = args.includes("--sync");
  const file = args.find((a) => !a.startsWith("--")) ?? "data/master/department_managers.csv";
  const rows = parseCsv(await readFile(file, "utf8"));
  const sql = ingestSql();
  const keep: { dept: string; user: string }[] = [];
  for (const r of rows) {
    const dept = resolveDepartment(r.department_id);
    if (!dept || !r.slack_user_id) {
      console.warn(`skip: ${JSON.stringify(r)}`);
      continue;
    }
    await sql`insert into department_managers (department_id, slack_user_id, display_name)
              values (${dept}, ${r.slack_user_id.trim()}, ${r.display_name ?? null})
              on conflict (department_id, slack_user_id) do update set display_name = excluded.display_name`;
    keep.push({ dept, user: r.slack_user_id.trim() });
  }
  console.log(`${keep.length} 行を投入しました（${file}）`);
  if (sync) {
    const current = await sql<{ department_id: string; slack_user_id: string }[]>`select department_id, slack_user_id from department_managers`;
    for (const c of current) {
      if (keep.some((k) => k.dept === c.department_id && k.user === c.slack_user_id)) continue;
      await sql`delete from department_managers where department_id = ${c.department_id} and slack_user_id = ${c.slack_user_id}`;
      console.log(`removed  ${c.department_id} / ${c.slack_user_id}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
