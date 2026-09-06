/**
 * 文書の機密区分（部署）を変更する。Supabase の Table Editor で documents.department_id を直接変えるのと同じ。
 *   npm run doc:classify -- --path it/case7-doc3-it-cloud-migration.pdf --department confidential
 *   npm run doc:classify -- --path it/case7-doc3-it-cloud-migration.pdf --unlock      # 取り込み元の部署に戻す
 * DB のトリガーが chunks にも反映し、department_locked = true にして次回の取り込みで戻らないようにする。
 */
import { DEPARTMENT_IDS, departmentLabel, resolveDepartment } from "../config.js";
import { ingestSql } from "../db/client.js";
import { findLocalDocument } from "../db/documents.js";
import { flag, runCli, value } from "../lib/cli.js";

runCli(async () => {
  const sourcePath = value("--path");
  const deptRaw = value("--department");
  const unlock = flag("--unlock");
  if (!sourcePath || (!deptRaw && !unlock)) {
    throw new Error(`使い方: npm run doc:classify -- --path <部署/ファイル名> --department <${DEPARTMENT_IDS.join("|")}>  または --unlock`);
  }
  const sql = ingestSql();
  const doc = await findLocalDocument(sql, sourcePath);

  if (unlock) {
    await sql`update documents set department_locked = false where id = ${doc.id}`;
    console.log(`ロック解除: ${doc.title}。次回の npm run ingest -- --force で取り込み元の部署に戻ります`);
    return;
  }
  const dept = resolveDepartment(deptRaw);
  if (!dept) throw new Error(`部署が不正です: ${deptRaw}`);
  await sql`update documents set department_id = ${dept} where id = ${doc.id}`;
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where document_id = ${doc.id} and department_id = ${dept}`;
  console.log(`変更: ${doc.title}  ${departmentLabel(doc.department_id)} → ${departmentLabel(dept)}（チャンク ${n.n} 件に反映、ロック済み）`);
  if (dept === "confidential") {
    const [v] = await sql<{ n: number }[]>`select count(*)::int as n from user_departments where department_id = 'confidential'`;
    console.log(`機密文書を閲覧できる人: ${v.n} 名${v.n === 0 ? "（誰も見られません。閲覧させるには user_departments.csv に confidential を追加）" : ""}`);
  }
});
