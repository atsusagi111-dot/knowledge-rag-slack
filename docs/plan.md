# 社内ナレッジ検索 RAG（Slack ボット）実装計画 — MVP 無料枠版
作成日: 2026-09-06 / 保存先: `docs/plan.md`（承認済み）

> RAG = Retrieval-Augmented Generation。質問に関係する文書を先に検索し、その内容だけを材料に LLM が回答を書く方式。

## 0. Context（なぜこの計画か）

- コンサル会社（100 名・6 部署）向けに「Slack で質問 → 社内文書から出典付きで要約」する検索システムを、実案件を想定した学習課題として作る。
- **MVP は無料枠だけで動かす**ことが最優先の制約。課金が要るものは Phase 2 に回す。
- 唯一の実費は OpenAI API（後述、MVP 合計で 100 円未満の見込み。ただし最低前払い $5 が必要）。
- 現在のフォルダには、サンプル文書 4 件（PDF + Markdown）と テスト質問 12 問の CSV がある。コードはまだ無い（新規プロジェクト）。

### 確認済みの前提（あなたの回答）
| 項目 | 決定 |
|---|---|
| テスト質問 | 15 問に増やす（不足 3 問は私が作成） |
| サンプル文書 | あなたが手作業で用意する（推奨件数は §3 参照） |
| 部署の判定 | 文書冒頭行 `部署: 戦略 / ...` を優先、無ければフォルダ名 |
| 権限モデル | 厳格モデル。自部署の文書のみ閲覧可。1 人が複数部署に所属できる（多対多） |
| 環境 | Node.js 導入済み / Supabase・OpenAI・GitHub アカウントあり / Slack は未作成 / このフォルダに git init して良い |

---

## 1. 全体アーキテクチャ

```
【取り込み（バッチ）】                       【質問応答（リアルタイム）】

 ローカルフォルダ                             Slack（あなたの PC で稼働）
 data/docs/<部署>/*.pdf|*.docx                    │ ①メンション or DM で質問
        │                                          ▼
        ▼                                  Slack Bolt ボット（Socket Mode）
 DocumentSource（抽象）                      Node.js プロセス、あなたの PC 上
  ├ LocalFolderSource ← MVP で実装                  │ ② Slack ユーザーID を取得
  ├ SharePointSource  ← スタブ（Phase 2）           │ ③ 質問文を Embedding 化（OpenAI）
  └ GoogleDriveSource ← スタブ                      ▼
        │ ② ファイル読み込み                 Supabase PostgreSQL + pgvector
        ▼                                     ┌──────────────────────────────┐
 テキスト抽出                                 │ RLS: 「この Slack ユーザーが │
  pdf → pdf-parse / docx → mammoth            │ 所属する部署の chunk だけ」  │
        │                                     │ を検索の“時点”で絞る         │
        ▼                                     │  → 類似度 上位5件            │
 メタデータ抽出 + チャンキング                 └──────────────────────────────┘
  (部署・作成年・文書種別 / 見出し単位)             │ ④ 上位5件 + スコア
        │                                          ▼
        ▼                                   閾値判定：スコアが低ければ「該当なし」
 Embedding（OpenAI text-embedding-3-small）          │
        │                                          ▼
        ▼                                   回答生成（OpenAI gpt-5-nano）
 Supabase に保存                              「出典付きで要約。根拠が無ければ該当なしと言う」
  documents / chunks(embedding) テーブル            │
                                                   ▼
                                            Slack に返信 + search_logs に監査ログ
```

用語の 1 行説明
- Embedding = 文章を「意味を表す 1536 個の数値の並び（ベクトル）」に変換したもの。似た意味の文章はベクトルも近くなる。
- pgvector = PostgreSQL でベクトルを保存し「意味が近い順」に検索するための拡張機能。
- Supabase = PostgreSQL をクラウドで無料提供してくれるサービス。
- RLS（Row Level Security）= テーブルの「行ごと」に、誰が見て良いかを DB 側で強制する仕組み。
- Socket Mode = Slack 側からあなたの PC へ WebSocket で接続してくる方式。公開 URL やサーバーが不要。
- チャンク = 文書を検索しやすい大きさ（数百字）に切った断片。

