/**
 * 権限漏れテスト（実 DB に接続。.env の DATABASE_URL_INGEST / DATABASE_URL_BOT が必要）。
 * テスト専用のユーザー・部署行を作り、終わったら消す。文書は既存のものを使う。
 *
 * 前提: npm run db:migrate 済み、かつ documents/chunks に 2 部署以上の文書が入っていること。
 * 実行: npm run test:rls（既定の npm test には含めない）
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ingestSql, botSql, withSlackUser, closeAll, BOT_SESSION_SQL, toVectorLiteral } from "../../src/db/client.js";
import { config } from "../../src/config.js";
import { searchByVector, getUserDepartments } from "../../src/search/search.js";

const HR_USER = "UTESTHRONLY";
const IT_USER = "UTESTITONLY";
const BOTH_USER = "UTESTHRANDIT";
const NOBODY = "UTESTNOBODY";
const TEST_USERS = [HR_USER, IT_USER, BOTH_USER, NOBODY];
// 検索ベクトルは「何でもよい」ので全て 0.01 のベクトルを使う（RLS の検証が目的）
const anyVec = new Array<number>(config.openai.embeddingDimensions).fill(0.01);

describe("RLS: 部署別アクセス制御（実 DB）", () => {
  let itChunks = 0;
  let hrChunks = 0;

  beforeAll(async () => {
    const sql = ingestSql();
    await sql`delete from user_departments where slack_user_id = any(${TEST_USERS})`;
    await sql`insert into user_departments (slack_user_id, department_id, display_name) values
      (${HR_USER}, 'hr', 'test'), (${IT_USER}, 'it', 'test'), (${BOTH_USER}, 'hr', 'test'), (${BOTH_USER}, 'it', 'test')`;
    [{ n: itChunks }] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where department_id = 'it'`;
    [{ n: hrChunks }] = await sql<{ n: number }[]>`select count(*)::int as n from chunks where department_id = 'hr'`;
  });

  afterAll(async () => {
    await ingestSql()`delete from user_departments where slack_user_id = any(${TEST_USERS})`;
    await ingestSql()`delete from search_logs where slack_user_id = any(${TEST_USERS})`;
    await closeAll();
  });

  it("前提: IT 部と人事部のチャンクが存在する", () => {
    expect(itChunks).toBeGreaterThan(0);
    expect(hrChunks).toBeGreaterThan(0);
  });

  it("人事ユーザーは IT 部の文書を 0 件しか見られない（結果は全て hr）", async () => {
    const hits = await searchByVector(HR_USER, anyVec, 100);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.departmentId === "hr")).toBe(true);
  });

  it("IT ユーザーは IT 部の文書だけ見える", async () => {
    expect((await searchByVector(IT_USER, anyVec, 100)).every((h) => h.departmentId === "it")).toBe(true);
  });

  it("2 部署所属ユーザーは両方見える", async () => {
    const depts = new Set((await searchByVector(BOTH_USER, anyVec, 1000)).map((h) => h.departmentId));
    expect(depts.has("hr") && depts.has("it")).toBe(true);
    expect([...depts].every((x) => x === "hr" || x === "it")).toBe(true);
  });

  it("未登録ユーザーは 0 件", async () => {
    expect(await getUserDepartments(NOBODY)).toEqual([]);
    expect(await searchByVector(NOBODY, anyVec, 100)).toEqual([]);
  });

  it("set_config 無しで bot ロールが読むと 0 件（安全側に倒れる）", async () => {
    const n = await botSql().begin(async (tx) => {
      await tx.unsafe(BOT_SESSION_SQL);
      return (await tx<{ n: number }[]>`select count(*)::int as n from chunks`)[0].n;
    });
    expect(n).toBe(0);
  });

  it("bot ロールは chunks に書き込めない", async () => {
    await expect(withSlackUser(IT_USER, async (tx) => tx`delete from chunks where department_id = 'it'`)).rejects.toThrow(/permission denied/i);
  });

  it("bot ロールは他人名義の監査ログを書けない", async () => {
    await expect(
      withSlackUser(HR_USER, async (tx) => tx`insert into search_logs (slack_user_id, question, department_ids, result_status) values (${IT_USER}, 'x', '{}', 'answered')`),
    ).rejects.toThrow(/row-level security/i);
  });

  it("toVectorLiteral は pgvector が受け付ける形式", async () => {
    const [r] = await ingestSql()`select ${toVectorLiteral([0.1, 0.2])}::vector(2) as v`;
    expect(String(r.v)).toBe("[0.1,0.2]");
  });
});
