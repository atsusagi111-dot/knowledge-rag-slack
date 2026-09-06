/**
 * Slack イベントハンドラ。
 *  - app_mention : チャンネルで @bot 質問
 *  - message.im  : DM で質問
 */
import type { App } from "@slack/bolt";
import { answerQuestion } from "../search/answer.js";
import { formatAnswer } from "./format.js";

export function registerHandlers(app: App): void {
  app.event("app_mention", async ({ event, say, client }) => {
    const question = stripMention(event.text);
    if (!question) {
      await say({ text: "質問を続けて書いてください。例: `@bot 銀行向け DX 提案の ROI は？`", thread_ts: event.ts });
      return;
    }
    await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "mag" }).catch(() => {});
    const result = await answerQuestion(event.user ?? "", question, { channelId: event.channel });
    await say({ ...formatAnswer(result), thread_ts: event.ts });
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
