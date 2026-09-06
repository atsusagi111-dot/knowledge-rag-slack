/** 検索テスト:  npm run search -- --user U0123ABC "銀行向け DX 提案の ROI" [--k 5] */
import { makeSearch } from "../search/search.js";
import { embeddingClient } from "../providers.js";
import { config } from "../config.js";
import { positionals, runCli, value } from "../lib/cli.js";

runCli(async () => {
  const user = value("--user");
  const k = Number(value("--k") ?? config.search.topK);
  const question = positionals().join(" ");
  if (!user || !question) throw new Error('使い方: npm run search -- --user <SlackユーザーID> "質問文"');

  const res = await makeSearch(embeddingClient())(user, question, k);
  if (res.unregistered) {
    console.log("このユーザーは部署マスタに未登録です");
    return;
  }
  console.log(`所属部署: ${res.departmentIds.join(", ")} / 閾値 ${config.search.similarityThreshold}\n`);
  if (res.hits.length === 0) console.log("結果 0 件");
  for (const [i, h] of res.hits.entries()) {
    const mark = h.score >= config.search.similarityThreshold ? " " : "×";
    console.log(`${mark} ${i + 1}. score=${h.score.toFixed(3)}  ${h.title}  [${h.departmentId}] ${h.sectionTitle ?? ""} p.${h.pageStart}`);
    console.log(`     ${h.content.replace(/\n/g, " ").slice(0, 100)}…`);
  }
});