### データの流れ（初心者向けの要約）
1. 取り込みスクリプトが `data/docs/` の PDF/Word を読み、見出し単位に切って、OpenAI でベクトル化し、Supabase に保存する。
2. Slack で質問すると、ボットが質問をベクトル化し、Supabase に「この人が見て良い文書の中で」近いチャンクを 5 件求める。
3. 5 件の類似度が低ければ「該当なし」。十分なら OpenAI に「この 5 件だけを根拠に、出典番号付きで答えて」と依頼し、Slack に返す。
4. 誰が・いつ・何を聞いて・何件ヒットしたかを監査ログに残す。

---

## 2. 技術選定の理由と懸念点

| 領域 | 選定 | 理由 | 懸念・不確実な点 |
|---|---|---|---|
| 言語 | TypeScript（Node.js 20+、`tsx` で直接実行） | Slack Bolt・OpenAI SDK の公式サポートが厚い。型があると初心者でも間違いに早く気づける | なし |
| パッケージ管理 | npm | 追加インストール不要 | なし |
| DB | Supabase Free（PostgreSQL + pgvector） | 無料で pgvector と RLS が使える唯一級の選択肢 | 1 週間非アクティブで一時停止（§9） |
| DB 接続 | `postgres`（postgres.js）で直接 SQL | RLS に「今の Slack ユーザーは誰か」を伝えるため、トランザクション内で `set_config` を使う必要があり、supabase-js より素直に書ける（§5）。 | Free プランの直接接続は IPv6 のみ。**Session Pooler（IPv4）のURL** を使う |
| マイグレーション | 番号付き SQL ファイル + 自作の小さな適用スクリプト | Supabase CLI は Docker 前提の機能が多く初心者の障害になりやすい | 本番規模では Supabase CLI 移行を検討（Phase 2） |
| PDF 抽出 | `pdf-parse` | 純 JS、依存が軽い | 見出し情報（フォント）は失われるので、番号付き見出しの正規表現で分割する |
| Word 抽出 | `mammoth` | .docx → 見出し付き HTML/テキストに変換できる（見出し単位分割と相性が良い） | 古い .doc は非対応（Phase 2 扱い） |
| Embedding | OpenAI `text-embedding-3-small`（1536 次元） | 最安 $0.02/1M トークン、日本語精度も実用的 | なし |
| 生成 | OpenAI `gpt-5-nano`（第一候補）/ `gpt-5-mini`（精度不足時） | 最安クラス。要約タスクなら nano で足りる見込み | nano で日本語要約の品質が低ければ mini に切替（1 行の設定変更で可能にする） |
| Slack | `@slack/bolt` Socket Mode | 公開 URL・ホスティング不要。無料プランで動く | あなたの PC を閉じると停止（MVP では許容、Phase 2 でホスティング） |
| 定期実行 | まず手動スクリプト → GitHub Actions schedule | 無料枠 2,000 分/月で十分 | 60 日間リポジトリに更新が無いと schedule が自動停止する仕様 |
| 管理画面 | **作らない** | 部署マスタは CSV → SQL 投入で足りる。Next.js を入れると学習範囲が倍になる | 必要になったら Phase 2 |
| テスト | `vitest` | 設定が少なく速い | なし |

**検討して採用しなかった案**
- supabase-js + カスタム JWT で RLS：JWT の署名鍵の扱い（新旧 API キー体系）が初心者に難しい。
- LangChain / LlamaIndex：抽象化が厚く、何が起きているか見えにくい。今回は「仕組みを学ぶ」のが目的なので素の SDK で書く。
- HNSW インデックス：MVP のチャンク数（数百）ではインデックス無しの全件走査で十分速い。RLS フィルタと HNSW の相性問題（絞り込み後に件数不足）も避けられる。Phase 2 で追加。

---

## 3. MVP で使う無料サービス一覧

