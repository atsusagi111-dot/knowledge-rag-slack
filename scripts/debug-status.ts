/** デバッグ用: doc3 の部署状態と直近の回答の根拠文書を表示する */
import { ingestSql, closeAll } from "../src/db/client.js";

async function main() {
  const s = ingestSql();
  const d = await s`select department_id, department_locked from documents where source_path like '%doc3%'`;
  console.log("doc3:", JSON.stringify(d));
  const c = await s`select c.department_id, count(*)::int as n from chunks c join documents d on d.id = c.document_id where d.source_path like '%doc3%' group by 1`;
  console.log("doc3 chunks:", JSON.stringify(c));
  const l = await s`
    select l.id, left(l.question, 30) as question, l.result_status, l.model,
           to_char(l.created_at at time zone 'Asia/Tokyo', 'HH24:MI') as t,
           (select string_agg(distinct split_part(d.source_path, '/', 2), ', ')
              from chunks ch join documents d on d.id = ch.document_id where ch.id = any(l.top_chunk_ids)) as cited_docs
    from search_logs l order by l.id desc limit 5`;
  console.table(l);
}
main().finally(closeAll);
