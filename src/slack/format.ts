/**
 * 回答を Slack の Block Kit に整形する。
 */
import type { AnswerResult } from "../search/answer.js";

type Block = Record<string, unknown>;

export function formatAnswer(result: AnswerResult, heading?: string): { text: string; blocks: Block[] } {
  const blocks: Block[] = [];
  if (heading) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: heading }] });
  blocks.push({ type: "section", text: { type: "mrkdwn", text: result.text } });

  if (result.citations.length > 0) {
    const lines = result.citations.map(
      (c) => `*[${c.n}]* ${c.title}（${c.department} / ${c.page}${c.sectionTitle ? ` / ${c.sectionTitle}` : ""}）  類似度 ${c.score.toFixed(2)}`,
    );
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*出典*\n${lines.join("\n")}` } });
  }

  const footer =
    result.status === "answered"
      ? `${result.model} / ${result.latencyMs} ms`
      : result.status === "no_hit" && result.topScore != null
        ? `最高類似度 ${result.topScore.toFixed(2)} / ${result.latencyMs} ms`
        : `${result.latencyMs} ms`;
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: footer }] });

  return { text: result.text, blocks };
}
