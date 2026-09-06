/**
 * 回答生成の流れを、検索と LLM を引数で差し替えて検証する（DB も OpenAI も使わない）。
 *  - 未登録ユーザー → unregistered
 *  - 閾値未満 → no_hit（LLM を呼ばない）
 *  - LLM が NO_ANSWER → no_hit
 *  - LLM が出典番号無しで答えた → no_hit（ハルシネーション対策 2 段目）
 *  - 正常 → answered + 出典
 */
import { describe, it, expect } from "vitest";
import { answerQuestion, NO_HIT_MESSAGE, type AnswerDeps } from "../src/search/answer.js";
import type { SearchResult } from "../src/search/search.js";
import { makeHit } from "./fixtures.js";

function deps(result: SearchResult, reply: string | Error): AnswerDeps & { calls: () => number } {
  let calls = 0;
  return {
    search: async () => result,
    chat: async () => {
      calls++;
      if (reply instanceof Error) throw reply;
      return reply;
    },
    calls: () => calls,
  };
}
const found = (...scores: number[]): SearchResult => ({ hits: scores.map((score) => makeHit({ score })), departmentIds: ["strategy"], unregistered: false });
const opts = (d: AnswerDeps) => ({ skipLog: true, deps: d });

describe("answerQuestion", () => {
  it("未登録ユーザーは unregistered", async () => {
    const d = deps({ hits: [], departmentIds: [], unregistered: true }, "x");
    expect((await answerQuestion("U1", "q", opts(d))).status).toBe("unregistered");
    expect(d.calls()).toBe(0);
  });

  it("閾値未満なら LLM を呼ばず no_hit", async () => {
    const d = deps(found(0.31), "x");
    const r = await answerQuestion("U1", "医療業界向けの提案書は？", opts(d));
    expect(r.status).toBe("no_hit");
    expect(r.text).toBe(NO_HIT_MESSAGE);
    expect(r.topScore).toBe(0.31);
    expect(d.calls()).toBe(0);
  });

  it("LLM が NO_ANSWER を返したら no_hit", async () => {
    const d = deps(found(0.55), "NO_ANSWER");
    expect((await answerQuestion("U1", "q", opts(d))).status).toBe("no_hit");
    expect(d.calls()).toBe(1);
  });

  it("出典番号が無い回答は no_hit 扱い（でっち上げ防止）", async () => {
    const d = deps(found(0.55), "おそらく 5 億円くらい削減できます。");
    expect((await answerQuestion("U1", "q", opts(d))).status).toBe("no_hit");
  });

  it("正常時は answered と出典が返る", async () => {
    const d = deps(found(0.62, 0.58, 0.2), "窓口時間の半減で年間約 1.2 億円の人件費削減が見込まれます [1]。");
    const r = await answerQuestion("U1", "人件費はどれくらい削減？", opts(d));
    expect(r.status).toBe("answered");
    expect(r.text).toContain("[1]");
    // 0.2 のチャンクは 1 位から離れすぎているので出典に含まれない
    expect(r.citations.length).toBe(2);
    expect(r.citations[0]).toMatchObject({ n: 1, department: "戦略", page: "p.2" });
    expect(r.citations[0].label).toContain("case7-doc1-strategy-dx-bank.pdf p.2");
    expect(r.hits.length).toBe(3);
  });

  it("LLM がエラーを投げたら error", async () => {
    const d = deps(found(0.6), new Error("rate limit"));
    const r = await answerQuestion("U1", "q", opts(d));
    expect(r.status).toBe("error");
    expect(r.text).toContain("rate limit");
  });
});
