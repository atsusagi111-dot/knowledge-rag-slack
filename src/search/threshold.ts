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

export const MAX_GAP_FROM_TOP = 0.25;

export function applyThreshold(hits: SearchHit[], threshold = config.search.similarityThreshold): ThresholdDecision {
  const topScore = hits.length > 0 ? hits[0].score : null;
  if (topScore === null || topScore < threshold) {
    return { passed: false, topScore, threshold, hits: [] };
  }
  // 1 位から大きく離れたチャンクはノイズになるので落とす。
  // 差の上限は 0.25。0.15 だと、客先名入りの質問で「表紙チャンク」が 1 位になったとき
  // 本文チャンク（差 0.2 前後）まで捨ててしまい、LLM が該当なしと答える事故が起きた（36 件検証時）
  const kept = hits.filter((h) => h.score >= threshold && topScore - h.score <= MAX_GAP_FROM_TOP);
  return { passed: true, topScore, threshold, hits: kept };
}
