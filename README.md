# 社内ナレッジ検索 RAG（Slack ボット）— MVP 無料枠版

> 学習・ポートフォリオ目的の模擬案件です。文書・企業名・数値はすべて架空で、実在の組織とは関係ありません。
> 秘密情報（API キー、DB 接続情報、Slack ID）はリポジトリに含まれていません。

Slack で質問すると、社内文書（PDF / Word）から関連箇所を探し、出典付きで要約して返すボットです。
部署単位のアクセス制御を PostgreSQL の RLS（行ごとの閲覧権限制御）で実装しています。
設計の全体像・費用試算・Phase 2 ロードマップは [docs/plan.md](docs/plan.md) を参照。

```
ローカルフォルダ → 抽出 → 見出し単位チャンク → OpenAI Embedding → Supabase(pgvector)
Slack(Socket Mode) → 質問を Embedding → RLS 付きベクトル検索 → 閾値判定 → OpenAI で出典付き要約 → 返信 + 監査ログ
```

## 納品物チェックリストの確認結果（2026-09-06、すべて手動で確認）

| # | 項目 | 結果 | 確認方法 |
|---|---|---|---|
| ① | 取り込み完了 + 失敗ゼロ | 合格（37 件、失敗 0） | Slack で 15 問、`npm run ingest` の結果行、`npm run db:stats`。5,000 件は Phase 2（差分取り込みの設計は同じ） |
| ② | Cron で新規追加が自動取り込み | 合格 | GitHub Actions `ingest` のログに `inserted sales/sales-07-sports-ec.docx`、直後に Slack で回答 |
| ③ | 15 問テストで 80% 以上 | 合格（Recall@5 1.00、該当なし 3/3） | `npm run eval` → [docs/eval-latest.md](docs/eval-latest.md) |
| ④ | 全回答にファイル名 + ページ番号 | 合格 | 出典が `文書名 ファイル名 p.N（部署 / 見出し）類似度` の形式 |
| ⑤ | 3 秒以内 ACK + 10 秒以内に回答 | 合格（受付リアクション即時、回答 3〜7 秒） | Bolt はイベント受信直後に ack、質問に虫めがねを付けてから処理、回答末尾に ms 表示 |
| ⑥ | 他部署文書が検索結果に出ない | 合格 | 人事のみアカウントで IT 文書の質問が該当なし。RLS テスト 17 件（PGlite + 実 DB） |
| ⑦ | 誰がいつ何を質問したか追跡可能 | 合格 | Supabase `search_logs`。月次で部署管理者へ Slack DM |
| ⑧ | 機密扱い変更時の対応フロー | 合格 | 機密化で本人でも該当なし、`npm run redact` で Slack 回答削除 + ログ redact + 隔離 → [docs/governance-for-client.md](docs/governance-for-client.md) |

## 必要なもの

| サービス | プラン | 用途 |
|---|---|---|
| Node.js 20 以上 | 無料 | 実行環境 |
| Supabase | Free | PostgreSQL + pgvector + RLS |
| OpenAI API | 前払い（最低 $5） | Embedding（text-embedding-3-small）と要約（gpt-5-mini） |
| Slack | Free | ボットの入口（Socket Mode。公開 URL 不要） |
| GitHub | Free | 定期取り込み（Actions）。任意 |

## まず手元だけで動かしてみる（Supabase / OpenAI 不要）

PGlite（Node の中で動く PostgreSQL）と偽の Embedding を使い、取り込み → 検索 → 回答 → 評価を通しで試せる。
偽 Embedding は文字の並びからベクトルを作るだけなので、検索精度は本物より低い。仕組みの確認用。

1. ターミナル A（`模擬案件7` フォルダ）でローカル DB を起動したままにする
   ```
   npm run local:db
   ```
2. ターミナル B で、`.env.local.example` を `.env.local` にコピーし、以後のコマンドの前に 1 回だけ実行
   ```
   $env:DOTENV_CONFIG_PATH = ".env.local"
   ```
