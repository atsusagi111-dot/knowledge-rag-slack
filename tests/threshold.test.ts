import { describe, it, expect } from "vitest";
import { applyThreshold } from "../src/search/threshold.js";
import type { SearchHit } from "../src/search/search.js";

const hit = (score: number): SearchHit => ({
  chunkId: `c${score}`,
  documentId: "d",
  title: "t",
  departmentId: "it",
  createdYear: 2024,
  sectionTitle: null,
  pageStart: 1,
  pageEnd: 1,
  content: "x",
  score,
});

describe("applyThreshold", () => {
  it("結果 0 件なら該当なし", () => {
    expect(applyThreshold([], 0.4).passed).toBe(false);
  });
  it("1 位が閾値未満なら該当なし", () => {
    const d = applyThreshold([hit(0.35), hit(0.3)], 0.4);
    expect(d.passed).toBe(false);
    expect(d.topScore).toBe(0.35);
  });
  it("1 位が閾値以上なら通過し、離れすぎたチャンクは落とす", () => {
    const d = applyThreshold([hit(0.6), hit(0.5), hit(0.42), hit(0.3)], 0.4);
    expect(d.passed).toBe(true);
    expect(d.hits.map((h) => h.score)).toEqual([0.6, 0.5, 0.42]);
  });
});
