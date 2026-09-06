/**
 * Embedding クライアント。
 * インターフェースを切っておき、Phase 2 で Batch API 実装（BatchOpenAIEmbeddingClient）を差し込めるようにする。
 * どれを使うかは providers.ts が決める。
 */
import type OpenAI from "openai";
import { config } from "../config.js";

export interface EmbeddingClient {
  readonly model: string;
  /** 複数テキストをまとめてベクトル化する（順序は入力と同じ） */
  embed(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbeddingClient implements EmbeddingClient {
  readonly model = config.openai.embeddingModel;
  /** 1 リクエストにまとめる本数（API 上限は 2048。安全側） */
  private readonly batchSize = 100;

  constructor(private readonly client: OpenAI) {}

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: texts.slice(i, i + this.batchSize),
        dimensions: config.openai.embeddingDimensions,
      });
      out.push(...[...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding));
    }
    return out;
  }
}

/**
 * OpenAI を呼ばない偽の Embedding（ローカル動作確認・テスト用）。
 * 文字 2 文字組（バイグラム）をハッシュして散らし、正規化する。
 * 同じ語を含む文章ほど近くなるので、パイプラインの疎通確認には十分。意味検索の精度は無い。
 */
export class FakeEmbeddingClient implements EmbeddingClient {
  readonly model = "fake-bigram-hash";
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => FakeEmbeddingClient.vectorize(t));
  }
  static vectorize(text: string, dims = config.openai.embeddingDimensions): number[] {
    const v = new Array<number>(dims).fill(0);
    const s = text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
    for (let i = 0; i < s.length; i++) {
      for (const gram of [s[i], s.slice(i, i + 2)]) {
        let h = 2166136261;
        for (let j = 0; j < gram.length; j++) h = Math.imul(h ^ gram.charCodeAt(j), 16777619);
        v[Math.abs(h) % dims] += gram.length === 1 ? 0.3 : 1;
      }
    }
    const norm = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
    return v.map((x) => x / norm);
  }
}
