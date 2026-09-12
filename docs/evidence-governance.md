# ガバナンス要件の実装証跡（提出用）

要件メモ「3. ガバナンス手順書」「4. 運用 Cron の最終構成」「2. 監査ログの設計」が実装・稼働していることを示す証跡の一覧。
手順書本体は [governance-for-client.md](governance-for-client.md)、技術的背景は [confidentiality-change-flow.md](confidentiality-change-flow.md)。

リポジトリ: https://github.com/atsusagi111-dot/knowledge-rag-slack

## 1. 監査ログ（要件メモ 2 章）

| 要件 | 実装 | 証跡 |
|---|---|---|
| 誰が・いつ・何を質問し・どの文書が取り出されたかを記録 | `search_logs`（`slack_user_id` / `created_at` / `question` / `top_chunk_ids` / `department_ids` / `channel_id` / `result_status`） | [supabase/migrations/0002_tables.sql](../supabase/migrations/0002_tables.sql) L64。Supabase Table Editor の `search_logs` 画面 |
| ログ書き漏れの防止（メモ: 同一トランザクション） | ログ保存に失敗したら回答を返さずエラー（「ログの無い回答は存在しない」）。同一トランザクションにしない理由は README「セキュリティ設計の要点」 | [src/search/answer.ts](../src/search/answer.ts) 末尾。テスト `npx vitest run tests/answer.test.ts` → 7 passed |

## 2. ガバナンス手順書（要件メモ 3 章）

| 手順 | 実装 | 証跡 |
|---|---|---|
| ① 機密扱いに変更 | `documents.department_id` 更新トリガーが `chunks` を同期し `department_locked` を付与。CLI `npm run doc:classify` | [supabase/migrations/0006_governance.sql](../supabase/migrations/0006_governance.sql)、[src/cli/classify.ts](../src/cli/classify.ts) |
| ② 完全に削除（誤アップロード取り消し） | `npm run redact`: documents+chunks ハード削除、元ファイル隔離、監査ログの該当チャンク redact、Slack 投稿削除、`redactions` に記録 | [src/cli/redact.ts](../src/cli/redact.ts)、[0005_redaction.sql](../supabase/migrations/0005_redaction.sql)。実行記録は月次レポートの「取り消し（redact）の記録」に 2 件（2026-09-06） |
| ③ 監査ログ確認 | Table Editor で `search_logs`。月次で部署管理者へ Slack DM | 下記 3 の monthly-report |

## 3. 運用 Cron（要件メモ 4 章）

| 頻度 | 処理 | ワークフロー | 稼働証跡 |
|---|---|---|---|
| 毎日 02:00 JST | 差分取り込み | [ingest.yml](../.github/workflows/ingest.yml) | Actions で 2026-09-07〜09-12 に毎日 `schedule` 実行、すべて success |
| 毎週月曜 02:30 JST | 失敗ファイルのリトライ | [weekly-retry.yml](../.github/workflows/weekly-retry.yml) | 2026-09-07 02:22 JST に `schedule` 実行 success |
| 毎月 1 日 09:00 JST | 監査ログ集計レポート → 部署管理者へ Slack DM | [monthly-report.yml](../.github/workflows/monthly-report.yml) | 初回の自動実行は 2026-10-01。動作証明として 2026-09-12 に 9 月分を手動実行: https://github.com/atsusagi111-dot/knowledge-rag-slack/actions/runs/34663887777 （success、Slack DM 送付 7 / 7 名、レポートは Artifacts の `audit-report`） |

Actions 一覧: https://github.com/atsusagi111-dot/knowledge-rag-slack/actions

手動実行した 9 月分レポートの内容（抜粋）:

| 部署 | 質問数 | 利用者数 | 回答 | 該当なし | エラー | 取り消し対象 | 平均応答 ms |
|---|---|---|---|---|---|---|---|
| 人事 | 48 | 2 | 37 | 11 | 0 | 4 | 9077 |
| IT | 44 | 1 | 36 | 8 | 0 | 4 | 9590 |
| 機密 | 0 | 0 | 0 | 0 | 0 | 0 | - |

（人事だけ利用者 2 名 = 全部署所属の本人 + 人事のみのテストアカウント。質問数の差 4 件が、人事アカウントで「該当なし」になった権限制御の記録）

要件メモとの違い: メモは月次レポートを Claude Code Headless（`claude -p`）で回す案だったが、定型集計は専用スクリプト `npm run report` で決定的に行う（理由は governance-for-client.md 末尾）。

## 提出用スクリーンショットの候補

1. Slack: 本人アカウントへの回答（出典にファイル名・ページ・類似度）
2. Slack: 人事のみアカウントで同じ質問 → 「該当する文書は見つかりませんでした」
3. Slack: 月次レポートの DM（2026-09-12 手動実行分）
4. GitHub Actions 一覧（ingest が毎日 success、monthly-report の success）
5. Supabase Table Editor の `search_logs`（1・2 の質問の行。人事の行は `result_status = no_hit`、`top_chunk_ids` が空）
