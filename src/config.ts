/**
 * 環境変数・モデル名・閾値を 1 か所にまとめる。
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

/** 部署 ID（DB の departments.id と一致させる） */
export const DEPARTMENT_IDS = ["strategy", "operations", "it", "hr", "sales", "admin", "confidential"] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** 日本語名 ↔ 部署 ID の対応 */
export const DEPARTMENT_NAME_JA: Record<DepartmentId, string> = {
  strategy: "戦略",
  operations: "業務",
  it: "IT",
  hr: "人事",
  sales: "営業",
  admin: "管理",
  /** 機密区分。この部署を付与された人だけが閲覧できる */
  confidential: "機密",
};

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
    /** ローカル PGlite 用: bot 接続の中で SET ROLE するロール名（Supabase では空のまま） */
    botSetRole: optional("DB_BOT_SET_ROLE", ""),
  },
  /** 'openai' | 'fake'（fake は OpenAI を呼ばないローカル動作確認用） */
  embeddingProvider: optional("EMBEDDING_PROVIDER", "openai"),
  llmProvider: optional("LLM_PROVIDER", "openai"),
  openai: {
    get apiKey() {
      return required("OPENAI_API_KEY");
    },
    embeddingModel: optional("EMBEDDING_MODEL", "text-embedding-3-small"),
    /** text-embedding-3-small の次元数。DB の vector(1536) と一致させる */
    embeddingDimensions: 1536,
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