| サービス | 無料枠の上限（公式 2026-09 確認） | MVP 想定使用量 | 超えたらどうなるか |
|---|---|---|---|
| Supabase Free | DB 500MB / ファイル 1GB / 転送 5GB / アクティブ 2 プロジェクト / **1 週間非アクティブで一時停止** | DB 約 20〜40MB（下記試算） | 書き込み拒否・読み取り専用化の可能性。Pro $25/月 |
| OpenAI API | 無料枠なし。**前払い最低 $5（約 750 円）** | 100 円未満（§4） | 残高切れで API エラー。追加チャージ |
| Slack Free | ワークスペース無料。ボット 1 つ・Socket Mode 可 | 1 ワークスペース、ボット 1 | 90 日以上前のメッセージ非表示のみ。機能影響なし |
| GitHub Free（プライベート） | Actions 2,000 分/月、ストレージ 500MB | 週 1〜2 回 × 数分 = 月 10〜20 分 | 実行停止。有料分購入 |
| Node.js（ローカル） | 無料 | ボット + スクリプト実行 | — |

**Supabase 容量の逆算とサンプル件数の提案**
- チャンク 1 件 = 本文 約 1.5KB（日本語 500 トークン相当）+ ベクトル 1536 × 4 バイト ≒ 6KB + 付随 ≒ **約 8KB**（インデックス無し）
- 500MB のうちシステム領域で 50MB 程度使うため、安全圏を 250MB とすると **約 30,000 チャンク**まで。
- 本番 5,000 件 × 20 ページ × 2 チャンク/ページ = 約 20 万チャンク ≒ 1.6GB → **無料枠を超える（Phase 2 で Pro）**
- MVP: **36 件（6 部署 × 6 件）**を推奨。1 件 1〜3 ページなら 200〜400 チャンク ≒ 3MB。容量は全く問題なく、上限を決めるのは「手作業で作れる件数」です。
  - 内訳案: 各部署に PDF 4 件 + Word 2 件。既存の 4 件はそのまま使い、残り 32 件を作る。
  - 各文書の 1 行目に `**部署: 戦略 / 客先: XX / 作成: 2024年 / 機密度: 社外秘**` の形式を入れてください（メタデータ抽出がこの行を読みます）。
  - Word は Markdown を Word で開いて「名前を付けて保存 → .docx」で十分です。見出しは Word の「見出し 1/2」スタイルにすると分割精度が上がります。

---

## 4. OpenAI API 実費概算

前提: 1 ドル = 150 円（2026-09 の仮置き。実レートで読み替え）。日本語 1 ページ ≒ 700 トークン。

### 4-1. モデル選定（公式料金ページ 2026-09-06 確認）
| 用途 | モデル | 料金（1M トークン） | 選定理由 |
|---|---|---|---|
| Embedding | `text-embedding-3-small` | $0.02（Batch 利用時 $0.01） | 最安。`-large` は 6.5 倍高く MVP に不要 |
| 生成（第一候補） | `gpt-5-nano` | 入力 $0.05 / キャッシュ入力 $0.005 / 出力 $0.40 | 現行最安。要約・引用タスク向き |
| 生成（予備） | `gpt-5-mini` | 入力 $0.25 / 出力 $2.00 | nano の日本語品質が不足した場合 |

### 4-2. MVP（36 件 + 開発中の試行）
| 項目 | 計算 | 概算 |
|---|---|---|
| Embedding 初回 | 36 件 × 3 ページ × 700 = 約 76k トークン × $0.02/1M | $0.0015 ≒ **0.2 円** |
| Embedding やり直し（10 回分） | 上記 × 10 | ≒ 2 円 |
| 質問 1 回 | 質問 Embedding ≈ 0 + 生成 入力 3,000 / 出力 500 トークン（nano） | $0.00035 ≒ 0.05 円 |
| 評価スクリプト（15 問 × 30 回実行） | 450 回 × 0.05 円 | ≒ 25 円 |
| 手動テスト（500 回） | 500 × 0.05 円 | ≒ 25 円 |
| **MVP 合計** | | **約 50〜100 円**（gpt-5-mini でも 300〜500 円） |

※ 実際に払うのは前払い最低額 $5（約 750 円）。残りは繰り越せます。

