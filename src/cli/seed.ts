/**
 * 部署系マスタ（user_departments / department_managers）を CSV から投入する共通処理。
 *   npm run db:seed-users    [-- path.csv] [--sync]
 *   npm run db:seed-managers [-- path.csv] [--sync]
 * CSV 形式（1 行目はヘッダ）: slack_user_id,department_id,display_name（列順は自由）
 *   department_id は strategy/... の ID または 戦略/... の日本語名
 * 同じ CSV を再投入すると上書きされる。--sync を付けると CSV に無い行を削除する（異動・退職の反映）。
 */
import { readFile } from "node:fs/promises";
import { resolveDepartment } from "../config.js";
import { ingestSql } from "../db/client.js";
import { parseCsv } from "../lib/csv.js";
import { flag, positionals } from "../lib/cli.js";

export async function seedDepartmentTable(table: "user_departments" | "department_managers", defaultCsv: string): Promise<void> {
  const file = positionals()[0] ?? defaultCsv;
  const rows = parseCsv(await readFile(file, "utf8"));
  const sql = ingestSql();
  const keep = new Set<string>();

  for (const r of rows) {
    const dept = resolveDepartment(r.department_id);
    const user = r.slack_user_id?.trim();
    if (!user || !dept) {
      console.warn(`skip: ${JSON.stringify(r)}（部署名または Slack ID が不正）`);
      continue;
    }
    await sql`
      insert into ${sql(table)} (slack_user_id, department_id, display_name)
      values (${user}, ${dept}, ${r.display_name ?? null})
      on conflict (slack_user_id, department_id) do update set display_name = excluded.display_name`;
    keep.add(`${user}|${dept}`);
  }
  console.log(`${keep.size} 行を投入しました（${file}）`);

  if (flag("--sync")) {
    const current = await sql<{ slack_user_id: string; department_id: string }[]>`select slack_user_id, department_id from ${sql(table)}`;
    let removed = 0;
    for (const c of current) {
      if (keep.has(`${c.slack_user_id}|${c.department_id}`)) continue;
      await sql`delete from ${sql(table)} where slack_user_id = ${c.slack_user_id} and department_id = ${c.department_id}`;
      console.log(`removed  ${c.slack_user_id} / ${c.department_id}`);
      removed++;
    }
    console.log(`CSV に無い行 ${removed} 件を削除しました（--sync）`);
  }
}
