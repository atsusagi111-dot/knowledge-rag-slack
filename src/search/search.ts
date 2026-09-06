/**
 * ベクトル検索。必ず「Slack ユーザー ID 付き」で呼ぶ。
 * RLS により、そのユーザーが所属する部署のチャンクだけが並べ替え対象になる。
 */
import { withSlackUser, toVectorLiteral } from "../db/client.js";
import { config, type DepartmentId } from "../config.js";
import type { EmbeddingClient } from "../ingest/embed.js";

export interface SearchHit {
  chunkId: string;
  documentId: string;
  title: string;
  /** 取り込み元のファイル名（出典表示用） */
  fileName: string;
  departmentId: DepartmentId;
  sectionTitle: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  /** コサイン類似度（1 が完全一致） */
  score: number;
}

export interface SearchResult {
  hits: SearchHit[];
  /** 検索時点でのユーザーの所属部署（監査ログ用） */
  departmentIds: DepartmentId[];
  /** ユーザーがマスタに未登録 */
  unregistered: boolean;
}

export type SearchFn = (slackUserId: string, question: string, topK?: number) => Promise<SearchResult>;

/** ユーザーの所属部署を取得（RLS 越し。未登録なら空配列） */
export async function getUserDepartments(slackUserId: string): Promise<DepartmentId[]> {
  return withSlackUser(slackUserId, async (tx) => {
    const rows = await tx<{ department_id: DepartmentId }[]>`
      select department_id from user_departments where slack_user_id = ${slackUserId} order by department_id`;
    return rows.map((r) => r.department_id);
  });
}

/** 検索関数を組み立てる（Embedding クライアントは providers.ts から渡す） */
export function makeSearch(embedder: EmbeddingClient): SearchFn {
  return async (slackUserId, question, topK = config.search.topK) => {
    // 所属部署の取得と質問の Embedding は独立なので同時に行う
    const [departmentIds, [queryVec]] = await Promise.all([getUserDepartments(slackUserId), embedder.embed([question])]);
    if (departmentIds.length === 0) return { hits: [], departmentIds: [], unregistered: true };
    const hits = await searchByVector(slackUserId, queryVec, topK);
    return { hits, departmentIds, unregistered: false };
  };
}

/** ベクトルを直接渡す版（評価・テストで Embedding を使い回すため） */
export async function searchByVector(slackUserId: string, queryVec: number[], topK: number): Promise<SearchHit[]> {
  const literal = toVectorLiteral(queryVec);
  return withSlackUser(slackUserId, async (tx) => {
    const rows = await tx<
      {
        chunk_id: string;
        document_id: string;
        title: string;
        source_path: string;
        department_id: DepartmentId;
        section_title: string | null;
        page_start: number | null;
        page_end: number | null;
        content: string;
        score: number;
      }[]
    >`
      with q as (select ${literal}::vector as v)
      select c.id as chunk_id, c.document_id, d.title, d.source_path, d.department_id,
             c.section_title, c.page_start, c.page_end, c.content,
             1 - (c.embedding <=> q.v) as score
      from chunks c
      join documents d on d.id = c.document_id
      cross join q
      order by c.embedding <=> q.v
      limit ${topK}`;
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      title: r.title,
      fileName: r.source_path.split("/").pop() ?? r.source_path,
      departmentId: r.department_id,
      sectionTitle: r.section_title,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      content: r.content,
      score: Number(r.score),
    }));
  });
}
