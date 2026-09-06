import { describe, it, expect } from "vitest";
import path from "node:path";
import { parseCsv } from "../src/lib/csv.js";
import { htmlToText, normalize } from "../src/ingest/extract.js";
import { LocalFolderSource } from "../src/sources/LocalFolderSource.js";
import { stripMention } from "../src/slack/handlers.js";
import { formatAnswer } from "../src/slack/format.js";
import { buildCitations } from "../src/search/answer.js";
import { toVectorLiteral } from "../src/db/client.js";
import { makeHit } from "./fixtures.js";

describe("parseCsv", () => {
  it("ヘッダ付き CSV をオブジェクト配列にする（クォート・改行セル対応）", () => {
    const rows = parseCsv('a,b\r\n1,"x, y"\n2,"複数\n行"\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y" },
      { a: "2", b: "複数\n行" },
    ]);
  });
  it("BOM と空行を無視する", () => {
    expect(parseCsv("﻿a,b\n\n1,2\n")).toEqual([{ a: "1", b: "2" }]);
  });
});

describe("extract", () => {
  it("HTML の見出し・箇条書きをテキストに直す", () => {
    const t = normalize(htmlToText("<h2>4. ROI 試算</h2><p>本文です。</p><ul><li>項目A</li><li>項目B</li></ul>"));
    expect(t).toContain("## 4. ROI 試算");
    expect(t).toContain("- 項目A");
    expect(t).toContain("本文です。");
  });
  it("NFKC 正規化で互換文字と全角英数を直す", () => {
    expect(normalize("⾏内⼈材 ＡＢＣ １２３")).toBe("行内人材 ABC 123");
  });
});

describe("LocalFolderSource", () => {
  it("部署フォルダを辿り、pdf/docx だけ列挙する", async () => {
    const src = new LocalFolderSource(path.resolve("data/docs"));
    const files = [];
    for await (const f of src.list()) files.push(f);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.fileType === "pdf" || f.fileType === "docx")).toBe(true);
    expect(files.every((f) => f.departmentHint && !f.path.includes("\\"))).toBe(true);
    const buf = await src.read(files[0]);
    expect(buf.length).toBeGreaterThan(100);
  });
});

describe("slack", () => {
  it("メンションを取り除く", () => {
    expect(stripMention("<@U012ABC> 銀行 DX の ROI は？")).toBe("銀行 DX の ROI は？");
  });
  it("回答を Block Kit に整形し、出典を並べる", () => {
    const hits = [makeHit({ chunkId: "c1", score: 0.61 })];


    const citations = buildCitations(hits);
    expect(citations[0]).toMatchObject({ n: 1, department: "戦略", page: "p.2" });
    const out = formatAnswer({ status: "answered", text: "年間 1.2 億円 [1]", citations, hits, topScore: 0.61, latencyMs: 800, model: "gpt-5-nano" });
    expect(out.blocks.length).toBe(4);
    expect(JSON.stringify(out.blocks)).toContain("銀行A向け DX 提案書");
  });
});

describe("toVectorLiteral", () => {
  it("pgvector の文字列形式にする", () => {
    expect(toVectorLiteral([0.1, -0.2, 3, 0.123456789])).toBe("[0.1,-0.2,3,0.1234568]");
  });
});
