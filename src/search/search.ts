/**
 * ベクトル検索。必ず「Slack ユーザー ID 付き」で呼ぶ。
 * RLS により、そのユーザーが所属する部署のチャンクだけが並べ替え対象になる。
 */
import { withSlackUser, toVectorLiteral, botSql } from "../db/client.js";
import { config, type DepartmentId } from "../config.js";
import { defaultEmbeddingClient, type EmbeddingClient } from "../ingest/embed.js";

export interface SearchHit {
  chunkId: string;
  documentId: string;
  title: string;
  departmentId: DepartmentId;
  createdYear: number | null;
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

/** ユーザーの所属部署を取得（RLS 越し。未登録なら空配列） */
export async function getUserDepartments(slackUserId: string): Promise<DepartmentId[]> {
  return withSlackUser(slackUserId, async (tx) => {
    const rows = await tx<{ department_id: DepartmentId }[]>`
      select department_id from user_departments where slack_user_id = ${slackUserId} order by department_id`;
    return rows.map((r) => r.department_id);
  });
}

/** 依存の差し替え口（テスト用）。undefined で既定に戻る */
let _searchOverride: typeof searchChunks | undefined;
export function setSearchOverride(fn: typeof searchChunks | undefined): void {
  _searchOverride = fn;
}

export async function searchChunks(
  slackUserId: string,
  question: string,
  opts: { topK?: number; embedder?: EmbeddingClient } = {},
): Promise<SearchResult> {
  if (_searchOverride) return _searchOverride(slackUserId, question, opts);
  const topK = opts.topK ?? config.search.topK;
  const departmentIds = await getUserDepartments(slackUserId);
  if (departmentIds.length === 0) {
    return { hits: [], departmentIds: [], unregistered: true };
  }

  const embedder = opts.embedder ?? defaultEmbeddingClient();
  const [queryVec] = await embedder.embed([question]);
  const hits = await searchByVector(slackUserId, queryVec, topK);
  return { hits, departmentIds, unregistered: false };
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
        department_id: DepartmentId;
        created_year: number | null;
        section_title: string | null;
        page_start: number | null;
        page_end: number | null;
        content: string;
        score: number;
      }[]
    >`
      select c.id as chunk_id, c.document_id, d.title, d.department_id, d.created_year,
             c.section_title, c.page_start, c.page_end, c.content,
             1 - (c.embedding <=> ${literal}::vector) as score
      from chunks c
      join documents d on d.id = c.document_id
      order by c.embedding <=> ${literal}::vector
      limit ${topK}`;
    return rows.map((r) => ({
      chunkId: r.chunk_id,
      documentId: r.document_id,
      title: r.title,
      departmentId: r.department_id,
      createdYear: r.created_year,
      sectionTitle: r.section_title,
      pageStart: r.page_start,
      pageEnd: r.page_end,
      content: r.content,
      score: Number(r.score),
    }));
  }, botSql());
}
