/** チャンク分割テスト:  npm run chunk -- data/docs/strategy/xxx.pdf [--full] */
import { config } from "../config.js";
import { chunkPages } from "../ingest/chunk.js";
import { analyzeLocalFile } from "../ingest/local.js";
import { flag, positionals, runCli } from "../lib/cli.js";

runCli(async () => {
  const file = positionals()[0];
  if (!file) throw new Error("使い方: npm run chunk -- <pdf または docx のパス> [--full]");
  const { extracted, meta } = await analyzeLocalFile(file);
  const chunks = chunkPages(extracted.pages, config.chunk, meta.title);
  console.log(`${chunks.length} チャンク（合計 ${chunks.reduce((s, c) => s + c.tokenCount, 0)} トークン）\n`);
  for (const c of chunks) {
    console.log(`#${c.index}  [${c.sectionTitle ?? "(見出しなし)"}]  p.${c.pageStart}-${c.pageEnd}  ${c.tokenCount} tokens`);
    console.log(flag("--full") ? c.content : "   " + c.content.replace(/\n/g, " ").slice(0, 80) + (c.content.length > 80 ? "…" : ""));
    console.log();
  }
});