### 4-3. Phase 2（本番 5,000 件 × 20 ページ）
| 項目 | 計算 | 概算 |
|---|---|---|
| 初回 Embedding（通常） | 5,000 × 20 × 700 = 70M トークン、重なり分 +15% ≒ 80M × $0.02/1M | $1.6 ≒ **240 円** |
| 初回 Embedding（Batch API） | 50% 引き | $0.8 ≒ **120 円** |
| 月次追加 100 件 | 1.4M トークン | 約 4 円/月 |
| 月間質問 10,000 回（100 名 × 5 回/日 × 20 日、nano） | 10,000 × $0.00035 | $3.5 ≒ **525 円/月** |
| 同上を gpt-5-mini にした場合 | 10,000 × $0.0018 | ≒ 2,700 円/月 |

**Batch API の適用判断**
- 初回 5,000 件投入は「24 時間以内に返ればよい」ので Batch API 向き。上限は 1 バッチ 50,000 入力なので、20 万チャンクなら 4〜5 バッチに分割。**Phase 2 では採用**。
- MVP は絶対額が数円なので、実装の手間に見合わない。**MVP では同期 API**。ただし `EmbeddingClient` インターフェースを切っておき、Batch 実装を差し込める形にする。
- 質問応答はリアルタイムなので Batch 不可。

---

## 5. データモデル

`supabase/migrations/` に番号付き SQL で定義。ベクトル次元は 1536。

### 5-1. テーブル
```sql
-- 部署マスタ
departments (
  id          text primary key,      -- 'strategy','operations','it','hr','sales','admin'
  name_ja     text not null          -- '戦略','業務','IT','人事','営業','管理'
)

-- Slack ユーザー ↔ 部署（多対多）
user_departments (
  slack_user_id  text not null,      -- 'U0123ABC'
  department_id  text not null references departments(id),
  display_name   text,               -- 人が読むための表示名
  created_at     timestamptz not null default now(),
  primary key (slack_user_id, department_id)
)

-- 文書 1 件 = 1 行
documents (
  id             uuid primary key default gen_random_uuid(),
  source_type    text not null,      -- 'local' | 'sharepoint' | 'gdrive'
  source_path    text not null,      -- 元ファイルの場所（source_type 内で一意）
  content_hash   text not null,      -- 本文の SHA-256。差分取り込み・重複防止に使う
  title          text not null,
  department_id  text not null references departments(id),
  doc_type       text not null,      -- 'proposal' | 'report' | 'other'
  client_name    text,
  created_year   int,
  file_type      text not null,      -- 'pdf' | 'docx'
  page_count     int,
  ingested_at    timestamptz not null default now(),
  unique (source_type, source_path)
)

-- チャンク（検索の単位）
chunks (
  id             uuid primary key default gen_random_uuid(),
  document_id    uuid not null references documents(id) on delete cascade,
  department_id  text not null references departments(id),  -- RLS 判定用に非正規化（JOIN 無しで絞れる）
  chunk_index    int not null,
  section_title  text,               -- 例 '4. ROI 試算'
  page_start     int,
  page_end       int,
  content        text not null,
  token_count    int not null,
  embedding      vector(1536) not null,
  unique (document_id, chunk_index)
)

-- 監査ログ
search_logs (
  id               bigint generated always as identity primary key,
  slack_user_id    text not null,
  channel_id       text,
  question         text not null,
  department_ids   text[] not null,  -- 検索時点の所属（後で変わっても再現できる）
  top_chunk_ids    uuid[] not null,
  top_scores       real[] not null,
  result_status    text not null,    -- 'answered' | 'no_hit' | 'error'
  model            text,
  latency_ms       int,
  created_at       timestamptz not null default now()
)
```

### 5-2. RLS の方針（「検索の時点」で絞る）
- DB ロールを 2 つ用意する。
  - `ingest`（所有者相当）: 取り込み・マスタ更新に使う。RLS の対象外。**ボットには絶対に渡さない**。
  - `rag_bot`（制限ロール）: ボット専用。`chunks`/`documents` は SELECT のみ、`search_logs` は INSERT のみ。`BYPASSRLS` なし。
- ボットは検索のたびに **1 トランザクション内で** `select set_config('app.slack_user_id', 'U0123', true)` を実行してから検索 SQL を投げる。
- `chunks` の RLS ポリシー（概念）:
  ```sql
  create policy chunks_by_department on chunks for select to rag_bot
  using (
    department_id in (
      select department_id from user_departments
      where slack_user_id = current_setting('app.slack_user_id', true)
    )
  );
  ```
  `documents` にも同じ条件、`user_departments` は `rag_bot` に SELECT のみ、`search_logs` は INSERT のみ。
