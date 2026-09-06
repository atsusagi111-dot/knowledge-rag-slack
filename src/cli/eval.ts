/**
 * 評価スクリプト:  npm run eval [-- --questions eval/questions.csv] [--no-llm]
 *
 * eval/questions.csv の各行を「指定ユーザーとして」実行し、
 *   - 該当あり問  : Recall@5（正解文書が上位 5 チャンクの文書集合に含まれる割合）
 *   - 該当なし問  : 「該当なし」を返せたか
 *   - RLS 問      : 他部署ユーザーで検索して 0 件 + 該当なし になったか
 * を集計し、eval/results/YYYY-MM-DD_HHmm.md に Markdown 表で保存する。
 *
 * CSV 列: 番号,質問,正解文書,正解の根拠,種別,テストユーザー
 *   テストユーザー = eval/users.json のキー（例 strategy_only / hr_only / all_depts）
 *   正解文書 = ファイル名の一部（"case7-doc1"）。複数は " / " 区切り
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { closeAll } from "../db/client.js";
import { parseCsv } from "../lib/csv.js";
import { searchChunks } from "../search/search.js";
import { applyThreshold } from "../search/threshold.js";
import { answerQuestion } from "../search/answer.js";
import { ingestSql } from "../db/client.js";

interface Question {
  no: string;
  question: string;
  expectedDocs: string[]; // source_path に含まれる部分文字列
  kind: "hit" | "no_hit" | "rls";
  testUser: string;
  rationale: string;
}

interface Row {
  no: string;
  kind: string;
  user: string;
  question: string;
  topScore: number | null;
  recall: number | null;
  passed: boolean;
  status: string;
  topDocs: string[];
  note: string;
}

function parseQuestions(csv: string): Question[] {
  return parseCsv(csv).map((r) => {
    const kindRaw = r["種別"] ?? "";
    const kind: Question["kind"] = /RLS/i.test(kindRaw) ? "rls" : /該当なし/.test(kindRaw) ? "no_hit" : "hit";
    const expected = (r["正解文書"] ?? "")
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("（"));
    return {
      no: r["番号"],
      question: r["質問"],
      expectedDocs: kind === "hit" ? expected : [],
      kind,
      testUser: r["テストユーザー"] || "all_depts",
      rationale: r["正解の根拠"] ?? "",
    };
  });
}

async function main() {
  const args = process.argv.slice(2);
  const qIdx = args.indexOf("--questions");
  const questionsPath = qIdx >= 0 ? args[qIdx + 1] : "eval/questions.csv";
  const useLlm = !args.includes("--no-llm");

  const users = JSON.parse(await readFile("eval/users.json", "utf8")) as Record<string, string>;
  const questions = parseQuestions(await readFile(questionsPath, "utf8"));
  // document_id → source_path（正解判定用）
  const docs = await ingestSql()<{ id: string; source_path: string }[]>`select id, source_path from documents`;
  const pathById = new Map(docs.map((d) => [d.id, d.source_path]));

  const rows: Row[] = [];
  for (const q of questions) {
    const slackUserId = users[q.testUser];
    if (!slackUserId) {
      rows.push({ no: q.no, kind: q.kind, user: q.testUser, question: q.question, topScore: null, recall: null, passed: false, status: "-", topDocs: [], note: `eval/users.json に ${q.testUser} がありません` });
      continue;
    }
    const search = await searchChunks(slackUserId, q.question);
    const decision = applyThreshold(search.hits);
    const topDocs = [...new Set(search.hits.map((h) => pathById.get(h.documentId) ?? h.documentId))];
    const topScore = decision.topScore;

    let recall: number | null = null;
    let passed = false;
    let status = decision.passed ? "hit" : "no_hit";
    let note = "";

    if (q.kind === "hit") {
      const found = q.expectedDocs.filter((e) => topDocs.some((d) => d.includes(e)));
      recall = q.expectedDocs.length ? found.length / q.expectedDocs.length : null;
      passed = recall === 1 && decision.passed;
      if (recall !== null && recall < 1) note = `未検出: ${q.expectedDocs.filter((e) => !found.includes(e)).join(", ")}`;
    } else if (q.kind === "no_hit") {
      if (useLlm && decision.passed) {
        const a = await answerQuestion(slackUserId, q.question, { skipLog: true });
        status = a.status;
        passed = a.status === "no_hit";
        note = passed ? "閾値は通過したが LLM が該当なしと判定" : `LLM が回答してしまった: ${a.text.slice(0, 60)}…`;
      } else {
        passed = !decision.passed;
      }
    } else {
      // rls: 他部署ユーザーで検索。結果に他部署文書が 1 件も無く、該当なしになること
      const foreign = search.hits.filter((h) => !search.departmentIds.includes(h.departmentId));
      passed = foreign.length === 0 && !decision.passed;
      note = foreign.length > 0 ? `権限漏れ! 他部署チャンク ${foreign.length} 件` : search.unregistered ? "ユーザー未登録" : `所属 ${search.departmentIds.join(",")} で ${search.hits.length} 件`;
    }

    rows.push({ no: q.no, kind: q.kind, user: q.testUser, question: q.question, topScore, recall, passed, status, topDocs, note });
    console.log(`${passed ? "✅" : "❌"} Q${q.no} [${q.kind}] top=${topScore?.toFixed(3) ?? "-"} ${note}`);
  }

  // 集計
  const hitRows = rows.filter((r) => r.kind === "hit" && r.recall !== null);
  const recallAt5 = hitRows.length ? hitRows.reduce((s, r) => s + (r.recall ?? 0), 0) / hitRows.length : 0;
  const noHitRows = rows.filter((r) => r.kind === "no_hit");
  const rlsRows = rows.filter((r) => r.kind === "rls");
  const minHitScore = Math.min(...hitRows.map((r) => r.topScore ?? 1));
  const maxNoHitScore = Math.max(...noHitRows.map((r) => r.topScore ?? 0));

  const md = [
    `# 評価結果 ${new Date().toLocaleString("ja-JP")}`,
    ``,
    `- Embedding: ${config.openai.embeddingModel} / 生成: ${config.openai.chatModel} / topK: ${config.search.topK} / 閾値: ${config.search.similarityThreshold}`,
    `- **Recall@5: ${recallAt5.toFixed(2)}**（該当あり ${hitRows.length} 問）`,
    `- **該当なし正答: ${noHitRows.filter((r) => r.passed).length}/${noHitRows.length}**`,
    `- **RLS 検証: ${rlsRows.filter((r) => r.passed).length}/${rlsRows.length}**`,
    `- 閾値の目安: 該当あり問の最低 top スコア = ${isFinite(minHitScore) ? minHitScore.toFixed(3) : "-"} / 該当なし問の最高 top スコア = ${isFinite(maxNoHitScore) ? maxNoHitScore.toFixed(3) : "-"} → 中間 ${isFinite(minHitScore) && isFinite(maxNoHitScore) ? ((minHitScore + maxNoHitScore) / 2).toFixed(3) : "-"}`,
    ``,
    `| No | 種別 | ユーザー | 判定 | top score | Recall | 上位文書 | 備考 |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows.map(
      (r) =>
        `| ${r.no} | ${r.kind} | ${r.user} | ${r.passed ? "✅" : "❌"} | ${r.topScore?.toFixed(3) ?? "-"} | ${r.recall?.toFixed(2) ?? "-"} | ${r.topDocs.map((d) => path.basename(d)).join("<br>")} | ${r.note} |`,
    ),
  ].join("\n");

  await mkdir("eval/results", { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "");
  const out = `eval/results/${stamp}.md`;
  await writeFile(out, md, "utf8");
  console.log(`\nRecall@5=${recallAt5.toFixed(2)}  該当なし ${noHitRows.filter((r) => r.passed).length}/${noHitRows.length}  RLS ${rlsRows.filter((r) => r.passed).length}/${rlsRows.length}`);
  console.log(`保存: ${out}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(closeAll);
