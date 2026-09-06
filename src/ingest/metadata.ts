/**
 * 文書のメタデータ（部署・客先・作成年・文書種別・タイトル）を推定する。
 * 優先順位:
 *   1. 本文冒頭の「部署: 戦略 / 客先: 地方銀行A / 作成: 2024年 / 機密度: 社外秘」行
 *   2. フォルダ名（departmentHint）
 *   3. ファイル名に含まれる部署キーワード（strategy / hr など）
 */
import { DEPARTMENT_IDS, DEPARTMENT_NAME_JA, type DepartmentId } from "../config.js";

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

const JA_TO_ID: Record<string, DepartmentId> = Object.fromEntries(
  DEPARTMENT_IDS.map((id) => [DEPARTMENT_NAME_JA[id], id]),
) as Record<string, DepartmentId>;

// 英語 ID・日本語名・よくある別名 → 部署 ID
const ALIASES: Record<string, DepartmentId> = {
  ...JA_TO_ID,
  ...Object.fromEntries(DEPARTMENT_IDS.map((id) => [id, id])),
  戦略部: "strategy",
  業務部: "operations",
  ops: "operations",
  it部: "it",
  情報システム: "it",
  人事部: "hr",
  営業部: "sales",
  管理部: "admin",
  総務: "admin",
};

export function resolveDepartment(raw: string | undefined | null): DepartmentId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (ALIASES[key]) return ALIASES[key];
  // 「人事 / 客先」のように余分な語が付いている場合、先頭の語で再判定
  const head = key.split(/[\s/／:：]/)[0];
  return ALIASES[head] ?? null;
}

export function extractMetadata(
  fullText: string,
  fileName: string,
  departmentHint?: string,
): DocumentMetadata {
  const head = fullText.slice(0, 1500);

  // --- 冒頭行の「部署: xx / 客先: yy / 作成: 2024年」 ---
  const deptMatch = head.match(/部署\s*[:：]\s*([^/／\n*]+)/);
  const clientMatch = head.match(/客先\s*[:：]\s*([^/／\n*]+)/);
  const yearMatch = head.match(/作成\s*[:：]\s*(\d{4})\s*年?/) ?? head.match(/(20\d{2})\s*年/);

  let departmentId: DepartmentId | null = null;
  let departmentSource: DocumentMetadata["departmentSource"] = "none";

  const fromHeader = resolveDepartment(deptMatch?.[1]);
  if (fromHeader) {
    departmentId = fromHeader;
    departmentSource = "header";
  } else {
    const fromFolder = resolveDepartment(departmentHint);
    if (fromFolder) {
      departmentId = fromFolder;
      departmentSource = "folder";
    } else {
      const lower = fileName.toLowerCase();
      const hit = DEPARTMENT_IDS.find((id) => lower.includes(`-${id}-`) || lower.includes(`_${id}_`));
      if (hit) {
        departmentId = hit;
        departmentSource = "filename";
      }
    }
  }

  return {
    title: extractTitle(head, fileName),
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
    .find((l) => l.length >= 4 && !l.startsWith("部署"));
  return (firstLine ?? fileName).slice(0, 120);
}

function detectDocType(head: string, fileName: string): DocType {
  const s = `${head.slice(0, 200)} ${fileName}`.toLowerCase();
  if (/提案書|proposal/.test(s)) return "proposal";
  if (/報告書|レポート|report/.test(s)) return "report";
  return "other";
}
