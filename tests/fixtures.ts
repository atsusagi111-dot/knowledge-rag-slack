import type { SearchHit } from "../src/search/search.js";

/** テスト用の検索結果 1 件。必要な項目だけ上書きする */
export function makeHit(overrides: Partial<SearchHit> = {}): SearchHit {
  return {
    chunkId: `c${overrides.score ?? 0.5}`,
    documentId: "d1",
    title: "銀行A向け DX 提案書",
    fileName: "case7-doc1-strategy-dx-bank.pdf",
    departmentId: "strategy",
    sectionTitle: "4. ROI 試算",
    pageStart: 2,
    pageEnd: 2,
    content: "窓口handling時間 18分 → 9分（50%削減）により、年間およそ1.2億円の人件費削減効果",
    score: 0.5,
    ...overrides,
  };
}
