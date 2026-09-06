/**
 * RLS ポリシーのローカル検証（PGlite = Node 内で動く PostgreSQL、pgvector 対応）。
 * Supabase に接続せずに、supabase/migrations/*.sql をそのまま流して
 * 「人事ユーザーは IT 文書を 0 件しか見られない」ことを証明する。
 * 本番 DB に対する同じ検証は tests/rls.test.ts。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite-pgvector";

let db: PGlite;
const DIM = 1536;
const vec = (fill: number) => `[${Array.from({ length: DIM }, () => fill).join(",")}]`;

/** rag_bot ロールとして、指定 Slack ユーザーで SQL を実行する */
async function asBot<T>(slackUserId: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec("begin");
  try {
    // SET ROLE ではログイン時の search_path 設定が効かないので明示する
    await db.exec("set local role rag_bot; set local search_path = public, extensions");
    if (slackUserId !== null) await db.query("select set_config('app.slack_user_id', $1, true)", [slackUserId]);
    const r = await db.query<T>(sql, params);
    return r.rows;
  } finally {
    await db.exec("rollback");
  }
}

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec("set search_path = public, extensions");
  const dir = path.resolve("supabase/migrations");
  for (const f of (await readdir(dir)).filter((x) => x.endsWith(".sql")).sort()) {
    const body = (await readFile(path.join(dir, f), "utf8")).replaceAll("__RAG_BOT_PASSWORD__", "test");
    await db.exec(body);
  }
  // テストデータ: IT 文書 1 件（チャンク 2）, 人事文書 1 件（チャンク 1）
  await db.exec(`
    insert into documents (id, source_type, source_path, content_hash, title, department_id, file_type)
    values ('00000000-0000-0000-0000-000000000001', 'local', 'it/cloud.pdf', 'h1', 'クラウド移行報告書', 'it', 'pdf'),
           ('00000000-0000-0000-0000-000000000002', 'local', 'hr/engagement.pdf', 'h2', 'エンゲージメント報告書', 'hr', 'pdf');
    insert into chunks (document_id, department_id, chunk_index, content, token_count, embedding) values
      ('00000000-0000-0000-0000-000000000001', 'it', 0, 'Aurora PostgreSQL に移行', 10, '${vec(0.01)}'),
      ('00000000-0000-0000-0000-000000000001', 'it', 1, '運用コスト 35% 削減', 10, '${vec(0.02)}'),
      ('00000000-0000-0000-0000-000000000002', 'hr', 0, '中堅層のエンゲージメント低下', 10, '${vec(0.03)}');
    insert into user_departments (slack_user_id, department_id) values
      ('UHR', 'hr'), ('UIT', 'it'), ('UBOTH', 'hr'), ('UBOTH', 'it');
  `);
});

afterAll(async () => {
  await db.close();
});

const SEARCH = `
  select c.department_id, d.title, 1 - (c.embedding <=> $1::vector) as score
  from chunks c join documents d on d.id = c.document_id
  order by c.embedding <=> $1::vector limit 10`;

describe("RLS（ローカル PGlite）", () => {
  it("マイグレーションが通り、部署が 6 件入る", async () => {
    const r = await db.query<{ n: number }>("select count(*)::int as n from departments");
    expect(r.rows[0].n).toBe(6);
  });

  it("人事ユーザーは IT 部の文書を 0 件しか見られない", async () => {
    const rows = await asBot<{ department_id: string }>("UHR", SEARCH, [vec(0.01)]);
    expect(rows.length).toBe(1);
    expect(rows.every((r) => r.department_id === "hr")).toBe(true);
  });

  it("IT ユーザーは IT 部の 2 チャンクだけ見える", async () => {
    const rows = await asBot<{ department_id: string }>("UIT", SEARCH, [vec(0.01)]);
    expect(rows.map((r) => r.department_id)).toEqual(["it", "it"]);
  });

  it("2 部署所属ユーザーは両方見える", async () => {
    const rows = await asBot<{ department_id: string }>("UBOTH", SEARCH, [vec(0.01)]);
    expect(rows.length).toBe(3);
  });

  it("未登録ユーザー・set_config 無しは 0 件（安全側）", async () => {
    expect((await asBot("UNOBODY", SEARCH, [vec(0.01)])).length).toBe(0);
    expect((await asBot(null, SEARCH, [vec(0.01)])).length).toBe(0);
  });

  it("documents / user_departments も同じ制御が効く", async () => {
    const docs = await asBot<{ title: string }>("UHR", "select title from documents");
    expect(docs.map((d) => d.title)).toEqual(["エンゲージメント報告書"]);
    const ud = await asBot<{ slack_user_id: string }>("UHR", "select slack_user_id from user_departments");
    expect(ud.every((u) => u.slack_user_id === "UHR")).toBe(true);
  });

  it("bot ロールは chunks を消せない・書けない", async () => {
    await expect(asBot("UIT", "delete from chunks")).rejects.toThrow(/permission denied/i);
    await expect(asBot("UIT", "insert into user_departments values ('UIT','hr')")).rejects.toThrow(/permission denied/i);
  });

  it("監査ログは自分名義だけ書ける", async () => {
    await expect(
      asBot("UHR", "insert into search_logs (slack_user_id, question, department_ids, result_status) values ('UHR','q','{hr}','answered')"),
    ).resolves.toBeDefined();
    await expect(
      asBot("UHR", "insert into search_logs (slack_user_id, question, department_ids, result_status) values ('UIT','q','{hr}','answered')"),
    ).rejects.toThrow(/row-level security/i);
  });
});
