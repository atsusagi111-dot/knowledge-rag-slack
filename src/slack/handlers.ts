/**
 * Slack イベントハンドラ。
 *  - app_mention : チャンネルで @bot 質問 → 回答は本人の DM へ、スレッドには案内だけ
 *  - message.im  : DM で質問 → その場で回答
 * 回答を投稿したら、その投稿先（channel, ts）を監査ログに記録する。
 * 誤アップロード取り消し（npm run redact）のときに、この記録を使って投稿を削除できる。
 * Bolt はイベント受信直後に Slack へ ack を返すので、ここでの処理時間は 3 秒ルールに影響しない。
 */
import type { App } from "@slack/bolt";
import { answerQuestion, type AnswerResult } from "../search/answer.js";
import { recordAnswerMessage } from "../audit/log.js";
import { formatAnswer } from "./format.js";
import { sendDm, type Posted } from "./client.js";

async function remember(result: AnswerResult, user: string, posted: Posted | null): Promise<void> {
  if (result.logId && posted) {
    await recordAnswerMessage(user, result.logId, posted.channel, posted.ts).catch((e) => console.error("投稿先の記録に失敗:", e));
  }
}

export function registerHandlers(app: App): void {
  app.event("app_mention", async ({ event, say, client }) => {
    const question = stripMention(event.text);
    const user = event.user;
    if (!user) return; // ワークフローや他ボットからのメンション（質問者が特定できない）は扱わない
    if (!question) {
      await say({ text: "質問を続けて書いてください。例: `@bot 銀行向け DX 提案の ROI は？`", thread_ts: event.ts });
      return;
    }
    // 受付の印は待たずに付ける（回答の開始を遅らせない）
    void client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "mag" }).catch(() => {});
    const result = await answerQuestion(user, question, { channelId: event.channel });

    const posted = await sendDm(client, user, formatAnswer(result, `<#${event.channel}> での質問「${question}」への回答`));
    if (posted) {
      await remember(result, user, posted);
      await say({ text: `<@${user}> 回答を DM に送りました。`, thread_ts: event.ts });
    } else {
      // DM を開けない場合（設定不備など）は、本人だけに見える一時メッセージで返す
      await client.chat.postEphemeral({ channel: event.channel, user, thread_ts: event.ts, ...formatAnswer(result) });
    }
  });

  app.message(async ({ message, say, client }) => {
    // DM の通常メッセージだけ扱う（ボット自身・編集・スレッド返信通知などは無視）
    if (message.channel_type !== "im") return;
    if (!("text" in message) || !("user" in message) || !message.user || message.subtype) return;
    const question = message.text?.trim();
    if (!question) return;
    void client.reactions.add({ channel: message.channel, timestamp: message.ts, name: "mag" }).catch(() => {});
    const result = await answerQuestion(message.user, question, { channelId: message.channel });
    const posted = (await say(formatAnswer(result))) as { channel?: string; ts?: string };
    await remember(result, message.user, posted.channel && posted.ts ? { channel: posted.channel, ts: posted.ts } : null);
  });
}

export function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}
