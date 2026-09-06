/**
 * 監査ログ。rag_bot ロールで、自分の slack_user_id の行だけ INSERT できる（RLS）。
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

export async function writeSearchLog(input: SearchLogInput): Promise<void> {
  await withSlackUser(input.slackUserId, async (tx) => {
    await tx`
      insert into search_logs (slack_user_id, channel_id, question, department_ids, top_chunk_ids, top_scores,
                               result_status, model, latency_ms)
      values (${input.slackUserId}, ${input.channelId}, ${input.question}, ${input.departmentIds},
              ${input.topChunkIds}::uuid[], ${input.topScores}::real[], ${input.status}, ${input.model}, ${input.latencyMs})`;
  });
}
