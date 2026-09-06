/**
 * 評価スクリプト:  npm run eval [-- --questions eval/questions.csv] [--no-llm]
 *
 * eval/questions.csv の各行を「指定ユーザーとして」実行し、
 *   - 該当あり問  : Recall@5（正解文書が上位チャンクの文書集合に含まれる割合）
 *   - 該当なし問  : 「該当なし」を返せたか
 *   - RLS 問      : 他部署ユーザーで検索して 0 件 + 該当なし になったか
 * を集計し、eval/results/YYYY-MM-DD_HHmm.md に Markdown 表で保存する。
 *
 * CSV 列: 番号,質問,正解文書,正解の根拠,種別,テストユーザー
 *   テストユーザー = users.json のキー（all_depts / hr_only）。実 ID は git 管理外の data/master/eval_users.json を優先
 *   正解文書 = ファイル名の一部（"case7-doc1"）。複数は " / " 区切り
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ingestSql } from "../db/client.js";
import { parseCsv } from "../lib/csv.js";
import { flag, runCli, value } from "../lib/cli.js";
import { embeddingClient } from "../providers.js";
import { makeSearch, type SearchResult } from "../search/search.js";
import { applyThreshold } from "../search/threshold.js";
import { answerQuestion } from "../search/answer.js";

interface Question {
  no: string;
  question: string;
  expectedDocs: string[]; // source_path に含まれる部分文字列
  kind: "hit" | "no_hit" | "rls";
  testUser: string;
}

interface Row {
  q: Question;
  topScore: number | null;
  recall: number | null;
  passed: boolean;
  topDocs: string[];
  note: string;
}

function parseQuestions(csv: string): Question[] {
  return parseCsv(csv).map((r) => {
    const kindRaw = r["種別"] ?? "";
    const kind: Question["kind"] = /RLS/i.test(kindRaw) ? "rls" : /該当なし/.test(kindRaw) ? "no_hit" : "hit";
    const expected = (r["正解文書"] ?? "").split("/").map((s) => s.trim()).filter((s) => s && !s.startsWith("（"));
    return { no: r["番号"], question: r["質問"], expectedDocs: kind === "hit" ? expected : [], kind, testUser: r["テストユーザー"] || "all_depts" };
  });
}

const fmt = (n: number | null | undefined, digits = 3) => (n == null || !isFinite(n) ? "-" : n.toFixed(digits));

runCli(async () => {
  const questionsPath = value("--questions") ?? "eval/questions.csv";
  const useLlm = !flag("--no-llm");
  const usersPath = (await stat("data/master/eval_users.json").catch(() => null)) ? "data/master/eval_users.json" : "eval/users.json";
  console.log(`テストユーザー: ${usersPath}`);
  const users = JSON.parse(await readFile(usersPath, "utf8")) as Record<string, string>;
  const questions = parseQuestions(await readFile(questionsPath, "utf8"));
  const docs = await ingestSql()<{ id: string; source_path: string }[]>`select id, source_path from documents`;
  const pathById = new Map(docs.map((d) => [d.id, d.source_path]));
  const search = makeSearch(embeddingClient());

  const rows: Row[] = [];
  for (const q of questions) {
    const slackUserId = users[q.testUser];
    if (!slackUserId) {
      rows.push({ q, topScore: null, recall: null, passed: false, topDocs: [], note: `${usersPath} に ${q.testUser} がありません` });
      continue;
    }
    const result: SearchResult = await search(slackUserId, q.question);
    const decision = applyThreshold(result.hits);
    const topDocs = [...new Set(result.hits.map((h) => pathById.get(h.documentId) ?? h.documentId))];
    let recall: number | null = null;
    let passed = false;
    let note = "";

    if (q.kind === "hit") {
      const found = q.expectedDocs.filter((e) => topDocs.some((d) => d.includes(e)));
      recall = q.expectedDocs.length ? found.length / q.expectedDocs.length : null;
      passed = recall === 1 && decision.passed;
      if (recall !== null && recall < 1) note = `未検出: ${q.expectedDocs.filter((e) => !found.includes(e)).join(", ")}`;
    } else if (q.kind === "no_hit") {
      if (useLlm && decision.passed) {
        // 閾値を通過した場合は LLM 側の判定を見る（検索結果は使い回す）
        const a = await answerQuestion(slackUserId, q.question, { skipLog: true, deps: { search: async () => result } });
        passed = a.status === "no_hit";
        note = passed ? "閾値は通過したが LLM が該当なしと判定" : `LLM が回答してしまった: ${a.text.slice(0, 60)}…`;
      } else {
        passed = !decision.passed;
      }
    } else {
      // rls: 他部署ユーザーで検索。結果に他部署文書が 1 件も無く、該当なしになること
      const foreign = result.hits.filter((h) => !result.departmentIds.includes(h.departmentId));
      passed = foreign.length === 0 && !decision.passed;
      note = foreign.length > 0 ? `権限漏れ! 他部署チャンク ${foreign.length} 件` : result.unregistered ? "ユーザー未登録" : `所属 ${result.departmentIds.join(",")} で ${result.hits.length} 件`;
    }

    rows.push({ q, topScore: decision.topScore, recall, passed, topDocs, note });
    console.log(`${passed ? "✅" : "❌"} Q${q.no} [${q.kind}] top=${fmt(decision.topScore)} ${note}`);
  }

  // 集計
  const hitRows = rows.filter((r) => r.q.kind === "hit" && r.recall !== null);
  const noHitRows = rows.filter((r) => r.q.kind === "no_hit");
  const rlsRows = rows.filter((r) => r.q.kind === "rls");
  const recallAt5 = hitRows.length ? hitRows.reduce((s, r) => s + (r.recall ?? 0), 0) / hitRows.length : 0;
  const minHit = Math.min(...hitRows.map((r) => r.topScore ?? 1));
  const maxNoHit = Math.max(...noHitRows.map((r) => r.topScore ?? 0));
  const count = (rs: Row[]) => `${rs.filter((r) => r.passed).length}/${rs.length}`;

  const md = [
    `# 評価結果 ${new Date().toLocaleString("ja-JP")}`,
    ``,
    `- Embedding: ${config.openai.embeddingModel} / 生成: ${config.openai.chatModel} / topK: ${config.search.topK} / 閾値: ${config.search.similarityThreshold}`,
    `- **Recall@5: ${recallAt5.toFixed(2)}**（該当あり ${hitRows.length} 問）`,
    `- **該当なし正答: ${count(noHitRows)}**`,
    `- **RLS 検証: ${count(rlsRows)}**`,
    `- 閾値の目安: 該当あり問の最低 top スコア = ${fmt(minHit)} / 該当なし問の最高 top スコア = ${fmt(maxNoHit)} → 中間 ${fmt((minHit + maxNoHit) / 2)}`,
    ``,
    `| No | 種別 | ユーザー | 判定 | top score | Recall | 上位文書 | 備考 |`,
    `|---|---|---|---|---|---|---|---|`,
    ...rows.map((r) => `| ${r.q.no} | ${r.q.kind} | ${r.q.testUser} | ${r.passed ? "✅" : "❌"} | ${fmt(r.topScore)} | ${fmt(r.recall, 2)} | ${r.topDocs.map((d) => path.basename(d)).join("<br>")} | ${r.note} |`),
  ].join("\n");

  await mkdir("eval/results", { recursive: true });
  const out = `eval/results/${new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "")}.md`;
  await writeFile(out, md, "utf8");
  console.log(`\nRecall@5=${recallAt5.toFixed(2)}  該当なし ${count(noHitRows)}  RLS ${count(rlsRows)}`);
  console.log(`保存: ${out}`);
});
