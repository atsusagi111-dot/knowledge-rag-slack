/**
 * 文書の機密区分（部署）を変更する。Supabase の Table Editor で documents.department_id を直接変えるのと同じ。
 *   npm run doc:classify -- --path it/case7-doc3-it-cloud-migration.pdf --department confidential
 *   npm run doc:classify -- --path it/case7-doc3-it-cloud-migration.pdf --unlock      # 取り込み元の部署に戻す
 * DB のトリガーが chunks にも反映し、department_locked = true にして次回の取り込みで戻らないようにする。
 */
import { DEPARTMENT_IDS, DEPARTMENT_NAME_JA } from "../config.js";
import { ingestSql, closeAll } from "../db/client.js";
import { resolveDepartment } from "../ingest/metadata.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sourcePath = arg("--path");
  const deptRaw = arg("--department");
  const unlock = process.argv.includes("--unlock");
  if (!sourcePath || (!deptRaw && !unlock)) {
    throw new Error(`使い方: npm run doc:classify -- --path <部署/ファイル名> --department <${DEPARTMENT_IDS.join("|")}>  または --unlock`);
  }
  const sql = ingestSql();
  const [doc] = await sql<{ id: string; title: string; department_id: string; department_locked: boolean }[]>`
    select id, title, department_id, department_locked from documents where source_type = 'local' and source_path = ${sourcePath}`;
  if (!doc) throw new Error(`文書が見つかりません: ${sourcePath}`);

  if (unlock) {
    await sql`update documents set department_locked = false where id = ${doc.id}`;
    console.log(`ロック解除: ${doc.title}。次回の npm run ingest -- --force で取り込み元の部署に戻ります`);
    return;
  }
  const dept = resolveDepartment(deptRaw);
  if (!dept) throw new Error(`部署が不正です: ${deptRaw}`);
  await sql`update documents set department_id = ${dept} where id = ${doc.id}`;
  const [n] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where document_id = ${doc.id} and department_id = ${dept}`;
  console.log(`変更: ${doc.title}  ${DEPARTMENT_NAME_JA[doc.department_id as keyof typeof DEPARTMENT_NAME_JA] ?? doc.department_id} → ${DEPARTMENT_NAME_JA[dept]}（チャンク ${n.n} 件に反映、ロック済み）`);
  if (dept === "confidential") {
    const viewers = await sql<{ slack_user_id: string }[]>`select slack_user_id from user_departments where department_id = 'confidential'`;
    console.log(`機密文書を閲覧できる人: ${viewers.length} 名${viewers.length === 0 ? "（誰も見られません。閲覧させるには user_departments.csv に confidential を追加）" : ""}`);
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
