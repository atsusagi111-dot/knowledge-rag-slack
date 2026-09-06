/**
 * セクション（見出し）単位のチャンキング。
 *  1. 見出し行（"## 4. ROI 試算", "4. ROI 試算", "第2章 ..." など）でセクションに分ける
 *  2. 小さすぎるセクションは次と結合、大きすぎるセクションは段落単位で分割（重なり付き）
 *  3. 各チャンクの先頭に「文書タイトル > 見出し」を付け、セクション名・ページ範囲・トークン数を持たせる
 * トークン数は OpenAI と同じ cl100k_base（js-tiktoken）で数える。
 * Word は見出しスタイルが "#" として届くので確実。PDF は見た目の情報が無いため、番号付き見出しの正規表現で代用する。
 */
import { getEncoding } from "js-tiktoken";
import { config } from "../config.js";
import type { ExtractedPage } from "./extract.js";

const enc = getEncoding("cl100k_base");

export interface Chunk {
  index: number;
  sectionTitle: string | null;
  pageStart: number;
  pageEnd: number;
  content: string;
  tokenCount: number;
}

export function countTokens(text: string): number {
  return enc.encode(text).length;
}

// 見出しとみなす行のパターン
const HEADING_PATTERNS = [
  /^#{1,6}\s+\S/, // Markdown
  /^(?:第\s*\d+\s*[章節項]|\d+(?:\.\d+)*[.．)]?\s+\S|[（(]?\d+[）)]\s*\S|[IVX]+\.\s+\S|[①-⑳]\s*\S)/, // 番号付き
  // 記号付き。● ○ は Word→PDF 変換で箇条書きの点になるため見出し扱いしない（36 件検証で断片化が発生）
  /^[■□◆◇▼▶]\s*\S/,
];

export function isHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (/[。．]$/.test(t)) return false; // 文末が句点なら本文
  return HEADING_PATTERNS.some((re) => re.test(t));
}

function cleanHeading(line: string): string {
  return line.replace(/^#{1,6}\s+/, "").replace(/[*_]/g, "").trim();
}

interface Section {
  title: string | null;
  pageStart: number;
  pageEnd: number;
  paragraphs: string[];
  /** paragraphs 全体のトークン数（結合判定のためのキャッシュ） */
  tokens: number;
}

/** ページ配列 → セクション配列 */
function splitSections(pages: ExtractedPage[]): Section[] {
  const sections: Section[] = [];
  const firstPage = pages[0]?.page ?? 1;
  let current: Section = { title: null, pageStart: firstPage, pageEnd: firstPage, paragraphs: [], tokens: 0 };
  let buffer: string[] = [];

  const flushParagraph = () => {
    const text = buffer.join("\n").trim();
    if (text) {
      current.paragraphs.push(text);
      current.tokens += countTokens(text);
    }
    buffer = [];
  };
  const pushCurrent = () => {
    if (current.paragraphs.length > 0 || current.title) sections.push(current);
  };

  for (const page of pages) {
    for (const rawLine of page.text.split("\n")) {
      const line = rawLine.trim();
      if (isHeading(line)) {
        flushParagraph();
        pushCurrent();
        current = { title: cleanHeading(line), pageStart: page.page, pageEnd: page.page, paragraphs: [], tokens: 0 };
        continue;
      }
      if (line === "") flushParagraph();
      else buffer.push(line);
      current.pageEnd = page.page;
    }
    flushParagraph();
  }
  pushCurrent();
  return sections;
}

/** 長いテキストをトークン上限で段落単位に分割。段落自体が長ければ文で切る。各単位は 1 回だけトークン化する */
function splitLong(text: string, maxTokens: number, overlapTokens: number): string[] {
  const units = text
    .split(/\n+/)
    .flatMap((p) => (countTokens(p) > maxTokens ? p.split(/(?<=[。．！？!?])/) : [p]))
    .map((t) => ({ text: t, tokens: countTokens(t) }));
  const out: string[] = [];
  let cur: typeof units = [];
  let curTokens = 0;
  for (const u of units) {
    if (curTokens + u.tokens > maxTokens && cur.length > 0) {
      out.push(cur.map((c) => c.text).join("\n"));
      // 重なり: 直前の末尾から overlapTokens 以内に収まる分だけ残す（大きな段落を丸ごと繰り返さない）
      const tail: typeof units = [];
      let tailTokens = 0;
      for (let i = cur.length - 1; i >= 0 && tailTokens + cur[i].tokens <= overlapTokens; i--) {
        tail.unshift(cur[i]);
        tailTokens += cur[i].tokens;
      }
      cur = tail;
      curTokens = tailTokens;
    }
    cur.push(u);
    curTokens += u.tokens;
  }
  if (cur.length > 0) out.push(cur.map((c) => c.text).join("\n"));
  return out;
}

/**
 * @param docTitle 文書タイトル。指定すると各チャンクの先頭に「タイトル > 見出し」を付けて Embedding する（文脈付きチャンク）。
 *   数値中心のセクション（ROI 試算など）に文書名の手がかりが無く、「○○向け提案の…」という質問で拾えなかった問題への対策。
 */
export function chunkPages(pages: ExtractedPage[], opts = config.chunk, docTitle?: string): Chunk[] {
  // 小さいセクションは次に結合
  const merged: Section[] = [];
  for (const s of splitSections(pages)) {
    const prev = merged[merged.length - 1];
    if (prev && prev.tokens < opts.minTokens && prev.tokens + s.tokens <= opts.maxTokens) {
      if (s.title) prev.paragraphs.push(s.title);
      prev.paragraphs.push(...s.paragraphs);
      prev.tokens += s.tokens;
      prev.pageEnd = s.pageEnd;
      prev.title ??= s.title;
    } else {
      merged.push(s);
    }
  }

  const chunks: Chunk[] = [];
  for (const s of merged) {
    const body = s.paragraphs.join("\n");
    const pieces = s.tokens <= opts.maxTokens ? [body] : splitLong(body, opts.maxTokens, opts.overlapTokens);
    const header = [docTitle, s.title].filter(Boolean).join(" > ");
    for (const piece of pieces) {
      const content = header ? `${header}\n${piece}` : piece;
      if (content.trim().length === 0) continue;
      chunks.push({
        index: chunks.length,
        sectionTitle: s.title,
        pageStart: s.pageStart,
        pageEnd: s.pageEnd,
        content,
        tokenCount: countTokens(content),
      });
    }
  }
  return chunks;
}
