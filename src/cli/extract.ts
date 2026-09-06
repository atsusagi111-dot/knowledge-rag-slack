/** 抽出テスト:  npm run extract -- data/docs/strategy/xxx.pdf */
import { analyzeLocalFile } from "../ingest/local.js";
import { positionals, runCli } from "../lib/cli.js";

runCli(async () => {
  const file = positionals()[0];
  if (!file) throw new Error("使い方: npm run extract -- <pdf または docx のパス>");
  const { extracted, meta } = await analyzeLocalFile(file);
  console.log("=== メタデータ ===");
  console.log(JSON.stringify(meta, null, 2));
  console.log(`=== 本文（${extracted.pages.length} ページ, ${extracted.fullText.length} 文字）===`);
  for (const p of extracted.pages) console.log(`\n----- page ${p.page} -----\n${p.text}`);
});
