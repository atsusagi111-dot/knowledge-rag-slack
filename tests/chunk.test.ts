import { describe, it, expect } from "vitest";
import { chunkPages, isHeading, countTokens } from "../src/ingest/chunk.js";

describe("isHeading", () => {
  it("Markdown・番号付き・記号付き見出しを認識する", () => {
    expect(isHeading("## 4. ROI 試算")).toBe(true);
    expect(isHeading("4. ROI 試算")).toBe(true);
    expect(isHeading("第2章 現状の課題")).toBe(true);
    expect(isHeading("■ アプローチ")).toBe(true);
  });
  it("本文行は見出しにしない", () => {
    expect(isHeading("窓口handling時間が1件あたり平均18分と長く、来店客の待ち時間が課題。")).toBe(false);
    expect(isHeading("")).toBe(false);
    expect(isHeading("- フェーズ1: 窓口タブレット導入")).toBe(false);
  });
});

describe("chunkPages", () => {
  const pages = [
    {
      page: 1,
      text: [
        "# 銀行A向け DX 推進提案書",
        "**部署: 戦略 / 客先: 地方銀行A / 作成: 2024年**",
        "",
        "## 1. 案件概要",
        "地方銀行Aの基幹業務におけるDX推進を支援する。",
        "",
        "## 2. 現状の課題",
        "- 窓口handling時間が1件あたり平均18分と長い",
        "- 各支店の業務データがサイロ化している",
      ].join("\n"),
    },
    {
      page: 2,
      text: ["## 4. ROI 試算", "- 窓口handling時間 18分 → 9分（50%削減）により、年間およそ1.2億円の人件費削減効果", "- 初期投資の回収期間は約2.5年と試算"].join("\n"),
    },
  ];

  it("見出しごとにセクション名とページが付く", () => {
    const chunks = chunkPages(pages, { maxTokens: 500, overlapTokens: 50, minTokens: 0 });
    const titles = chunks.map((c) => c.sectionTitle);
    expect(titles).toContain("4. ROI 試算");
    const roi = chunks.find((c) => c.sectionTitle === "4. ROI 試算")!;
    expect(roi.pageStart).toBe(2);
    expect(roi.content).toContain("1.2億円");
    expect(roi.tokenCount).toBe(countTokens(roi.content));
  });

  it("小さいセクションは結合され、上限トークンを超えない", () => {
    const chunks = chunkPages(pages, { maxTokens: 500, overlapTokens: 50, minTokens: 80 });
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(500 + 30);
    expect(chunks.length).toBeLessThan(5);
  });

  it("大きな段落は重なりとして丸ごと繰り返されない（重なりは overlapTokens 以内）", () => {
    const para = (i: number) => `段落${i}。` + "これは長い段落の文章です。".repeat(40);
    const long = { page: 1, text: "## 章\n" + [1, 2, 3, 4].map(para).join("\n") };
    const chunks = chunkPages([long], { maxTokens: 500, overlapTokens: 50, minTokens: 0 });
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(500 + 60);
  });

  it("長いセクションは重なり付きで分割される", () => {
    const long = { page: 1, text: "## 長い章\n" + Array.from({ length: 60 }, (_, i) => `段落${i}。これは分割テスト用の文章で、内容はダミーです。`).join("\n") };
    const chunks = chunkPages([long], { maxTokens: 200, overlapTokens: 40, minTokens: 0 });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(260);
    // 2 つ目のチャンクは 1 つ目の末尾を含む（重なり）
    const tail = chunks[0].content.split("\n").at(-1)!;
    expect(chunks[1].content).toContain(tail);
  });
});
