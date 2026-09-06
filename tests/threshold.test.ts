import { describe, it, expect } from "vitest";
import { applyThreshold } from "../src/search/threshold.js";
import { makeHit } from "./fixtures.js";

const hits = (...scores: number[]) => scores.map((score) => makeHit({ score }));

describe("applyThreshold", () => {
  it("結果 0 件なら該当なし", () => {
    expect(applyThreshold([], 0.4).passed).toBe(false);
  });
  it("1 位が閾値未満なら該当なし", () => {
    const d = applyThreshold(hits(0.35, 0.3), 0.4);
    expect(d.passed).toBe(false);
    expect(d.topScore).toBe(0.35);
  });
  it("1 位が閾値以上なら通過し、離れすぎたチャンク（差 0.25 超）は落とす", () => {
    const d = applyThreshold(hits(0.6, 0.5, 0.42, 0.3), 0.4);
    expect(d.passed).toBe(true);
    expect(d.hits.map((h) => h.score)).toEqual([0.6, 0.5, 0.42]);
  });
});