- 検索 SQL は普通に `order by embedding <=> $1 limit 5` と書くだけで、Postgres が **並べ替える前に**他部署の行を除外する。

**なぜ「検索後フィルタ」ではダメか（説明用）**
1. 上位 5 件を取ってから他部署を捨てると、5 件全部が他部署だった場合に「関連文書はあるのに 0 件」になる。件数を増やして取り直しても保証はない。
2. 他部署のデータがいったんアプリ側まで届くので、ログやバグで漏れる経路ができる。DB の外に出さないのが最も安全。
3. RLS なら「アプリのコードに書き忘れ」があっても DB が守る。テストで証明しやすい。

### 5-3. 検索関数（RPC ではなく SQL 文で持つ）
```sql
select c.id, c.document_id, c.section_title, c.content, c.page_start,
       d.title, d.department_id, d.created_year,
       1 - (c.embedding <=> $1::vector) as score
from chunks c join documents d on d.id = c.document_id
order by c.embedding <=> $1::vector
limit $2;
```
`SECURITY DEFINER` の関数にすると RLS を素通りしてしまうので使わない。

---

## 6. 実装フェーズ（15 営業日）

| Day | 作業 | 成果物 | 
|---|---|---|
| 1 | git init、Node プロジェクト作成、`.env` 雛形、Supabase プロジェクト作成、pgvector 有効化、接続テスト | `npm run db:ping` で "ok" が出る |
| 2 | マイグレーション（§5 の全テーブル・2 ロール・RLS ポリシー）、部署マスタ投入、`db:migrate` スクリプト | Supabase の Table Editor に 5 テーブルが見える |
| 3 | `DocumentSource` インターフェース、`LocalFolderSource`、`SharePointSource`/`GoogleDriveSource` スタブ、PDF/Word テキスト抽出 | `npm run extract -- data/docs/xxx.pdf` で本文が表示される |
| 4 | メタデータ抽出（冒頭行 + フォルダ名）、見出し単位チャンキング（上限 500 トークン・重なり 50） | `npm run chunk -- <file>` でチャンク一覧（見出し・文字数）が出る |
| 5 | Embedding クライアント（`EmbeddingClient` IF + OpenAI 実装）、取り込みスクリプト `ingest`（hash で差分、未変更はスキップ） | 36 件が `documents`/`chunks` に入る。2 回目実行はスキップ表示 |
| 6 | 検索モジュール（ユーザー ID → トランザクション → 上位 k）、CLI で検索テスト | `npm run search -- --user U123 "質問"` で 5 件とスコア |
| 7 | 閾値設計（§8）、「該当なし」判定、回答生成（プロンプト・出典番号付き）、`answer` CLI | CLI で出典付き回答が返る。存在しない話題は「該当なし」 |
| 8 | 評価スクリプト `eval`（15 問 CSV → Recall@5・該当なし正答・RLS 検証を集計、Markdown で保存） | `eval/results/YYYY-MM-DD.md` に表が出る |
| 9 | RLS 自動テスト（vitest）：人事ユーザーで IT 文書が 0 件、複数部署ユーザーで両方見える、`rag_bot` が INSERT できない | `npm test` 緑 |
| 10 | Slack アプリ作成（あなた）、Bolt Socket Mode 起動、メンション + DM に固定文で返信 | Slack で「こんにちは」に返事が来る |
| 11 | Slack ↔ 検索・回答の接続、Slack ブロック整形（出典・スコア表示）、未登録ユーザーの扱い、監査ログ書き込み | Slack で本物の回答 + `search_logs` に行が増える |
| 12 | 精度チューニング（チャンクサイズ・k・閾値・プロンプト）、評価を再実行して前後比較 | Recall@5 と該当なし率の改善記録 |
| 13 | GitHub プライベートリポ push、Actions schedule（週 1 取り込み + keep-alive）、Secrets 設定 | Actions の手動実行が成功 |
| 14 | README（セットアップ手順・運用手順・図）、`.env.example` 整備、エラーハンドリング見直し | 第三者が README だけで起動できる |
| 15 | 総合デモ（15 問 + Slack）、Phase 2 ロードマップ確定、振り返り | デモ動画 or スクリーンショット、最終評価表 |

