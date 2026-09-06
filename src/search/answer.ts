/**
 * 検索 → 閾値 → 回答生成 をまとめた「質問応答」の入口。
 * Slack ハンドラ・CLI・評価スクリプトはすべてここを呼ぶ。
 *
 * ハルシネーション対策（2 段目）:
 *  - 渡したチャンク以外を根拠にしない・根拠が無ければ NO_ANSWER と書く、とプロンプトで指示
 *  - 回答に出典番号 [n] が 1 つも無ければ該当なし扱い
 */
import OpenAI from "openai";
import { config } from "../config.js";
import { searchChunks, type SearchHit } from "./search.js";
import { applyThreshold } from "./threshold.js";
import { writeSearchLog } from "../audit/log.js";
import { DEPARTMENT_NAME_JA } from "../config.js";

export type AnswerStatus = "answered" | "no_hit" | "unregistered" | "error";

export interface Citation {
  n: number;
  title: string;
  department: string;
  sectionTitle: string | null;
  page: string;
  score: number;
  documentId: string;
}

export interface AnswerResult {
  status: AnswerStatus;
  /** Slack にそのまま出せる本文 */
  text: string;
  citations: Citation[];
  hits: SearchHit[];
  topScore: number | null;
  latencyMs: number;
  model: string;
}

const NO_ANSWER_TOKEN = "NO_ANSWER";
export const NO_HIT_MESSAGE = "該当する文書は見つかりませんでした。質問の言い回しを変えるか、別のキーワードでお試しください。";
export const UNREGISTERED_MESSAGE = "あなたの Slack アカウントは部署マスタに登録されていません。管理者に登録を依頼してください。";

let _openai: OpenAI | undefined;
function openai(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: config.openai.apiKey });
  return _openai;
}

export async function answerQuestion(
  slackUserId: string,
  question: string,
  opts: { channelId?: string; skipLog?: boolean } = {},
): Promise<AnswerResult> {
  const started = Date.now();
  const model = config.openai.chatModel;
  let result: AnswerResult;
  let departmentIds: string[] = [];

  try {
    const search = await searchChunks(slackUserId, question);
    departmentIds = search.departmentIds;

    if (search.unregistered) {
      result = { status: "unregistered", text: UNREGISTERED_MESSAGE, citations: [], hits: [], topScore: null, latencyMs: 0, model };
    } else {
      const decision = applyThreshold(search.hits);
      if (!decision.passed) {
        result = { status: "no_hit", text: NO_HIT_MESSAGE, citations: [], hits: search.hits, topScore: decision.topScore, latencyMs: 0, model };
      } else {
        const citations = buildCitations(decision.hits);
        const generated = await generate(question, decision.hits, citations);
        if (generated.noAnswer) {
          result = { status: "no_hit", text: NO_HIT_MESSAGE, citations: [], hits: search.hits, topScore: decision.topScore, latencyMs: 0, model };
        } else {
          result = { status: "answered", text: generated.text, citations, hits: search.hits, topScore: decision.topScore, latencyMs: 0, model };
        }
      }
    }
  } catch (e) {
    result = {
      status: "error",
      text: `エラーが発生しました: ${(e as Error).message}`,
      citations: [],
      hits: [],
      topScore: null,
      latencyMs: 0,
      model,
    };
  }

  result.latencyMs = Date.now() - started;

  if (!opts.skipLog) {
    await writeSearchLog({
      slackUserId,
      channelId: opts.channelId ?? null,
      question,
      departmentIds,
      topChunkIds: result.hits.map((h) => h.chunkId),
      topScores: result.hits.map((h) => h.score),
      status: result.status,
      model,
      latencyMs: result.latencyMs,
    }).catch((e) => console.error("監査ログ書き込み失敗:", e));
  }
  return result;
}

export function buildCitations(hits: SearchHit[]): Citation[] {
  return hits.map((h, i) => ({
    n: i + 1,
    title: h.title,
    department: DEPARTMENT_NAME_JA[h.departmentId] ?? h.departmentId,
    sectionTitle: h.sectionTitle,
    page: h.pageStart == null ? "-" : h.pageStart === h.pageEnd || h.pageEnd == null ? `p.${h.pageStart}` : `p.${h.pageStart}-${h.pageEnd}`,
    score: h.score,
    documentId: h.documentId,
  }));
}

const SYSTEM_PROMPT = `あなたはコンサルティング会社の社内ナレッジ検索アシスタントです。
以下のルールを厳守してください。
1. 回答の根拠は「参考文書」に書かれている内容だけです。あなた自身の知識や推測で補ってはいけません。
2. 参考文書に質問への答えが含まれていない場合は、説明を付けずに「${NO_ANSWER_TOKEN}」とだけ出力してください。
3. 答えられる場合は、日本語で簡潔に（3〜6 文程度）まとめ、根拠にした箇所の直後に必ず出典番号を [1] [2] の形式で付けてください。
4. 数値・固有名詞は参考文書の記載どおりに書いてください。
5. 複数の文書に関係する場合は、文書ごとに分けて記述してください。`;

async function generate(question: string, hits: SearchHit[], citations: Citation[]): Promise<{ text: string; noAnswer: boolean }> {
  const context = hits
    .map((h, i) => {
      const c = citations[i];
      return `[${c.n}] 文書: ${c.title}（${c.department} / ${c.page}${c.sectionTitle ? ` / ${c.sectionTitle}` : ""}）\n${h.content}`;
    })
    .join("\n\n---\n\n");

  const res = await openai().chat.completions.create({
    model: config.openai.chatModel,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `# 参考文書\n\n${context}\n\n# 質問\n${question}` },
    ],
  });
  const text = res.choices[0]?.message?.content?.trim() ?? "";
  const noAnswer = text.length === 0 || text.includes(NO_ANSWER_TOKEN) || !/\[\d+\]/.test(text);
  return { text, noAnswer };
}
