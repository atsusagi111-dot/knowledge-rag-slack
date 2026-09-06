/** 回答テスト:  npm run answer -- --user U0123ABC "銀行向け DX 提案の ROI は？" [--no-log] */
import { answerQuestion } from "../search/answer.js";
import { flag, positionals, runCli, value } from "../lib/cli.js";

runCli(async () => {
  const user = value("--user");
  const question = positionals().join(" ");
  if (!user || !question) throw new Error('使い方: npm run answer -- --user <SlackユーザーID> "質問文"');

  const r = await answerQuestion(user, question, { skipLog: flag("--no-log") });
  console.log(`[${r.status}] ${r.model} ${r.latencyMs}ms  topScore=${r.topScore?.toFixed(3) ?? "-"}\n`);
  console.log(r.text);
  if (r.citations.length > 0) {
    console.log("\n出典:");
    for (const c of r.citations) console.log(`  [${c.n}] ${c.label} ${c.score.toFixed(2)}`);
  }
});
