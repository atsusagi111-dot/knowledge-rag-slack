/** 文書 1 件を取り込み元パスで引く（管理系 CLI の共通処理） */
import type { Sql } from "postgres";

export interface DocumentRow {
  id: string;
  title: string;
  department_id: string;
  department_locked: boolean;
}

export async function findLocalDocument(sql: Sql, sourcePath: string): Promise<DocumentRow> {
  const [doc] = await sql<DocumentRow[]>`
    select id, title, department_id, department_locked from documents
    where source_type = 'local' and source_path = ${sourcePath}`;
  if (!doc) throw new Error(`文書が見つかりません: ${sourcePath}（Table Editor の documents.source_path で確認）`);
  return doc;
}