3. 順番に実行
   ```
   npm run db:migrate
   npm run db:seed-users -- data/master/user_departments.example.csv
   npm run ingest
   npm run search -- --user UALLDEPTS "クラウド移行でコストはどれだけ下がった"
   npm run search -- --user UHRONLY  "クラウド移行でコストはどれだけ下がった"   # 人事のみ → IT 文書は出ない
   npm run answer -- --user UALLDEPTS "基幹システム移行で使われたデータベースは"
   npm run eval
   ```
`$env:DOTENV_CONFIG_PATH` を消せば（ターミナルを閉じれば）通常の `.env`（Supabase）に戻る。

## セットアップ（すべて `模擬案件7` フォルダで実行）

### 1. 依存関係
```
npm install
```

### 2. Supabase
1. https://supabase.com で New project（リージョン Tokyo）。DB パスワードを控える
2. Database → Extensions → `vector` を有効化
3. Project Settings → Database → Connection string → **Session pooler** の URL をコピー
4. `.env.example` をコピーして `.env` を作り、`DATABASE_URL_INGEST` にその URL、`RAG_BOT_PASSWORD` に任意のパスワードを入れる
5. `DATABASE_URL_BOT` は同じ URL のユーザー名 `postgres.xxxx` を `rag_bot.xxxx` に、パスワードを `RAG_BOT_PASSWORD` の値に置き換えたもの

```
npm run db:ping      # ok が 2 行出れば成功（bot 接続は migrate 後）
npm run db:migrate   # テーブル・ロール・RLS を作成
npm run db:ping      # bot 接続も ok になる
```

### 3. 部署マスタ（Slack ユーザー ↔ 部署）
`data/master/user_departments.example.csv` を `user_departments.csv` にコピーし、Slack のユーザー ID（プロフィール → その他 → メンバー ID をコピー）を入れる。
```
npm run db:seed-users
```

### 4. 文書の取り込み
`data/docs/<部署フォルダ>/` に PDF / .docx を置く。部署フォルダ名は `strategy / operations / it / hr / sales / admin`（日本語名でも可）。
文書の冒頭に `部署: 戦略 / 客先: XX / 作成: 2024年` の行があればそちらが優先される。

```
npm run extract -- data/docs/strategy/xxx.pdf   # テキスト抽出とメタデータの確認
npm run chunk   -- data/docs/strategy/xxx.pdf   # チャンク分割の確認
npm run ingest  -- --dry-run                     # DB・OpenAI を使わずに件数確認
npm run ingest                                   # 本番取り込み（未変更ファイルはスキップ）
npm run ingest  -- --prune                       # フォルダから消えた文書を DB からも削除
npm run ingest  -- --retry-failed                # 前回失敗したファイルだけ再試行
npm run db:stats                                 # 無料枠の使用量
```

### 4b. 機密文書の運用（ガバナンス）
```
npm run doc:classify -- --path it/xxx.pdf --department confidential   # 機密扱いに変更（Table Editor で department_id を変えても同じ）
npm run redact       -- --path it/xxx.pdf --reason "理由" --delete-slack  # 誤アップロードの取り消し（文書削除 + ログ redact + Slack 回答削除 + 隔離）
npm run report       -- --month 2026-09                                 # 月次監査レポートを部署管理者へ Slack DM
npm run db:seed-managers                                                # 部署管理者マスタ（data/master/department_managers.csv）
```
手順書: [docs/governance-for-client.md](docs/governance-for-client.md)（担当者向け）、[docs/confidentiality-change-flow.md](docs/confidentiality-change-flow.md)（技術詳細）

Markdown から Word を作るには: `npx tsx scripts/md-to-docx.ts <file.md | フォルダ>`
サンプル文書の書き方は [docs/sample-docs-guide.md](docs/sample-docs-guide.md) を参照。

