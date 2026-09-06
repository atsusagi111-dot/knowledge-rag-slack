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
  const args = process.argv.slice(2);
  // --sync: CSV に無い所属行を DB から削除する（異動・退職の反映）。付けない場合は追加・上書きのみ
  const sync = args.includes("--sync");
  const file = args.find((a) => !a.startsWith("--")) ?? "data/master/user_departments.csv";
  const rows = parseCsv(await readFile(file, "utf8"));
  const sql = ingestSql();
  let n = 0;
  const keep: { user: string; dept: string }[] = [];
  for (const r of rows) {
    const dept = resolveDepartment(r.department_id);
    if (!r.slack_user_id || !dept) {
      console.warn(`skip: ${JSON.stringify(r)}（部署名が不正）`);
      continue;
    }
    const user = r.slack_user_id.trim();
    await sql`
      insert into user_departments (slack_user_id, department_id, display_name)
      values (${user}, ${dept}, ${r.display_name ?? null})
      on conflict (slack_user_id, department_id) do update set display_name = excluded.display_name`;
    keep.push({ user, dept });
    n++;
  }
  console.log(`${n} 行を投入しました（${file}）`);

  if (sync) {
    const current = await sql<{ slack_user_id: string; department_id: string }[]>`
      select slack_user_id, department_id from user_departments`;
    let removed = 0;
    for (const c of current) {
      if (keep.some((k) => k.user === c.slack_user_id && k.dept === c.department_id)) continue;
      await sql`delete from user_departments where slack_user_id = ${c.slack_user_id} and department_id = ${c.department_id}`;
      console.log(`removed  ${c.slack_user_id} / ${c.department_id}`);
      removed++;
    }
    console.log(`CSV に無い所属 ${removed} 行を削除しました（--sync）`);
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
