/**
 * 「該当なし」判定（1 段目）。
 * 上位 1 位の類似度が閾値未満なら、LLM を呼ばずに該当なしを返す。
 * 閾値は .env の SIMILARITY_THRESHOLD で調整（npm run eval の結果で校正する）。
 */
import { config } from "../config.js";
import type { SearchHit } from "./search.js";

export interface ThresholdDecision {
  passed: boolean;
  topScore: number | null;
  threshold: number;
  /** 閾値を通ったチャンクだけ */
  hits: SearchHit[];
}

export function applyThreshold(hits: SearchHit[], threshold = config.search.similarityThreshold): ThresholdDecision {
  const topScore = hits.length > 0 ? hits[0].score : null;
  if (topScore === null || topScore < threshold) {
    return { passed: false, topScore, threshold, hits: [] };
  }
  // 1 位から大きく離れたチャンクはノイズになるので落とす（1 位との差が 0.15 以上）
  const kept = hits.filter((h) => h.score >= threshold && topScore - h.score <= 0.15);
  return { passed: true, topScore, threshold, hits: kept };
}
