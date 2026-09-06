/**
 * 環境変数・モデル名・閾値・部署定義を 1 か所にまとめる。
 * ここ以外のファイルで process.env を直接読まないこと。
 */
import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env.example をコピーして .env を作り、値を入れてください。`,
    );
  }
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

/**
 * 部署の唯一の定義。DB の departments テーブル（supabase/migrations の seed）と一致させる。
 * aliases は文書の冒頭行・フォルダ名・CSV に書かれる表記ゆれ。
 */
export const DEPARTMENTS = [
  { id: "strategy", nameJa: "戦略", aliases: ["戦略部"] },
  { id: "operations", nameJa: "業務", aliases: ["業務部", "ops"] },
  { id: "it", nameJa: "IT", aliases: ["it部", "情報システム"] },
  { id: "hr", nameJa: "人事", aliases: ["人事部"] },
  { id: "sales", nameJa: "営業", aliases: ["営業部"] },
  { id: "admin", nameJa: "管理", aliases: ["管理部", "総務"] },
  /** 機密区分。この部署を付与された人だけが閲覧できる */
  { id: "confidential", nameJa: "機密", aliases: ["機密文書"] },
] as const;

export type DepartmentId = (typeof DEPARTMENTS)[number]["id"];
export const DEPARTMENT_IDS = DEPARTMENTS.map((d) => d.id) as DepartmentId[];

const LABELS = new Map<string, string>(DEPARTMENTS.map((d) => [d.id, d.nameJa]));
/** 部署 ID → 日本語名（未知の ID はそのまま返す） */
export function departmentLabel(id: string): string {
  return LABELS.get(id) ?? id;
}

const ALIAS_TO_ID = new Map<string, DepartmentId>();
for (const d of DEPARTMENTS) {
  for (const key of [d.id, d.nameJa, ...d.aliases]) ALIAS_TO_ID.set(key.toLowerCase(), d.id);
}
/** 「戦略」「hr」「IT部」「人事 / 客先: ...」などの表記から部署 ID を返す。判定できなければ null */
export function resolveDepartment(raw: string | undefined | null): DepartmentId | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  return ALIAS_TO_ID.get(key) ?? ALIAS_TO_ID.get(key.split(/[\s/／:：]/)[0]) ?? null;
}

export const config = {
  db: {
    /** 取り込み・マイグレーション用（RLS の対象外。ボットには渡さない） */
    get ingestUrl() {
      return required("DATABASE_URL_INGEST");
    },
    /** ボット・検索用（rag_bot ロール。RLS が効く） */
    get botUrl() {
      return required("DATABASE_URL_BOT");
    },
    get ragBotPassword() {
      return required("RAG_BOT_PASSWORD");
    },
    /** TLS。Supabase は require、ローカル PGlite は disable */
    ssl: optional("DATABASE_SSL", "require") as "require" | "disable",
  },
  /** 'openai' | 'fake'（fake は OpenAI を呼ばないローカル動作確認用。providers.ts だけが参照する） */
  embeddingProvider: optional("EMBEDDING_PROVIDER", "openai"),
  llmProvider: optional("LLM_PROVIDER", "openai"),
  openai: {
    get apiKey() {
      return required("OPENAI_API_KEY");
    },
    embeddingModel: optional("EMBEDDING_MODEL", "text-embedding-3-small"),
    /** text-embedding-3-small の次元数。DB の vector(1536) と一致させる */
    embeddingDimensions: 1536,
    /** nano は該当文書が無い場面で別案件の数値を流用することがあったため mini を既定に */
    chatModel: optional("CHAT_MODEL", "gpt-5-mini"),
    /** gpt-5 系の推論量。minimal は最速だが稀に該当なし誤判定、low は 2〜5 秒で安定（既定）。空文字で API 既定 */
    reasoningEffort: optional("CHAT_REASONING_EFFORT", "low"),
  },
  search: {
    /** 回答に渡す上位チャンク数。36 件 183 チャンクで 5 だと同一文書の別セクションが漏れたため 8 */
    topK: Number(optional("SEARCH_TOP_K", "8")),
    /** コサイン類似度がこれ未満なら「該当なし」 */
    similarityThreshold: Number(optional("SIMILARITY_THRESHOLD", "0.40")),
  },
  chunk: {
    /** 1 チャンクの上限トークン数 */
    maxTokens: 500,
    /** 強制分割時に前のチャンクと重ねるトークン数 */
    overlapTokens: 50,
    /** これ未満の小さなセクションは次のセクションと結合する */
    minTokens: 80,
  },
  slack: {
    get botToken() {
      return required("SLACK_BOT_TOKEN");
    },
    get appToken() {
      return required("SLACK_APP_TOKEN");
    },
  },
  docsDir: optional("DOCS_DIR", "./data/docs"),
};
