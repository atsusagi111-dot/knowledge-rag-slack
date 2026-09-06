/**
 * Slack ユーザー ↔ 部署 マスタを CSV から投入する。
 *   npm run db:seed-users                      → data/master/user_departments.csv
 *   npm run db:seed-users -- path/to/file.csv
 * CSV 形式（1 行目はヘッダ）: slack_user_id,department_id,display_name
 *   department_id は strategy/operations/it/hr/sales/admin または 戦略/業務/IT/人事/営業/管理
 * 同じ CSV を再投入すると上書きされる（CSV に無い行は消さない）。
 */
import { readFile } from "node:fs/promises";
import { ingestSql, closeAll } from "../db/client.js";
import { resolveDepartment } from "../ingest/metadata.js";
import { parseCsv } from "../lib/csv.js";

async function main() {
  const file = process.argv[2] ?? "data/master/user_departments.csv";
  const rows = parseCsv(await readFile(file, "utf8"));
  const sql = ingestSql();
  let n = 0;
  for (const r of rows) {
    const dept = resolveDepartment(r.department_id);
    if (!r.slack_user_id || !dept) {
      console.warn(`skip: ${JSON.stringify(r)}（部署名が不正）`);
      continue;
    }
    await sql`
      insert into user_departments (slack_user_id, department_id, display_name)
      values (${r.slack_user_id.trim()}, ${dept}, ${r.display_name ?? null})
      on conflict (slack_user_id, department_id) do update set display_name = excluded.display_name`;
    n++;
  }
  console.log(`${n} 行を投入しました（${file}）`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
