# アーキテクチャ

## 全体像

```
┌──────────── 取り込み（バッチ / 手動 or GitHub Actions） ────────────┐
│                                                                        │
│  data/docs/<部署>/*.pdf|*.docx                                         │
│        │  LocalFolderSource（DocumentSource インターフェース）          │
│        ▼                                                               │
│  extract.ts   PDF → pdf-parse / Word → mammoth、NFKC 正規化            │
│        ▼                                                               │
│  metadata.ts  冒頭行「部署: / 客先: / 作成:」→ 無ければフォルダ名       │
│        ▼                                                               │
│  chunk.ts     見出し単位に分割 → 500 トークン上限、50 トークン重なり     │
│        ▼                                                               │
│  embed.ts     OpenAI text-embedding-3-small（1536 次元）               │
│        ▼                                                               │
│  run.ts       SHA-256 で差分判定 → documents / chunks に保存            │
│               （postgres ロール = 取り込み専用。ボットには渡さない）      │
└────────────────────────────────────────────────────────────────────────┘

┌──────────── 質問応答（リアルタイム / あなたの PC 上） ───────────────┐
│                                                                        │
│  Slack（メンション or DM）                                              │
│        │  Socket Mode（公開 URL 不要）                                  │
│        ▼                                                               │
│  slack/handlers.ts   Slack ユーザー ID を取得                           │
│        ▼                                                               │
│  search/answer.ts                                                      │
│    1. search.ts    質問を Embedding → rag_bot ロールで検索               │
│                    BEGIN; set_config('app.slack_user_id', ...); SELECT │
│                    ↳ RLS が「所属部署のチャンクだけ」を並べ替え前に絞る   │
│    2. threshold.ts 1 位の類似度 < 閾値 → 「該当なし」（LLM を呼ばない）  │
│    3. generate     gpt-5-nano に「参考文書だけを根拠に、[n] 付きで」     │
│                    出典番号が無い / NO_ANSWER → 「該当なし」             │
│    4. audit/log.ts search_logs に 誰が・いつ・何を・何が返ったか         │
│        ▼                                                               │
│  slack/format.ts   本文 + 出典一覧 + 類似度 を Block Kit で返信          │
└────────────────────────────────────────────────────────────────────────┘
```

## 権限制御の仕組み（RLS）

```
                 ┌────────────── PostgreSQL（Supabase） ──────────────┐
 rag_bot 接続 →  │ BEGIN                                               │
                 │ set_config('app.slack_user_id', 'U123', true)       │
                 │ SELECT ... FROM chunks ORDER BY embedding <=> $1    │
                 │        ▲                                            │
                 │        │ RLS ポリシー chunks_by_department:          │
                 │        │   department_id IN (                       │
                 │        │     SELECT department_id FROM user_departments│
                 │        │     WHERE slack_user_id = current_slack_user_id())│
                 │ COMMIT                                              │
                 └─────────────────────────────────────────────────────┘
```
- `rag_bot` は SELECT のみ、`BYPASSRLS` なし。監査ログは自分名義の INSERT のみ
- `set_config` を忘れると `current_slack_user_id()` が空文字 → 0 件（安全側）
- 検証: `tests/rls-local.test.ts`（PGlite でマイグレーションを流して検証、Supabase 不要）と `tests/rls.test.ts`（本番 DB）

## 差し替えポイント（Phase 2）
| 変えたいもの | 触るファイル |
|---|---|
| 取り込み元を SharePoint に | `src/sources/SharePointSource.ts` を実装し、`src/cli/ingest.ts` で選択 |
| Embedding を Batch API に | `EmbeddingClient` を実装する新クラスを `src/ingest/embed.ts` に追加 |
| 生成モデル | `.env` の `CHAT_MODEL` |
| 全文検索（BM25）との併用 | `src/search/search.ts` にスコア合成を追加 |
| HNSW インデックス | `supabase/migrations/` に追加（コメントに SQL あり） |
| 役職階層 | `user_departments` に列追加 + `0003_roles_rls.sql` のポリシー条件に AND |
