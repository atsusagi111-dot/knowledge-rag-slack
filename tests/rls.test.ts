/**
 * 権限漏れテスト（実 DB に接続。.env の DATABASE_URL_INGEST / DATABASE_URL_BOT が必要）。
 * テスト専用のユーザー・部署行を作り、終わったら消す。文書は既存のものを使う。
 *
 * 前提: npm run db:migrate 済み、かつ documents/chunks に 2 部署以上の文書が入っていること。
 * 実行: npm run test:rls
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ingestSql, botSql, withSlackUser, closeAll } from "../src/db/client.js";
import { searchByVector, getUserDepartments } from "../src/search/search.js";

const HR_USER = "UTESTHRONLY";
const IT_USER = "UTESTITONLY";
const BOTH_USER = "UTESTHRANDIT";
const NOBODY = "UTESTNOBODY";

const hasDb = Boolean(process.env.DATABASE_URL_INGEST && process.env.DATABASE_URL_BOT);
const d = hasDb ? describe : describe.skip;

d("RLS: 部署別アクセス制御", () => {
  let zeroVec: number[];
  let itDocCount = 0;
  let hrDocCount = 0;

  beforeAll(async () => {
    const sql = ingestSql();
    await sql`delete from user_departments where slack_user_id in (${HR_USER}, ${IT_USER}, ${BOTH_USER}, ${NOBODY})`;
    await sql`insert into user_departments (slack_user_id, department_id, display_name) values
      (${HR_USER}, 'hr', 'test'), (${IT_USER}, 'it', 'test'), (${BOTH_USER}, 'hr', 'test'), (${BOTH_USER}, 'it', 'test')`;
    [{ n: itDocCount }] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where department_id = 'it'`;
    [{ n: hrDocCount }] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where department_id = 'hr'`;
    // 検索ベクトルは「何でもよい」ので全て 0.01 のベクトルを使う（RLS の検証が目的）
    zeroVec = Array.from({ length: 1536 }, () => 0.01);
  });

  afterAll(async () => {
    await ingestSql()`delete from user_departments where slack_user_id in (${HR_USER}, ${IT_USER}, ${BOTH_USER}, ${NOBODY})`;
    await ingestSql()`delete from search_logs where slack_user_id in (${HR_USER}, ${IT_USER}, ${BOTH_USER}, ${NOBODY})`;
    await closeAll();
  });

  it("前提: IT 部と人事部のチャンクが存在する", () => {
    expect(itDocCount).toBeGreaterThan(0);
    expect(hrDocCount).toBeGreaterThan(0);
  });

  it("人事ユーザーは IT 部の文書を 0 件しか見られない（結果は全て hr）", async () => {
    const hits = await searchByVector(HR_USER, zeroVec, 100);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.departmentId === "hr")).toBe(true);
    expect(hits.some((h) => h.departmentId === "it")).toBe(false);
  });

  it("IT ユーザーは IT 部の文書だけ見える", async () => {
    const hits = await searchByVector(IT_USER, zeroVec, 100);
    expect(hits.every((h) => h.departmentId === "it")).toBe(true);
  });

  it("2 部署所属ユーザーは両方見える", async () => {
    const hits = await searchByVector(BOTH_USER, zeroVec, 1000);
    const depts = new Set(hits.map((h) => h.departmentId));
    expect(depts.has("hr")).toBe(true);
    expect(depts.has("it")).toBe(true);
    expect([...depts].every((x) => x === "hr" || x === "it")).toBe(true);
  });

  it("未登録ユーザーは 0 件", async () => {
    expect(await getUserDepartments(NOBODY)).toEqual([]);
    expect(await searchByVector(NOBODY, zeroVec, 100)).toEqual([]);
  });

  // ローカル PGlite（DB_BOT_SET_ROLE 指定時）は bot 接続も管理者なので、この検証は Supabase でのみ有効
  it.skipIf(Boolean(process.env.DB_BOT_SET_ROLE))("set_config 無しで bot ロールが読むと 0 件（安全側に倒れる）", async () => {
    const rows = await botSql()`select count(*)::int as n from chunks`;
    expect(rows[0].n).toBe(0);
  });

  it("bot ロールは chunks に書き込めない", async () => {
    await expect(
      withSlackUser(IT_USER, async (tx) => {
        await tx`delete from chunks where department_id = 'it'`;
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("bot ロールは他人名義の監査ログを書けない", async () => {
    await expect(
      withSlackUser(HR_USER, async (tx) => {
        await tx`insert into search_logs (slack_user_id, question, department_ids, result_status)
                 values (${IT_USER}, 'x', '{}', 'answered')`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });
});
