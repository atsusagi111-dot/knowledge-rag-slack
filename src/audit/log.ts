/**
 * 監査ログ。rag_bot ロールで、自分の slack_user_id の行だけ INSERT / UPDATE できる（RLS）。
 */
import { withSlackUser } from "../db/client.js";

export interface SearchLogInput {
  slackUserId: string;
  channelId: string | null;
  question: string;
  departmentIds: string[];
  topChunkIds: string[];
  topScores: number[];
  status: string;
  model: string;
  latencyMs: number;
}

/** ログを 1 行書き、その id を返す */
export async function writeSearchLog(input: SearchLogInput): Promise<number> {
  return withSlackUser(input.slackUserId, async (tx) => {
    const [row] = await tx<{ id: number }[]>`
      insert into search_logs (slack_user_id, channel_id, question, department_ids, top_chunk_ids, top_scores,
                               result_status, model, latency_ms)
      values (${input.slackUserId}, ${input.channelId}, ${input.question}, ${input.departmentIds},
              ${input.topChunkIds}::uuid[], ${input.topScores}::real[], ${input.status}, ${input.model}, ${input.latencyMs})
      returning id`;
    return Number(row.id);
  });
}

/** 回答を Slack に投稿したあと、その投稿先をログに記録する（取り消し時に削除できるように） */
export async function recordAnswerMessage(
  slackUserId: string,
  logId: number,
  channelId: string,
  ts: string,
): Promise<void> {
  await withSlackUser(slackUserId, async (tx) => {
    await tx`update search_logs set answer_channel_id = ${channelId}, answer_ts = ${ts}
             where id = ${logId} and slack_user_id = ${slackUserId}`;
  });
}
