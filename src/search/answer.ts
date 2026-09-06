/**
 * 検索 → 閾値 → 回答生成 をまとめた「質問応答」の入口。
 * Slack ハンドラ・CLI・評価スクリプトはすべてここを呼ぶ。
 *
 * ハルシネーション対策（2 段目）:
 *  - 渡したチャンク以外を根拠にしない・根拠が無ければ NO_ANSWER と書く、とプロンプトで指示
 *  - 回答に出典番号 [n] が 1 つも無ければ該当なし扱い
 *
 * 依存（検索関数・LLM）は deps で差し替えられる。既定は providers.ts が組み立てる。
 */
import { config, departmentLabel } from "../config.js";
import { chatFn, embeddingClient, type ChatFn } from "../providers.js";
import { makeSearch, type SearchFn, type SearchHit } from "./search.js";
import { applyThreshold } from "./threshold.js";
import { writeSearchLog } from "../audit/log.js";

export type AnswerStatus = "answered" | "no_hit" | "unregistered" | "error";

export interface Citation {
  n: number;
  title: string;
  fileName: string;
  department: string;
  sectionTitle: string | null;
  page: string;
  score: number;
  /** 表示用の 1 行: 「タイトル ファイル名 p.N（部署 / 見出し）」 */
  label: string;
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
  /** 監査ログの行 id（Slack 投稿後に投稿先を記録するため） */
  logId?: number;
}

export interface AnswerDeps {
  search: SearchFn;
  chat: ChatFn;
}

export interface AnswerOptions {
  channelId?: string;
  skipLog?: boolean;
  /** テスト・評価用の差し替え口 */
  deps?: Partial<AnswerDeps>;
}

const NO_ANSWER_TOKEN = "NO_ANSWER";
export const NO_HIT_MESSAGE = "該当する文書は見つかりませんでした。質問の言い回しを変えるか、別のキーワードでお試しください。";
export const UNREGISTERED_MESSAGE = "あなたの Slack アカウントは部署マスタに登録されていません。管理者に登録を依頼してください。";

let _defaultDeps: AnswerDeps | undefined;
function defaultDeps(): AnswerDeps {
  if (!_defaultDeps) _defaultDeps = { search: makeSearch(embeddingClient()), chat: chatFn() };
  return _defaultDeps;
}

export async function answerQuestion(slackUserId: string, question: string, opts: AnswerOptions = {}): Promise<AnswerResult> {
  const started = Date.now();
  const model = config.openai.chatModel;
  const deps = { ...defaultDeps(), ...opts.deps };
  let departmentIds: string[] = [];
  let status: AnswerStatus = "error";
  let text = "";
  let citations: Citation[] = [];
  let hits: SearchHit[] = [];
  let topScore: number | null = null;

  try {
    const search = await deps.search(slackUserId, question);
    departmentIds = search.departmentIds;
    hits = search.hits;
    if (search.unregistered) {
      status = "unregistered";
      text = UNREGISTERED_MESSAGE;
    } else {
      const decision = applyThreshold(search.hits);
      topScore = decision.topScore;
      const generated = decision.passed ? await generate(deps.chat, question, decision.hits) : null;
      if (generated) {
        status = "answered";
        text = generated.text;
        citations = generated.citations;
      } else {
        status = "no_hit";
        text = NO_HIT_MESSAGE;
      }
    }
  } catch (e) {
    text = `エラーが発生しました: ${(e as Error).message}`;
    citations = [];
    hits = [];
  }

  const result: AnswerResult = { status, text, citations, hits, topScore, latencyMs: Date.now() - started, model };
  if (!opts.skipLog) {
    result.logId = await writeSearchLog({
      slackUserId,
      channelId: opts.channelId ?? null,
      question,
      departmentIds,
      topChunkIds: hits.map((h) => h.chunkId),
      topScores: hits.map((h) => h.score),
      status,
      model,
      latencyMs: result.latencyMs,
    }).catch((e) => {
      console.error("監査ログ書き込み失敗:", e);
      return undefined;
    });
  }
  return result;
}

export function buildCitations(hits: SearchHit[]): Citation[] {
  return hits.map((h, i) => {
    const page = h.pageStart == null ? "-" : h.pageStart === h.pageEnd || h.pageEnd == null ? `p.${h.pageStart}` : `p.${h.pageStart}-${h.pageEnd}`;
    const department = departmentLabel(h.departmentId);
    const where = [department, h.sectionTitle].filter(Boolean).join(" / ");
    return { n: i + 1, title: h.title, fileName: h.fileName, department, sectionTitle: h.sectionTitle, page, score: h.score, label: `${h.title}  ${h.fileName} ${page}（${where}）` };
  });
}

const SYSTEM_PROMPT = `あなたはコンサルティング会社の社内ナレッジ検索アシスタントです。
以下のルールを厳守してください。
1. 回答の根拠は「参考文書」に書かれている内容だけです。あなた自身の知識や推測で補ってはいけません。
2. 参考文書に質問への答えが含まれていない場合は、説明を付けずに「${NO_ANSWER_TOKEN}」とだけ出力してください。
   質問が特定の案件・客先・文書（例:「クラウド移行」「銀行A向け」）を指しているのに、その案件の文書が参考文書に無い場合も「${NO_ANSWER_TOKEN}」です。
   似た別案件の数値を代用して答えてはいけません（例: クラウド移行の質問に SaaS 移行の削減額で答えない）。
3. 答えられる場合は、日本語で簡潔に（3〜6 文程度）まとめ、根拠にした箇所の直後に必ず出典番号を [1] [2] の形式で付けてください。
4. 数値・固有名詞は参考文書の記載どおりに書いてください。
5. 複数の文書に関係する場合は、文書ごとに分けて記述してください。`;

/** LLM に回答を作らせる。根拠が無い（NO_ANSWER / 出典番号なし）なら null */
async function generate(chat: ChatFn, question: string, hits: SearchHit[]): Promise<{ text: string; citations: Citation[] } | null> {
  const citations = buildCitations(hits);
  const context = hits.map((h, i) => `[${citations[i].n}] 文書: ${citations[i].label}\n${h.content}`).join("\n\n---\n\n");
  const text = (await chat({ system: SYSTEM_PROMPT, user: `# 参考文書\n\n${context}\n\n# 質問\n${question}`, hits })).trim();
  const noAnswer = text.length === 0 || text.includes(NO_ANSWER_TOKEN) || !/\[\d+\]/.test(text);
  return noAnswer ? null : { text, citations };
}
