# 機密扱い変更時の対応フロー

「機密扱いの変更」は次の 3 パターンに分けて扱う。どのパターンも、**元データ（フォルダとマスタ CSV）を正として、コマンド 1 つで DB を同期する**のが原則。
DB を直接編集しない（次回の取り込みで元に戻ってしまうため）。

反映は即時。ボットは質問のたびに DB を読むので、再起動は不要。

## パターン 0: 機密文書を誤ってアップロードした（最優先の取り消し手順）

「削除して検索から消す」だけでは不十分で、**すでに誰かがその文書を根拠に回答を受け取っている**可能性がある。
`npm run redact` は次を 1 コマンドで行う。

1. その文書のチャンクを根拠にした監査ログ行を洗い出す（誰が・いつ・何を聞いたか）
2. それらのログ行から該当チャンクの参照を除去し、`redacted_at` と理由を記録する。ログ行そのものは残す（誰が見たかは監査上必要）
3. `--delete-slack` を付けると、その回答を投稿した Slack のメッセージ（DM の回答）をボットが削除する
4. 文書とチャンクを DB から削除する
5. 元ファイルを `data/quarantine/` に移動する（次回の取り込みで復活させない）
6. 取り消しの記録を `redactions` テーブルに残す

手順（`模擬案件7` フォルダで）
```
npm run redact -- --path it/case7-doc3-it-cloud-migration.pdf --dry-run
npm run redact -- --path it/case7-doc3-it-cloud-migration.pdf --reason "機密度誤り" --delete-slack
```
1 行目は影響範囲の表示だけ。`--path` は `data/docs/` からの相対パス（Table Editor の `documents.source_path` で確認できる）。

確認方法
- Slack: 削除対象の回答 DM が消えている
- Table Editor → `search_logs`: 該当行の `redacted_at` に日時、`redaction_note` に理由。`top_chunk_ids` から該当チャンクが消えている
- Table Editor → `redactions`: 1 行追加されている
- 同じ質問を Slack で聞くと「該当なし」

限界（正直に）
- 人がすでに読んだ内容は取り消せない。Slack のメッセージ削除は「これ以上見られない」ための措置
- Slack の通知プレビューやメール通知に回答の一部が残る場合がある
- 回答者本人が DM をコピーしていた場合は追えない。運用ルール（社内文書の転載禁止）で補う

復旧したい場合は `data/quarantine/` のファイルを元のフォルダに戻して `npm run ingest`。

## パターン 1: 文書の所属部署を変える

例: IT 部の「クラウド移行報告書」を、IT 部には見せず人事部だけに見せる。

1. 文書の冒頭行 `部署: IT / ...` を `部署: 人事 / ...` に書き換える（PDF なら元の Word / Markdown を直して再出力）。
   冒頭行が無い文書は、`data/docs/it/` から `data/docs/hr/` へファイルを移動する
2. `模擬案件7` フォルダで
   ```
   npm run ingest -- --prune
   ```
   - 内容が変わった文書は `updated`、移動した文書は新しい場所で `inserted`、古い場所の行は `pruned` と表示される
3. 確認: `npm run db:stats` の部署別文書数が変わっていること。IT 部のみのユーザーで検索して出ないこと

## パターン 2: 文書を検索対象から外す（社外秘への格上げ、誤登録、退役）

1. `data/docs/<部署>/` からファイルを削除する（別フォルダに退避してもよい）
2. `npm run ingest -- --prune`
   - `pruned <ファイル名>` と表示され、文書とチャンクが DB から消える
3. 確認: そのファイル名で検索しても出ない。`search_logs` の過去の行は残る（監査のため消さない。`top_chunk_ids` は消えたチャンクを指す）

## パターン 3: 人の所属が変わる（異動・兼務解除・退職）

1. `data/master/user_departments.csv` を編集する
   - 異動: 行の `department_id` を書き換える
   - 兼務追加: 行を追加する
   - 退職: その人の行をすべて消す
2. `模擬案件7` フォルダで
   ```
   npm run db:seed-users -- --sync
   ```
   - CSV に無い所属行が `removed` と表示されて消える（`--sync` を付けないと追加・上書きだけ）
3. 確認: その人のアカウントで旧部署の文書を検索して「該当なし」になる。退職者は「部署マスタに登録されていません」と返る

## 一覧

| 変更内容 | 直すもの | 実行するコマンド | 反映 |
|---|---|---|---|
| **誤アップロードの取り消し** | 何も直さず | `npm run redact -- --path <パス> --reason "理由" --delete-slack` | 即時 |
| 文書の部署変更 | 冒頭行 or フォルダ | `npm run ingest -- --prune` | 即時 |
| 文書の除外・退役 | ファイル削除 | `npm run ingest -- --prune` | 即時 |
| 人の異動・退職 | マスタ CSV | `npm run db:seed-users -- --sync` | 即時 |
| 部署の新設 | `supabase/migrations` に seed 追加 + `config.ts` の `DEPARTMENT_IDS` | `npm run db:migrate` | 要デプロイ |

## 設計上の注意

- `--prune` と `--sync` は「元に無いものを消す」動作なので、取り込み元フォルダや CSV が壊れている（空になっている）状態で実行すると全削除になる。実行前に `npm run ingest -- --dry-run` で件数を確認する
- GitHub Actions の定期実行は `--prune` を付けていない（意図しない削除を避けるため）。機密変更は人が手動で `--prune` を実行する運用
- Phase 2（SharePoint 連携）では、SharePoint 側の権限（サイト / ライブラリ）を `departmentHint` に写像し、同じ `--prune` で同期する
