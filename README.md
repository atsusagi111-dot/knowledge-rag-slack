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

## 必要なもの

| サービス | プラン | 用途 |
|---|---|---|
| Node.js 20 以上 | 無料 | 実行環境 |
| Supabase | Free | PostgreSQL + pgvector + RLS |
| OpenAI API | 前払い（最低 $5） | Embedding（text-embedding-3-small）と要約（gpt-5-nano） |
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
npm run db:stats                                 # 無料枠の使用量
```

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
npm test           # 単体テスト + ローカル RLS テスト（PGlite）+ 実 DB の RLS テスト（.env があるとき）
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

### 9. 定期取り込み（任意）
GitHub のプライベートリポジトリに push し、Settings → Secrets に `DATABASE_URL_INGEST` `DATABASE_URL_BOT` `RAG_BOT_PASSWORD` `OPENAI_API_KEY` を登録すると、
`.github/workflows/ingest.yml` が 3 日おきに DB へアクセスし、Supabase Free の「1 週間非アクティブで一時停止」を防ぐ。
リポジトリに 60 日間コミットが無いと schedule は止まるので、月 1 回は手動 Run かコミットをする。

## 設定値（.env）
| 変数 | 既定 | 意味 |
|---|---|---|
| `CHAT_MODEL` | gpt-5-nano | 要約に使うモデル。品質不足なら gpt-5-mini |
| `EMBEDDING_MODEL` | text-embedding-3-small | 次元数 1536（DB と一致させる） |
| `SEARCH_TOP_K` | 8 | 回答に使う上位チャンク数 |
| `SIMILARITY_THRESHOLD` | 0.40 | これ未満は「該当なし」。`npm run eval` の「閾値の目安」で校正 |
| `EMBEDDING_PROVIDER` | openai | `fake` にすると OpenAI を呼ばない簡易ベクトル（ローカル確認用） |
| `LLM_PROVIDER` | openai | `fake` にすると 1 位チャンクを引用する模擬応答 |
| `DB_BOT_SET_ROLE` | (空) | ローカル PGlite 用。`rag_bot` を指定すると検索トランザクション内で SET ROLE する |

## セキュリティ設計の要点
- ボットは `rag_bot` ロール（SELECT のみ・`BYPASSRLS` なし）で接続し、検索のたびにトランザクション内で Slack ユーザー ID を `set_config` する
- RLS ポリシーが「そのユーザーの所属部署の行」だけを返す。ベクトル検索の **並べ替え前** に除外されるので、他部署のデータはアプリまで届かない
- `set_config` を忘れると 0 件（安全側）。`tests/rls.test.ts` が「人事ユーザーは IT 文書を 0 件」を毎回検証
- 取り込み用の接続 URL（postgres ロール）はボットに渡さない。`.env` と `data/` は git 管理外

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
