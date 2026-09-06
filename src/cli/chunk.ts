/** チャンク分割テスト:  npm run chunk -- data/docs/strategy/xxx.pdf [--full] */
import { readFile } from "node:fs/promises";
import { extractText } from "../ingest/extract.js";
import { chunkPages } from "../ingest/chunk.js";
import { fileTypeFromName } from "../sources/DocumentSource.js";

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const full = args.includes("--full");
  if (!file) throw new Error("使い方: npm run chunk -- <pdf または docx のパス> [--full]");
  const type = fileTypeFromName(file);
  if (!type) throw new Error("pdf か docx を指定してください");
  const ex = await extractText(await readFile(file), type);
  const chunks = chunkPages(ex.pages);
  console.log(`${chunks.length} チャンク（合計 ${chunks.reduce((s, c) => s + c.tokenCount, 0)} トークン）\n`);
  for (const c of chunks) {
    console.log(`#${c.index}  [${c.sectionTitle ?? "(見出しなし)"}]  p.${c.pageStart}-${c.pageEnd}  ${c.tokenCount} tokens`);
    console.log(full ? c.content : "   " + c.content.replace(/\n/g, " ").slice(0, 80) + (c.content.length > 80 ? "…" : ""));
    console.log();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
