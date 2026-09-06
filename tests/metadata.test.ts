import { describe, it, expect } from "vitest";
import { extractMetadata, resolveDepartment } from "../src/ingest/metadata.js";

describe("resolveDepartment", () => {
  it("日本語名・英語 ID・別名を部署 ID にする", () => {
    expect(resolveDepartment("戦略")).toBe("strategy");
    expect(resolveDepartment("hr")).toBe("hr");
    expect(resolveDepartment("IT")).toBe("it");
    expect(resolveDepartment("総務")).toBe("admin");
    expect(resolveDepartment("経理")).toBeNull();
  });
});

describe("extractMetadata", () => {
  const text = `# 銀行A向け DX 推進提案書（サマリ版）

**部署: 戦略 / 客先: 地方銀行A / 作成: 2024年 / 機密度: 社外秘**

## 1. 案件概要
...`;

  it("冒頭行から部署・客先・年・種別・タイトルを取る", () => {
    const m = extractMetadata(text, "case7-doc1-strategy-dx-bank.pdf", "hr");
    expect(m.departmentId).toBe("strategy"); // 冒頭行がフォルダ名(hr)より優先
    expect(m.departmentSource).toBe("header");
    expect(m.clientName).toBe("地方銀行A");
    expect(m.createdYear).toBe(2024);
    expect(m.docType).toBe("proposal");
    expect(m.title).toBe("銀行A向け DX 推進提案書（サマリ版）");
  });

  it("冒頭行が無ければフォルダ名、それも無ければファイル名から決める", () => {
    expect(extractMetadata("見出しなしの本文です。", "memo.pdf", "人事").departmentId).toBe("hr");
    expect(extractMetadata("見出しなしの本文です。", "memo.pdf", "人事").departmentSource).toBe("folder");
    const byName = extractMetadata("本文", "case7-doc3-it-cloud-migration.pdf", undefined);
    expect(byName.departmentId).toBe("it");
    expect(byName.departmentSource).toBe("filename");
    expect(extractMetadata("本文", "unknown.pdf", undefined).departmentId).toBeNull();
  });
});
