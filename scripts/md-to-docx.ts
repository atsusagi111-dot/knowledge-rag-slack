/**
 * Markdown → Word(.docx) 変換（サンプル文書作成の補助ツール）。
 *   npx tsx scripts/md-to-docx.ts <input.md> [output.docx]
 *   npx tsx scripts/md-to-docx.ts <folder>          → フォルダ内の *.md を全部変換（同じ場所に .docx を作る）
 * 対応する記法: # 見出し / - 箇条書き / **太字**（太字は装飾のみ） / 通常段落
 */
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";

const HEADING: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

function runs(text: string): TextRun[] {
  // **太字** を分解
  const parts = text.split(/(\*\*[^*]+\*\*)/);
  return parts
    .filter((p) => p.length > 0)
    .map((p) => (p.startsWith("**") ? new TextRun({ text: p.slice(2, -2), bold: true }) : new TextRun(p)));
}

export function markdownToParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const h = line.match(/^(#{1,4})\s+(.+)$/);
    if (h) {
      out.push(new Paragraph({ text: h[2].trim(), heading: HEADING[h[1].length] }));
      continue;
    }
    if (/^>\s?/.test(line)) {
      out.push(new Paragraph({ children: runs(line.replace(/^>\s?/, "")), style: "IntenseQuote" }));
      continue;
    }
    const li = line.match(/^\s*[-*]\s+(.+)$/);
    if (li) {
      out.push(new Paragraph({ children: runs(li[1]), bullet: { level: 0 } }));
      continue;
    }
    out.push(new Paragraph({ children: runs(line) }));
  }
  return out;
}

async function convertFile(input: string, output?: string) {
  const md = await readFile(input, "utf8");
  const doc = new Document({ sections: [{ children: markdownToParagraphs(md) }] });
  const buf = await Packer.toBuffer(doc);
  const out = output ?? input.replace(/\.md$/i, ".docx");
  await writeFile(out, buf);
  console.log(`${input} → ${out}`);
}

async function main() {
  const [input, output] = process.argv.slice(2);
  if (!input) throw new Error("使い方: npx tsx scripts/md-to-docx.ts <input.md | フォルダ> [output.docx]");
  if ((await stat(input)).isDirectory()) {
    for (const f of await readdir(input)) if (f.toLowerCase().endsWith(".md")) await convertFile(path.join(input, f));
  } else {
    await convertFile(input, output);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
