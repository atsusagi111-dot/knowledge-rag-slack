/**
 * 誤アップロードの取り消し（redact）:
 *   npm run redact -- --path it/case7-doc3-it-cloud-migration.pdf --reason "機密度誤り" [--delete-slack] [--dry-run]
 *
 * 行うこと（順番どおり）
 *   1. 対象文書とチャンクを特定し、そのチャンクを根拠にした監査ログ行を洗い出す
 *   2. 監査ログ行から該当チャンクの参照を除き、redacted_at と理由を記録（行自体は残す = 誰がいつ見たかは監査に必要）
 *   3. --delete-slack を付けた場合、その回答を投稿した Slack メッセージをボットが削除する
 *   4. 文書とチャンクを DB から削除
 *   5. 元ファイルを data/quarantine/ へ移動（次回の取り込みで復活しないように）
 *   6. 取り消しの記録を redactions テーブルに残す
 * --dry-run で 1 の結果だけ表示して終了。
 */
import { rename, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { config } from "../config.js";
import { ingestSql } from "../db/client.js";
import { findLocalDocument } from "../db/documents.js";
import { slackWebClient } from "../slack/client.js";
import { flag, runCli, value } from "../lib/cli.js";

interface LogRow {
  id: number;
  slack_user_id: string;
  question: string;
  created_at: Date;
  answer_channel_id: string | null;
  answer_ts: string | null;
  top_chunk_ids: string[];
  top_scores: number[];
}

runCli(async () => {
  const sourcePath = value("--path");
  const reason = value("--reason") ?? "誤アップロード";
  const deleteSlack = flag("--delete-slack");
  const dryRun = flag("--dry-run");
  if (!sourcePath) throw new Error('使い方: npm run redact -- --path <部署/ファイル名> --reason "理由" [--delete-slack] [--dry-run]');

  const sql = ingestSql();
  const doc = await findLocalDocument(sql, sourcePath);
  const chunkIds = new Set((await sql<{ id: string }[]>`select id from chunks where document_id = ${doc.id}`).map((c) => c.id));
  const logs = await sql<LogRow[]>`
    select id, slack_user_id, question, created_at, answer_channel_id, answer_ts, top_chunk_ids, top_scores
    from search_logs where top_chunk_ids && ${[...chunkIds]}::uuid[] and redacted_at is null order by id`;

  console.log(`対象文書: ${doc.title}（${doc.department_id}） チャンク ${chunkIds.size} 件`);
  console.log(`この文書を根拠にした質問: ${logs.length} 件`);
  for (const l of logs) {
    console.log(`  #${l.id} ${l.created_at.toISOString().slice(0, 16)} ${l.slack_user_id} 「${l.question.slice(0, 40)}」 Slack投稿: ${l.answer_ts ? "あり" : "なし"}`);
  }
  if (dryRun) {
    console.log("\n(dry-run のため何も変更していません)");
    return;
  }

  // 2〜3. 監査ログの redact と Slack 投稿の削除
  let slackDeleted = 0;
  const slack = deleteSlack ? slackWebClient() : null;
  for (const l of logs) {
    const keep = l.top_chunk_ids.map((id, i) => i).filter((i) => !chunkIds.has(l.top_chunk_ids[i]));
    let note = `${reason} / 文書「${doc.title}」のチャンク ${l.top_chunk_ids.length - keep.length} 件を根拠から除去`;
    if (slack && l.answer_channel_id && l.answer_ts) {
      try {
        await slack.chat.delete({ channel: l.answer_channel_id, ts: l.answer_ts });
        slackDeleted++;
        note += " / Slack 投稿を削除";
      } catch (e) {
        note += ` / Slack 投稿の削除失敗: ${(e as Error).message}`;
      }
    }
    await sql`update search_logs
              set top_chunk_ids = ${keep.map((i) => l.top_chunk_ids[i])}::uuid[], top_scores = ${keep.map((i) => l.top_scores[i])}::real[],
                  redacted_at = now(), redaction_note = ${note}
              where id = ${l.id}`;
  }

  // 4. 文書とチャンクを削除（chunks は cascade）
  await sql`delete from documents where id = ${doc.id}`;

  // 5. 元ファイルを隔離
  const src = path.join(config.docsDir, ...sourcePath.split("/"));
  let quarantined: string | null = null;
  if (await stat(src).catch(() => null)) {
    quarantined = path.join("data", "quarantine", `${new Date().toISOString().slice(0, 10)}_${path.basename(sourcePath)}`);
    await mkdir(path.dirname(quarantined), { recursive: true });
    await rename(src, quarantined);
  }

  // 6. 取り消しの記録
  await sql`insert into redactions (source_path, title, department_id, reason, affected_logs, slack_deleted, quarantined_to)
            values (${sourcePath}, ${doc.title}, ${doc.department_id}, ${reason}, ${logs.length}, ${slackDeleted}, ${quarantined})`;

  console.log(`\n完了: 文書削除 / 監査ログ ${logs.length} 件を redact / Slack 投稿削除 ${slackDeleted} 件 / 隔離先 ${quarantined ?? "（元ファイルなし）"}`);
});
