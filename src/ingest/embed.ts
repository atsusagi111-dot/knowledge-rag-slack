/**
 * Embedding クライアント。
 * インターフェースを切っておき、Phase 2 で Batch API 実装（BatchOpenAIEmbeddingClient）を差し込めるようにする。
 */
import OpenAI from "openai";
import { config } from "../config.js";

export interface EmbeddingClient {
  readonly model: string;
  /** 複数テキストをまとめてベクトル化する（順序は入力と同じ） */
  embed(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly model = config.openai.embeddingModel;
  private readonly client: OpenAI;
  /** 1 リクエストにまとめる本数（API 上限は 2048。安全側） */
  private readonly batchSize = 100;

  constructor(apiKey = config.openai.apiKey) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const slice = texts.slice(i, i + this.batchSize);
      const res = await this.client.embeddings.create({
        model: this.model,
        input: slice,
        dimensions: config.openai.embeddingDimensions,
      });
      // index 順に並べ直す
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      out.push(...sorted.map((d) => d.embedding));
    }
    return out;
  }
}

let _default: EmbeddingClient | undefined;
export function defaultEmbeddingClient(): EmbeddingClient {
  if (!_default) _default = new OpenAIEmbeddingClient();
  return _default;
}
