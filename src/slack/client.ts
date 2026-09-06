/** Slack Web API の共通部品（ボット本体以外の CLI からも使う） */
import { WebClient } from "@slack/web-api";
import { config } from "../config.js";

let _client: WebClient | undefined;
export function slackWebClient(): WebClient {
  if (!_client) _client = new WebClient(config.slack.botToken);
  return _client;
}

export interface Posted {
  channel: string;
  ts: string;
}

/** ユーザーとの DM を開いてメッセージを投稿し、投稿先を返す */
export async function sendDm(client: WebClient, userId: string, message: { text: string; blocks?: unknown[] }): Promise<Posted | null> {
  const dm = await client.conversations.open({ users: userId });
  const channel = dm.channel?.id;
  if (!channel) return null;
  const res = await client.chat.postMessage({ channel, text: message.text, blocks: message.blocks as never });
  return res.ts ? { channel, ts: res.ts } : null;
}
