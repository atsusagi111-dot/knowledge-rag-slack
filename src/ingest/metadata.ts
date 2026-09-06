/**
 * 文書のメタデータ（部署・客先・作成年・文書種別・タイトル）を推定する。
 * 部署の優先順位:
 *   1. 本文冒頭の「部署: 戦略 / 客先: 地方銀行A / 作成: 2024年 / 機密度: 社外秘」行
 *   2. フォルダ名（departmentHint）
 *   3. ファイル名に含まれる部署キーワード（-strategy- / _hr_ など）
 */
import { DEPARTMENT_IDS, resolveDepartment, type DepartmentId } from "../config.js";

export { resolveDepartment };

export type DocType = "proposal" | "report" | "other";

export interface DocumentMetadata {
  title: string;
  departmentId: DepartmentId | null;
  /** どの方法で部署を決めたか（ログ・デバッグ用） */
  departmentSource: "header" | "folder" | "filename" | "none";
  clientName: string | null;
  createdYear: number | null;
  docType: DocType;
}

const HEADER_LINE = /^.*部署\s*[:：].*$/m;

export function extractMetadata(fullText: string, fileName: string, departmentHint?: string): DocumentMetadata {
  const head = fullText.slice(0, 1500);
  const headerLine = head.match(HEADER_LINE)?.[0] ?? "";
  const deptMatch = headerLine.match(/部署\s*[:：]\s*([^/／\n*]+)/);
  const clientMatch = headerLine.match(/客先\s*[:：]\s*([^/／\n*]+)/);
  const yearMatch = headerLine.match(/作成\s*[:：]\s*(\d{4})\s*年?/) ?? head.match(/(20\d{2})\s*年/);
  const lower = fileName.toLowerCase();

  const candidates: [DocumentMetadata["departmentSource"], DepartmentId | null][] = [
    ["header", resolveDepartment(deptMatch?.[1])],
    ["folder", resolveDepartment(departmentHint)],
    ["filename", DEPARTMENT_IDS.find((id) => lower.includes(`-${id}-`) || lower.includes(`_${id}_`)) ?? null],
  ];
  const [departmentSource, departmentId] = candidates.find(([, id]) => id) ?? ["none", null];

  return {
    // メタデータ行はタイトル候補から除く（行の並び順に依存しない）
    title: extractTitle(head.replace(headerLine, ""), fileName),
    departmentId,
    departmentSource,
    clientName: clientMatch?.[1]?.trim() ?? null,
    createdYear: yearMatch ? Number(yearMatch[1]) : null,
    docType: detectDocType(head, fileName),
  };
}

function extractTitle(head: string, fileName: string): string {
  // Markdown 見出し "# タイトル" または 最初の非空行
  const md = head.match(/^\s*#\s+(.+)$/m);
  if (md) return md[1].trim();
  const firstLine = head
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length >= 4);
  return (firstLine ?? fileName).slice(0, 120);
}

function detectDocType(head: string, fileName: string): DocType {
  const s = `${head.slice(0, 200)} ${fileName}`.toLowerCase();
  if (/提案書|proposal/.test(s)) return "proposal";
  if (/報告書|レポート|report/.test(s)) return "report";
  return "other";
}
