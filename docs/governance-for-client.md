# 機密文書の取り扱いガバナンス（ナレッジ担当者向け手順書）

対象: 社内ナレッジ検索ボットの運用担当者。技術的な背景は [confidentiality-change-flow.md](confidentiality-change-flow.md) を参照。
本手順書は MVP（ローカルフォルダ取り込み・管理画面なし）の構成に基づく。Phase 2（SharePoint 連携・専用管理画面）で変わる箇所は注記した。

## ① 機密扱いに変更したい場合

1. 管理画面（Supabase の Table Editor）で `documents` テーブルを開き、該当文書の行を選ぶ
2. `department_id` を `confidential`（機密）に変更して保存
   → その瞬間から、部署マスタで「機密」を付与された人以外の検索結果に出なくなる
   → 定期取り込みで元の部署に戻らないよう、自動でロックされる（`department_locked`）
3. 機密文書を見てよい人は、部署マスタ（`user_departments.csv`）に `confidential` の行を追加して `npm run db:seed-users`

コマンドで行う場合: `npm run doc:classify -- --path <部署/ファイル名> --department confidential`

## ② 完全に削除したい場合（誤アップロードの取り消し）

1. `npm run redact -- --path <部署/ファイル名> --dry-run` で影響範囲（その文書を根拠に回答した質問の一覧）を確認
2. `npm run redact -- --path <部署/ファイル名> --reason "理由" --delete-slack` を実行
   → `documents` と `chunks` をハード削除
   → 元ファイルを `data/quarantine/` に隔離（Phase 2: SharePoint 上の元ファイルを API で削除）
   → 監査ログ `search_logs` の `top_chunk_ids` から該当チャンクを redact し、`redacted_at` と理由を記録（ログ行自体は残す）
   → 回答を投稿した Slack メッセージをボットが削除
   → `redactions` テーブルに取り消しの記録
3. 確認: 同じ質問を Slack で聞いて「該当なし」になること。`redactions` に 1 行増えていること

限界: 人が読んだ内容と、Slack の通知プレビューに残った断片は取り消せない。転載禁止の運用ルールで補う。

## ③ 監査ログ確認

- Supabase の Table Editor で `search_logs` を開く（SQL Editor での集計クエリは confidentiality-change-flow.md に例あり）
- 「誰が（`slack_user_id`）」「いつ（`created_at`）」「何を質問したか（`question`）」「結果（`result_status`）」「根拠にした文書（`top_chunk_ids`）」を全件追跡できる
- 月次で部署管理者にレポートを Slack DM（Cron 自動実行）。送付先は `department_managers.csv`

## ④ 運用 Cron の最終構成（GitHub Actions）

| 頻度 | 処理 | ワークフロー | 用途 |
|---|---|---|---|
| 毎日 02:00 JST | 差分取り込み | `ingest.yml` | 新規追加・変更文書を自動取り込み（既存は差分判定でスキップ）。Supabase Free の一時停止防止も兼ねる |
| 毎週月曜 02:30 JST | 失敗ファイルのリトライ | `weekly-retry.yml` | `ingest_failures` に記録された前回失敗分だけを再試行 |
| 毎月 1 日 09:00 JST | 監査ログ集計レポート | `monthly-report.yml` | 部署別の利用状況・該当なし件数・取り消し件数を部署管理者へ Slack DM |

Phase 2 で SharePoint 連携に切り替えるときは、`ingest.yml` の取り込み元を `SharePointSource` に変えるだけで、上の 3 本の構成は変わらない。

## 補足: 定型レポートを LLM に任せない理由

月次レポートは「毎回同じ定義で同じ数字が出る」ことが価値であり、専用スクリプト（`npm run report`）で決定的に集計している。
Claude Code などの LLM に集計を任せる案は、集計定義の揺れ・実行環境への API キー配置・毎月の利用料の点で、定型処理には向かない。
LLM は「レポートの数字を深掘りする」ような非定型の分析に使う。
