/**
 * 外部サービス（OpenAI）の組み立てを 1 か所に集める。
 * EMBEDDING_PROVIDER / LLM_PROVIDER = 'fake' のときは OpenAI を呼ばない偽物を返す（ローカル動作確認用）。
 * 他のモジュールはプロバイダ名を見ず、ここから受け取った関数・クライアントを使う。
 */
import OpenAI from "openai";
import { config } from "./config.js";
import { FakeEmbeddingClient, OpenAIEmbeddingClient, type EmbeddingClient } from "./ingest/embed.js";
import type { SearchHit } from "./search/search.js";

let _openai: OpenAI | undefined;
export function openaiClient(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: config.openai.apiKey });
  return _openai;
}

let _embedder: EmbeddingClient | undefined;
export function embeddingClient(): EmbeddingClient {
  if (!_embedder) _embedder = config.embeddingProvider === "fake" ? new FakeEmbeddingClient() : new OpenAIEmbeddingClient(openaiClient());
  return _embedder;
}

/** 回答生成。system と user プロンプトに加え、根拠チャンクを構造化して受け取る（偽物がプロンプトを解析しなくて済むように） */
export type ChatFn = (input: { system: string; user: string; hits: SearchHit[] }) => Promise<string>;

const openaiChat: ChatFn = async ({ system, user }) => {
  const res = await openaiClient().chat.completions.create({
    model: config.openai.chatModel,
    // gpt-5 系は既定で「考える」時間を使い 8〜12 秒かかる。要約なら low で十分（10 秒以内の応答要件）
    ...(config.openai.reasoningEffort ? { reasoning_effort: config.openai.reasoningEffort as "minimal" | "low" | "medium" | "high" } : {}),
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return res.choices[0]?.message?.content?.trim() ?? "";
};

/** OpenAI を呼ばない偽 LLM: 1 位のチャンク冒頭を引用して返す */
const fakeChat: ChatFn = async ({ hits }) =>
  hits.length === 0 ? "NO_ANSWER" : `（ローカル模擬応答）${hits[0].content.split("\n").slice(1).join(" ").slice(0, 80)} [1]`;

export function chatFn(): ChatFn {
  return config.llmProvider === "fake" ? fakeChat : openaiChat;
}