---

## 7. ディレクトリ構成

```
模擬案件7/
├─ docs/
│  ├─ plan.md                 ← この計画
│  └─ architecture.md         ← Day 14 に図を清書
├─ data/
│  ├─ docs/                   ← 取り込み元（git 管理外）
│  │   ├─ strategy/  ├─ operations/  ├─ it/  ├─ hr/  ├─ sales/  └─ admin/
│  └─ master/
│      └─ user_departments.csv  ← Slack ID と部署の対応（git 管理外）
├─ eval/
│  ├─ questions.csv           ← 15 問（既存 CSV を移動・追記）
│  └─ results/                ← 評価結果（日付ごと）
├─ supabase/
│  └─ migrations/
│      ├─ 0001_extensions.sql
│      ├─ 0002_tables.sql
│      ├─ 0003_roles_rls.sql
│      └─ 0004_seed_departments.sql
├─ src/
│  ├─ config.ts               ← 環境変数・モデル名・閾値を 1 か所に
│  ├─ db/
│  │   ├─ client.ts           ← postgres.js 接続（ingest 用 / bot 用の 2 つ）
│  │   └─ migrate.ts
│  ├─ sources/
│  │   ├─ DocumentSource.ts   ← インターフェース
│  │   ├─ LocalFolderSource.ts
│  │   ├─ SharePointSource.ts ← スタブ（NotImplemented）
│  │   └─ GoogleDriveSource.ts← スタブ
│  ├─ ingest/
│  │   ├─ extract.ts          ← pdf / docx → テキスト + ページ情報
│  │   ├─ metadata.ts         ← 冒頭行 + フォルダ名 → 部署など
│  │   ├─ chunk.ts            ← 見出し分割 + トークン上限
│  │   ├─ embed.ts            ← EmbeddingClient IF + OpenAI 実装
│  │   └─ run.ts              ← 取り込み本体（差分・保存）
│  ├─ search/
│  │   ├─ search.ts           ← ユーザー ID 付きベクトル検索
│  │   ├─ threshold.ts        ← 該当なし判定
│  │   └─ answer.ts           ← 生成プロンプト・出典整形
│  ├─ slack/
│  │   ├─ app.ts              ← Bolt 起動
│  │   ├─ handlers.ts         ← app_mention / message.im
│  │   └─ format.ts           ← Block Kit 整形
│  ├─ audit/
│  │   └─ log.ts
│  └─ cli/
│      ├─ extract.ts  chunk.ts  search.ts  answer.ts  eval.ts
├─ tests/
│  ├─ rls.test.ts             ← 権限漏れテスト
│  ├─ chunk.test.ts
│  └─ threshold.test.ts
├─ .github/workflows/ingest.yml
├─ .env.example
├─ package.json  tsconfig.json  vitest.config.ts  .gitignore
└─ README.md
```

主なコマンド（すべて `模擬案件7` フォルダで実行）: `npm run db:migrate` / `npm run ingest` / `npm run search -- ...` / `npm run eval` / `npm run bot` / `npm test`

---

## 8. 各フェーズの完了基準（自分で確認できる形）

| フェーズ | 確認方法（すべて `模擬案件7` フォルダで） |
|---|---|
| Day1 環境 | `npm run db:ping` が `ok` と表示。Supabase ダッシュボード → Database → Extensions で `vector` が有効 |
| Day2 DB | Supabase → Table Editor に `departments` など 5 テーブル。`departments` に 6 行 |
| Day3-4 抽出・分割 | `npm run chunk -- data/docs/strategy/xxx.pdf` で、見出し名ごとにチャンクが並び、各チャンクが 500 トークン以下 |
| Day5 取り込み | `npm run ingest` 後、Table Editor で `documents` 36 行。もう一度実行すると「skipped: 36」 |
| Day6 検索 | `npm run search -- --user <戦略の人のID> "銀行 DX ROI"` の 1 位が doc1 |
| Day7 回答 | 同じ質問で出典 `[1] 銀行A向け DX 推進提案書 p.2` 付きの回答。「医療業界の提案書」では「該当する文書は見つかりませんでした」 |
| Day8 評価 | `npm run eval` で表が出て、Recall@5・該当なし正答率・RLS 判定が 1 枚にまとまる |
| Day9 RLS | `npm test` が緑。テスト名に「人事ユーザーは IT 文書を 0 件」が含まれる |
| Day10-11 Slack | Slack で `@bot 質問` と DM の両方に回答。`search_logs` に 1 行増える |
| Day13 自動化 | GitHub → Actions → "Run workflow" が緑 |
| Day15 完成 | Recall@5 ≥ 0.8（12 問中 10 問以上）、該当なし 3 問すべて正答、RLS 問 正答 |

