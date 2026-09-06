/** 抽出テスト:  npm run extract -- data/docs/strategy/xxx.pdf */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { extractText } from "../ingest/extract.js";
import { extractMetadata } from "../ingest/metadata.js";
import { fileTypeFromName } from "../sources/DocumentSource.js";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("使い方: npm run extract -- <pdf または docx のパス>");
  const type = fileTypeFromName(file);
  if (!type) throw new Error("pdf か docx を指定してください");
  const buf = await readFile(file);
  const ex = await extractText(buf, type);
  const hint = path.basename(path.dirname(path.resolve(file)));
  const meta = extractMetadata(ex.fullText, path.basename(file), hint);
  console.log("=== メタデータ ===");
  console.log(JSON.stringify(meta, null, 2));
  console.log(`=== 本文（${ex.pages.length} ページ, ${ex.fullText.length} 文字）===`);
  for (const p of ex.pages) {
    console.log(`\n----- page ${p.page} -----\n${p.text}`);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