### 5. 検索・回答のテスト（Slack 無しで動く）
```
npm run search -- --user U0123ABC "銀行向け DX 提案の ROI"
npm run answer -- --user U0123ABC "銀行向け DX 提案の ROI は？"
```

### 6. 評価（15 問を自動実行して Recall@5 を集計）
`eval/users.json` にテストユーザーの Slack ID を入れて:
```
npm run eval             # 結果は eval/results/ に Markdown で保存
npm run eval -- --no-llm # OpenAI の生成を呼ばず、検索と閾値だけ評価
```

### 7. テスト
```
npm test           # 単体テスト + ローカル RLS テスト（PGlite）。実 DB には触れない
npm run test:rls   # 実 DB の RLS テストのみ
```
`tests/rls-local.test.ts` は PGlite（Node 内で動く PostgreSQL）に `supabase/migrations` をそのまま流し、
Supabase 無しで「人事ユーザーは IT 文書を 0 件しか見られない」ことを検証する。

### 8. Slack ボット
1. https://api.slack.com/apps → Create New App → From scratch
2. **Socket Mode** → Enable。App-Level Token を `connections:write` で作成 → `SLACK_APP_TOKEN`（xapp-）
3. **OAuth & Permissions** → Bot Token Scopes: `app_mentions:read` `chat:write` `im:history` `im:read` `im:write` `reactions:write`
4. **Event Subscriptions** → Enable → Subscribe to bot events: `app_mention` `message.im`
5. **App Home** → Messages Tab を有効化、「Allow users to send Slash commands and messages from the messages tab」に✓
6. Install to Workspace → Bot User OAuth Token → `SLACK_BOT_TOKEN`（xoxb-）
7. 起動:
```
npm run bot
```
チャンネルにボットを招待して `@bot 質問` するか、DM で質問する。

機密扱いの変更（文書の部署変更・除外、人の異動）の手順は [docs/confidentiality-change-flow.md](docs/confidentiality-change-flow.md)。

**回答の見える範囲**: チャンネルでメンションした場合、回答本文は質問者への DM に送られ、スレッドには「DM に送りました」とだけ残る。
チャンネルには文書を見る権限の無い人もいるため。質問文そのものはチャンネルに残るので、質問内容も見られたくない場合は DM で聞く。

### 9. 運用 Cron（GitHub Actions）
Settings → Secrets に `DATABASE_URL_INGEST` `DATABASE_URL_BOT` `RAG_BOT_PASSWORD` `OPENAI_API_KEY` `SLACK_BOT_TOKEN` を登録する。

| 頻度 | ワークフロー | 処理 |
|---|---|---|
| 毎日 02:00 JST | `ingest.yml` | `data/docs/` の差分取り込み。Supabase Free の「1 週間非アクティブで一時停止」も防ぐ |
| 毎週月曜 02:30 JST | `weekly-retry.yml` | `ingest_failures` に記録された失敗ファイルだけ再試行 |
| 毎月 1 日 09:00 JST | `monthly-report.yml` | 先月分の監査レポートを部署管理者へ Slack DM（送付先は `data/master/department_managers.csv` → `npm run db:seed-managers`） |

リポジトリに 60 日間コミットが無いと schedule は止まるので、月 1 回は手動 Run かコミットをする。
この MVP では文書がすべて架空のため `data/docs/` を git に含めて Actions が読めるようにしている。実案件では `.gitignore` で除外に戻し、SharePoint 連携（Phase 2）に置き換える。