**評価指標の定義**
- Recall@5 = 正解文書が上位 5 チャンクの文書集合に含まれていれば 1、含まれなければ 0。複数正解（Q9）は「含まれた割合」。
- 該当なし正答 = 上位 1 位のスコアが閾値未満、または LLM が「該当なし」を返した。
- RLS 問（Q12）= 人事ユーザーとして Q5（クラウド移行）を検索し、結果 0 件かつ「該当なし」。

**「該当なし」閾値の設計方針**
1. `text-embedding-3-small` のコサイン類似度は、関連ありで 0.45〜0.65、無関係で 0.20〜0.35 程度になることが多い（データで確認する）。
2. Day7 で評価セットの「関連あり 9 問の 1 位スコア最小値」と「該当なし 3 問の 1 位スコア最大値」を出し、その中間を初期閾値にする（例 0.40）。`config.ts` の 1 か所で管理。
3. 二段構え: 閾値を超えても LLM のプロンプトで「渡された文書に根拠が無い場合は『該当なし』とだけ答える」と指示し、回答に出典番号が 1 つも無ければ「該当なし」扱いにする。
4. 評価結果に「閾値ぎりぎりの問い」を表示し、Day12 で調整する。

**追加する 3 問（案）**
- Q13（業務）: あなたが用意する業務部の文書に合わせて作成
- Q14（管理）: 同上、管理部の文書向け
- Q15（該当なし）: 「宇宙開発事業の提案書はありますか？」
（Q13/14 の中身は文書が揃った時点で一緒に決めます）

---

## 9. リスクと対策

| リスク | 影響 | 対策 |
|---|---|---|
| **権限漏れ**（他部署の文書が見える） | 最重大 | RLS を DB 側で強制。ボットは `rag_bot` ロールのみ。`SECURITY DEFINER` 禁止。自動テストで「人事 → IT 0 件」を毎回確認。未登録ユーザーは検索せず「部署未登録」と返す |
| set_config の付け忘れ | 全件見えるか 0 件 | 検索関数の中でしか DB を触れない構造にし、ユーザー ID 未指定なら例外。テストで確認 |
| Supabase 1 週間で一時停止 | ボットが動かない | GitHub Actions を 3 日おきに走らせ、取り込み or `select 1` で活動を作る。停止時はダッシュボードの Restore ボタンで復旧（1 年以内） |
| Supabase 500MB 超過 | 書き込み不可 | 36 件では 1% 未満。`db:stats` で使用量を表示する簡単スクリプトを付ける |
| GitHub schedule が 60 日で停止 | keep-alive 失効 | 月 1 回はコミット or 手動 Run。README に記載 |
| OpenAI 残高切れ | 回答不能 | 使用量ダッシュボードの上限設定（$5）。エラー時は Slack に「一時的に利用不可」と返す |
| PDF から見出しが取れない | チャンクが粗くなる | 番号付き見出しの正規表現 + 上限トークンでの強制分割の二段構え。Markdown 元原稿があるので比較可能 |
| gpt-5-nano の日本語品質 | 要約が雑 | `config.ts` でモデル名を切替。評価スクリプトで前後比較 |
| Windows 固有（パス・文字コード） | 実行エラー | パスは `path.join`、ファイルは UTF-8 明示。PowerShell で全コマンドを確認 |
| 秘密情報の流出 | 重大 | `.env`・`data/` は `.gitignore`。`ingest` 用 DB URL は Actions Secrets のみに置く |

