/**
 * postgres.js の接続を 2 種類に分けて持つ。
 *  - ingestSql : 取り込み・マイグレーション用（RLS 対象外）
 *  - botSql    : 検索・回答用（rag_bot ロール。RLS が効く）
 * 検索側は必ず withSlackUser() を通して使うこと。
 */
import postgres, { type Sql, type TransactionSql } from "postgres";
import { config } from "../config.js";

const common = {
  // Supabase Session pooler は接続数に上限があるので少なめに
  max: 3,
  idle_timeout: 20,
  connect_timeout: 15,
  // Supabase は TLS 必須
  ssl: "require" as const,
  // vector 型は extensions スキーマにあるので検索パスに入れる（接続時に設定）
  connection: { search_path: "public, extensions" },
  transform: { undefined: null },
};

let _ingest: Sql | undefined;
let _bot: Sql | undefined;

export function ingestSql(): Sql {
  if (!_ingest) _ingest = postgres(config.db.ingestUrl, common);
  return _ingest;
}

export function botSql(): Sql {
  if (!_bot) _bot = postgres(config.db.botUrl, common);
  return _bot;
}

/**
 * 「この Slack ユーザーとして」DB を触るためのトランザクション。
 * set_config の第 3 引数 true = このトランザクション内だけ有効。
 * RLS ポリシーは current_setting('app.slack_user_id') を見るので、
 * これを通さずに botSql を直接使うと 0 件しか返らない（安全側に倒れる）。
 */
export async function withSlackUser<T>(
  slackUserId: string,
  fn: (tx: TransactionSql) => Promise<T>,
  sql: Sql = botSql(),
): Promise<T> {
  if (!slackUserId || !/^[UW][A-Z0-9]+$/.test(slackUserId)) {
    throw new Error(`不正な Slack ユーザー ID です: ${slackUserId}`);
  }
  return sql.begin(async (tx) => {
    await tx`select set_config('app.slack_user_id', ${slackUserId}, true)`;
    return fn(tx as unknown as TransactionSql);
  }) as Promise<T>;
}

export async function closeAll(): Promise<void> {
  await Promise.all([_ingest?.end({ timeout: 5 }), _bot?.end({ timeout: 5 })]);
  _ingest = undefined;
  _bot = undefined;
}

/** number[] を pgvector が受け付ける文字列 '[0.1,0.2,...]' に変換 */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
