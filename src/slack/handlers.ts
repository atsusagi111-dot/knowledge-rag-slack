/**
 * Slack イベントハンドラ。
 *  - app_mention : チャンネルで @bot 質問
 *  - message.im  : DM で質問
 */
import type { App } from "@slack/bolt";
import { answerQuestion } from "../search/answer.js";
import { formatAnswer } from "./format.js";

export function registerHandlers(app: App): void {
  // チャンネルでのメンション: 回答は本人への DM に送り、スレッドには案内だけ残す。
  // 理由: チャンネルにはその文書を見る権限が無い人もいるため、回答本文を公開の場に置かない。
  app.event("app_mention", async ({ event, say, client }) => {
    const question = stripMention(event.text);
    const user = event.user ?? "";
    if (!question) {
      await say({ text: "質問を続けて書いてください。例: `@bot 銀行向け DX 提案の ROI は？`", thread_ts: event.ts });
      return;
    }
    await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "mag" }).catch(() => {});
    const result = await answerQuestion(user, question, { channelId: event.channel });

    const dm = await client.conversations.open({ users: user });
    const dmChannel = dm.channel?.id;
    if (dmChannel) {
      await client.chat.postMessage({
        channel: dmChannel,
        ...formatAnswer(result, `<#${event.channel}> での質問「${question}」への回答`),
      });
      await say({ text: `<@${user}> 回答を DM に送りました。`, thread_ts: event.ts });
    } else {
      // DM を開けない場合（設定不備など）は、本人だけに見える一時メッセージで返す
      await client.chat.postEphemeral({ channel: event.channel, user, thread_ts: event.ts, ...formatAnswer(result) });
    }
  });

  app.message(async ({ message, say }) => {
    // DM の通常メッセージだけ扱う（ボット自身・編集・スレッド返信通知などは無視）
    if (message.channel_type !== "im") return;
    if (!("text" in message) || !("user" in message) || !message.user || message.subtype) return;
    const question = message.text?.trim();
    if (!question) return;
    const result = await answerQuestion(message.user, question, { channelId: message.channel });
    await say(formatAnswer(result));
  });
}

export function stripMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}