---

## 10. Phase 2 ロードマップ

| 項目 | 必要になる課金・理由 | 設計上の準備（MVP で済ませること） |
|---|---|---|
| 文書 5,000 件フル投入 | **Supabase Pro $25/月〜**（8GB 込み）。20 万チャンク ≒ 1.6GB + HNSW インデックス | スキーマは変更不要。HNSW 作成 SQL を用意。Embedding は Batch API（約 120 円） |
| SharePoint 連携 | **Microsoft 365 ライセンス**（Business Basic 約 900 円/ユーザー/月〜）+ Graph API アプリ登録 | `SharePointSource` スタブに `list/read` を実装するだけ |
| ボット常時稼働 | **ホスティング費用**。Vercel Hobby は非商用限定 → 商用は Pro $20/月。または Fly.io / Railway / VPS 数百〜千円台/月 | Socket Mode はそのまま使えるので、Node を動かす場所を変えるだけ |
| PowerPoint 対応 | 画像 OCR に **Azure AI Vision / Google Vision（従量）** または GPT 系画像入力の API 費用 | `extract.ts` に `pptx` 分岐を追加。`file_type` 列は既に対応 |
| 役職階層別アクセス制御 | 追加課金なし（工数のみ）。ID 連携するなら **Entra ID（M365）** | `user_departments` に `role_level` 列を追加、RLS 条件に AND |
| 提案書ドラフト自動生成 | 生成トークン量が増えるため **gpt-5-mini 以上の API 費**（1 通 数円〜数十円） | 検索モジュールをそのまま再利用 |
| BM25 ハイブリッド検索 | 追加課金なし。Postgres 全文検索（`pg_bigm` or `pgroonga`）は Supabase で有効化可 | `chunks.content` に GIN インデックス追加、スコア合成関数を追加 |
| 管理画面（部署マスタ編集） | Vercel Hobby なら無料（非商用）。商用は Pro $20/月 | Next.js を後付け |
| バックアップ | Supabase Pro に含まれる（7 日保持） | — |

---

## 11. あなたが決めること

1. **サンプル文書の件数と作成期限** — 推奨 36 件（各部署 PDF 4 + Word 2）。Day5 までに 20 件以上あれば進められます。
2. **テスト用 Slack ユーザー** — 最低 3 人分の Slack ID が必要（戦略のみ / 人事のみ / 全部署）。無料プランなら自分の別メールで 2 アカウント追加、または「テスト用に自分の ID を切替える」運用でも可。**推奨: 自分 + 別メールの 2 アカウント**。
3. **生成モデル** — `gpt-5-nano` 開始（推奨）か、最初から `gpt-5-mini` か。理由: 数円の差なので、まず最安で品質を見る。
4. **OpenAI へのチャージ額** — 最低 $5（推奨。MVP はこれで足ります）。
5. **GitHub リポジトリ名と公開範囲** — プライベート推奨（文書名がログに残るため）。
6. **Actions の実行頻度** — 3 日おき（推奨、Supabase 停止対策を兼ねる）か 週 1 か。
7. **Q13/Q14 の質問文** — 業務部・管理部の文書ができたら一緒に決める。

---

## 12. 最初にやるべき「たった 1 つ」の作業

**Supabase で無料プロジェクトを 1 つ作り、pgvector を有効にする。**

1. https://supabase.com にログイン → New project → 名前 `rag-mvp`、リージョン `Northeast Asia (Tokyo)`、DB パスワードを控える。
2. 左メニュー Database → Extensions → `vector` を検索して Enable。
3. Project Settings → Database → Connection string → **Session pooler** の URL を控える。

理由: すべての機能がこの DB に依存し、かつ「1 週間で停止」の時計もここから動き出すので、着手日と揃えるのが良いからです。これが済んだら Day1 の作業（git init とプロジェクト雛形）に進みます。

---

## 13. 検証方法（計画全体の妥当性確認）

- Day8 の評価スクリプトと Day9 の RLS テストが「この設計が正しく動く証拠」になる。
- 最終的に `npm run eval` の結果表と `npm test` の緑を README に貼り、Slack のスクリーンショットを添えてポートフォリオとする。
