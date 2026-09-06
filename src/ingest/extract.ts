/**
 * PDF / Word からテキストを取り出す。
 * 結果は「ページごとのテキスト」の配列。Word にはページ概念が無いので 1 ページ扱い。
 * Word は見出しスタイルを "## " 記法に変換して、chunk.ts が見出しを認識できるようにする。
 */
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";
import type { FileType } from "../sources/DocumentSource.js";

export interface ExtractedPage {
  /** 1 始まり */
  page: number;
  text: string;
}

export interface ExtractedText {
  pages: ExtractedPage[];
  /** 全ページを結合した本文（メタデータ抽出・ハッシュ用） */
  fullText: string;
}

export async function extractText(buffer: Buffer, fileType: FileType): Promise<ExtractedText> {
  const pages = fileType === "pdf" ? await extractPdf(buffer) : await extractDocx(buffer);
  const cleaned = pages.map((p) => ({ page: p.page, text: normalize(p.text) })).filter((p) => p.text.length > 0);
  return { pages: cleaned, fullText: cleaned.map((p) => p.text).join("\n\n") };
}

async function extractPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => ({ page: p.num, text: p.text }));
  } finally {
    await parser.destroy();
  }
}

async function extractDocx(buffer: Buffer): Promise<ExtractedPage[]> {
  // HTML に変換してから、見出し <h1>〜<h6> を Markdown 風の "#" に、段落・箇条書きを改行に直す
  const result = await mammoth.convertToHtml({ buffer });
  return [{ page: 1, text: htmlToText(result.value) }];
}

export function htmlToText(html: string): string {
  return html
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, body: string) => `\n\n${"#".repeat(Number(level))} ${stripTags(body)}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, body: string) => `\n- ${stripTags(body)}`)
    .replace(/<\/(p|div|tr|table|ul|ol)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, "").trim();
}

/**
 * 空白・改行の揺れをそろえる。
 * NFKC 正規化: PDF から取れる「⾏」「⼤」のような互換文字（CJK 部首）を通常の漢字に直し、
 * 全角英数字を半角にする。これをしないと Embedding が別の文字として扱い、検索精度が落ちる。
 */
export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t　]+\n/g, "\n") // 行末の空白
    .replace(/\n{3,}/g, "\n\n") // 3 連続以上の改行は 2 つに
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\\([#*_\-.])/g, "$1") // mammoth が付けるエスケープを外す
    .trim();
}