## 設定値（.env）
| 変数 | 既定 | 意味 |
|---|---|---|
| `CHAT_MODEL` | gpt-5-mini | 要約に使うモデル。nano は「該当なし」判定が不安定だったため mini を既定に（1 問 0.3 円程度） |
| `EMBEDDING_MODEL` | text-embedding-3-small | 次元数 1536（DB と一致させる） |
| `CHAT_REASONING_EFFORT` | low | gpt-5 系の推論量。minimal は最速だが不安定、medium 以上は 10 秒超 |
| `SEARCH_TOP_K` | 8 | 回答に使う上位チャンク数 |
| `SIMILARITY_THRESHOLD` | 0.40 | これ未満は「該当なし」。`npm run eval` の「閾値の目安」で校正 |
| `EMBEDDING_PROVIDER` | openai | `fake` にすると OpenAI を呼ばない簡易ベクトル（ローカル確認用） |
| `LLM_PROVIDER` | openai | `fake` にすると 1 位チャンクを引用する模擬応答 |
| `DATABASE_SSL` | require | ローカル PGlite は `disable` |

## 計画からの主な変更点（実装して分かったこと）
- 生成モデル: gpt-5-nano → **gpt-5-mini**。nano は「該当する文書が無い」場面で別案件の数値を流用することがあり、mini は安定して該当なしを返した（1 問 0.3 円程度）
- 推論量 `reasoning_effort=low`: 既定のままだと 11 秒、low で 3〜7 秒。minimal は最速だが判定が不安定
- チャンクの先頭に「文書タイトル > 見出し」を付与、上位 8 件: 客先名入りの質問で数値だけのセクションが拾えなかった問題への対策
- 箇条書きの「●」を見出し扱いしない: Word → PDF 変換で細切れになっていた
- 機密区分（7 番目の部署）、部署変更トリガー、取り消しコマンド、月次レポート、失敗リトライを追加
- チャンネルでの質問は回答を DM に送る（チャンネルの他メンバーに見せない）

## セキュリティ設計の要点
- ボットは `rag_bot` ロール（SELECT のみ・`BYPASSRLS` なし）で接続し、検索のたびにトランザクション内で Slack ユーザー ID を `set_config` する
- RLS ポリシーが「そのユーザーの所属部署の行」だけを返す。ベクトル検索の **並べ替え前** に除外されるので、他部署のデータはアプリまで届かない
- `set_config` を忘れると 0 件（安全側）。`tests/rls.test.ts` が「人事ユーザーは IT 文書を 0 件」を毎回検証
- 取り込み用の接続 URL（postgres ロール）はボットに渡さない。`.env` と `data/` は git 管理外
- 監査ログ `search_logs` の保存に失敗したら回答を返さずエラーにする（「ログの無い回答は存在しない」）。検索と同一トランザクションにはしない: LLM 生成の 2〜10 秒間 DB 接続を占有しないため。`tests/answer.test.ts` で検証

## ディレクトリ
```
src/config.ts        環境変数・モデル名・閾値
src/db/              接続（ingest 用 / bot 用）とマイグレーション
src/sources/         DocumentSource IF、LocalFolderSource、SharePoint/GoogleDrive スタブ
src/ingest/          抽出 → メタデータ → チャンク → Embedding → 保存
src/search/          RLS 付き検索 → 閾値 → 出典付き回答生成
src/slack/           Bolt（Socket Mode）ハンドラと整形
src/audit/           監査ログ
src/cli/             各種コマンド（db:ping, ingest, search, answer, eval ...）
supabase/migrations/ テーブル・ロール・RLS ポリシー
eval/                テスト質問 15 問と結果
tests/               単体テスト + RLS 権限テスト
```

## サンプル文書の再生成
`samples/<部署>/*.md` が 36 件の元原稿（架空のコンサル案件）。次で PDF / Word を作れる（Word がインストールされた Windows）。
```
npx tsx scripts/md-to-docx.ts samples/strategy          # md → docx（部署ごとに実行）
powershell -ExecutionPolicy Bypass -File scripts/docx-to-pdf.ps1 samples/strategy -DeleteSource   # docx → pdf
```
できたファイルを `data/docs/<部署>/` に置いて `npm run ingest`。最新の評価結果は [docs/eval-latest.md](docs/eval-latest.md)。
