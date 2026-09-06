/**
 * 回答生成の流れを、DB と OpenAI を偽物に差し替えて検証する。
 *  - 未登録ユーザー → unregistered
 *  - 閾値未満 → no_hit（LLM を呼ばない）
 *  - LLM が NO_ANSWER → no_hit
 *  - LLM が出典番号無しで答えた → no_hit（ハルシネーション対策 2 段目）
 *  - 正常 → answered + 出典
 */
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { answerQuestion, setChatFn, NO_HIT_MESSAGE } from "../src/search/answer.js";
import { setSearchOverride, type SearchHit, type SearchResult } from "../src/search/search.js";

const hit = (score: number, title = "銀行A向け DX 提案書"): SearchHit => ({
  chunkId: `c${score}`,
  documentId: "d1",
  title,
  departmentId: "strategy",
  createdYear: 2024,
  sectionTitle: "4. ROI 試算",
  pageStart: 2,
  pageEnd: 2,
  content: "窓口handling時間 18分 → 9分（50%削減）により、年間およそ1.2億円の人件費削減効果",
  score,
});

let calls = 0;
function mockSearch(result: SearchResult) {
  setSearchOverride(async () => result);
}
function mockChat(reply: string) {
  setChatFn(async () => {
    calls++;
    return reply;
  });
}

beforeEach(() => {
  calls = 0;
  process.env.SIMILARITY_THRESHOLD = "0.40";
});
afterEach(() => {
  setSearchOverride(undefined);
  setChatFn(undefined);
});

const opts = { skipLog: true };

describe("answerQuestion", () => {
  it("未登録ユーザーは unregistered", async () => {
    mockSearch({ hits: [], departmentIds: [], unregistered: true });
    mockChat("x");
    const r = await answerQuestion("U1", "q", opts);
    expect(r.status).toBe("unregistered");
    expect(calls).toBe(0);
  });

  it("閾値未満なら LLM を呼ばず no_hit", async () => {
    mockSearch({ hits: [hit(0.31)], departmentIds: ["strategy"], unregistered: false });
    mockChat("x");
    const r = await answerQuestion("U1", "医療業界向けの提案書は？", opts);
    expect(r.status).toBe("no_hit");
    expect(r.text).toBe(NO_HIT_MESSAGE);
    expect(r.topScore).toBe(0.31);
    expect(calls).toBe(0);
  });

  it("LLM が NO_ANSWER を返したら no_hit", async () => {
    mockSearch({ hits: [hit(0.55)], departmentIds: ["strategy"], unregistered: false });
    mockChat("NO_ANSWER");
    const r = await answerQuestion("U1", "q", opts);
    expect(r.status).toBe("no_hit");
    expect(calls).toBe(1);
  });

  it("出典番号が無い回答は no_hit 扱い（でっち上げ防止）", async () => {
    mockSearch({ hits: [hit(0.55)], departmentIds: ["strategy"], unregistered: false });
    mockChat("おそらく 5 億円くらい削減できます。");
    const r = await answerQuestion("U1", "q", opts);
    expect(r.status).toBe("no_hit");
  });

  it("正常時は answered と出典が返る", async () => {
    mockSearch({ hits: [hit(0.62), hit(0.58), hit(0.2)], departmentIds: ["strategy"], unregistered: false });
    mockChat("窓口時間の半減で年間約 1.2 億円の人件費削減が見込まれます [1]。");
    const r = await answerQuestion("U1", "人件費はどれくらい削減？", opts);
    expect(r.status).toBe("answered");
    expect(r.text).toContain("[1]");
    // 0.2 のチャンクは 1 位から離れすぎているので出典に含まれない
    expect(r.citations.length).toBe(2);
    expect(r.citations[0]).toMatchObject({ n: 1, department: "戦略", page: "p.2" });
    expect(r.hits.length).toBe(3);
  });

  it("LLM がエラーを投げたら error", async () => {
    mockSearch({ hits: [hit(0.6)], departmentIds: ["strategy"], unregistered: false });
    setChatFn(async () => {
      throw new Error("rate limit");
    });
    const r = await answerQuestion("U1", "q", opts);
    expect(r.status).toBe("error");
    expect(r.text).toContain("rate limit");
  });
});
