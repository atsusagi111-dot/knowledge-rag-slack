/** 回答テスト:  npm run answer -- --user U0123ABC "銀行向け DX 提案の ROI は？" */
import { answerQuestion } from "../search/answer.js";
import { closeAll } from "../db/client.js";

async function main() {
  const args = process.argv.slice(2);
  const user = args[args.indexOf("--user") + 1];
  const question = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--user").join(" ");
  if (!user || !question) throw new Error('使い方: npm run answer -- --user <SlackユーザーID> "質問文"');

  const r = await answerQuestion(user, question, { skipLog: args.includes("--no-log") });
  console.log(`[${r.status}] ${r.model} ${r.latencyMs}ms  topScore=${r.topScore?.toFixed(3) ?? "-"}\n`);
  console.log(r.text);
  if (r.citations.length > 0) {
    console.log("\n出典:");
    for (const c of r.citations) console.log(`  [${c.n}] ${c.title}  ${c.fileName} ${c.page}（${c.department}${c.sectionTitle ? ` / ${c.sectionTitle}` : ""}） ${c.score.toFixed(2)}`);
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(closeAll);
