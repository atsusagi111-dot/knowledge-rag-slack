/** 検索テスト:  npm run search -- --user U0123ABC "銀行向け DX 提案の ROI" [--k 5] */
import { searchChunks } from "../search/search.js";
import { closeAll } from "../db/client.js";
import { config } from "../config.js";

async function main() {
  const args = process.argv.slice(2);
  const user = args[args.indexOf("--user") + 1];
  const kIdx = args.indexOf("--k");
  const k = kIdx >= 0 ? Number(args[kIdx + 1]) : config.search.topK;
  const question = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--user" && args[i - 1] !== "--k").join(" ");
  if (!user || !question) throw new Error('使い方: npm run search -- --user <SlackユーザーID> "質問文"');

  const res = await searchChunks(user, question, { topK: k });
  if (res.unregistered) {
    console.log("このユーザーは部署マスタに未登録です");
    return;
  }
  console.log(`所属部署: ${res.departmentIds.join(", ")} / 閾値 ${config.search.similarityThreshold}\n`);
  if (res.hits.length === 0) console.log("結果 0 件");
  for (const [i, h] of res.hits.entries()) {
    const flag = h.score >= config.search.similarityThreshold ? " " : "×";
    console.log(`${flag} ${i + 1}. score=${h.score.toFixed(3)}  ${h.title}  [${h.departmentId}] ${h.sectionTitle ?? ""} p.${h.pageStart}`);
    console.log(`     ${h.content.replace(/\n/g, " ").slice(0, 100)}…`);
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
