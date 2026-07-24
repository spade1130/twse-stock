import type {
  AdviceAction,
  AdviceConfidence,
  LimitUpStock,
  PotentialStock,
  StockAdvice,
} from "@/types/stock";

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

/**
 * Combine 主力分數（短線動能）與潛力匹配分（中期體質）產出買賣建議。
 * 權重：潛力 55% / 主力 45%，再依漲停與條件通過數微調文案。
 */
export function buildStockAdvice(
  mainForce: LimitUpStock,
  potential: PotentialStock | null,
): StockAdvice {
  const mainScore = mainForce.mainForceScore;
  const matchScore = potential?.matchScore ?? 0;
  const passedCount = potential
    ? potential.conditions.filter((c) => c.passed).length
    : 0;
  const isLimitUp = mainForce.isLimitUp;

  const combinedScore = clamp(
    Math.round(matchScore * 0.55 + mainScore * 0.45),
    0,
    100,
  );

  const reasons: string[] = [];
  const risks: string[] = [];

  if (potential) {
    if (passedCount >= 5) {
      reasons.push(`潛力條件通過 ${passedCount}/7 項，體質偏多`);
    } else if (passedCount >= 3) {
      reasons.push(`潛力條件通過 ${passedCount}/7 項，具部分優勢`);
    } else {
      risks.push(`潛力條件僅通過 ${passedCount}/7 項`);
    }

    for (const c of potential.conditions.filter((x) => x.passed).slice(0, 3)) {
      reasons.push(c.label);
    }
  } else {
    risks.push("歷史或籌碼資料不足，潛力評估受限");
  }

  if (mainForce.signals.length > 0) {
    reasons.push(`主力訊號：${mainForce.signals.slice(0, 4).join("、")}`);
  }

  if (isLimitUp) {
    risks.push("已達漲停或接近漲停，追高風險較高");
  }
  if (mainForce.volumeRatio >= 3) {
    risks.push("量能大幅放大，留意短線波動");
  }
  if (potential && potential.gain60d >= 20) {
    risks.push(`近 60 日漲幅 ${potential.gain60d.toFixed(1)}%，避免追高`);
  }

  let action: AdviceAction;
  let confidence: AdviceConfidence;
  let summary: string;

  if (matchScore >= 70 && passedCount >= 5 && !isLimitUp) {
    action = "逢低布局";
    confidence = mainScore >= 40 ? "high" : "medium";
    summary =
      "多數優質潛力條件成立，且非漲停追價狀態，可納入逢低分批布局觀察。";
  } else if (matchScore >= 70 && passedCount >= 5 && isLimitUp) {
    action = "強勢追蹤";
    confidence = "medium";
    summary =
      "潛力條件佳且短線強勢漲停，宜追蹤後續是否鎖單與量價配合，不宜盲目追價。";
  } else if (matchScore >= 50 && passedCount >= 4) {
    action = isLimitUp ? "追高風險" : "偏多觀察";
    confidence = "medium";
    summary = isLimitUp
      ? "潛力條件尚可但已漲停，短線偏強、追高風險偏高，建議等回檔或確認續航力。"
      : "潛力條件部分成立，可列入觀察名單，待更多條件轉佳或量價確認後再進場。";
  } else if (isLimitUp && mainScore >= 50) {
    action = "追高風險";
    confidence = "medium";
    summary =
      "短線主力訊號偏強並處於漲停，屬動能股而非價值布局，僅適合嚴格停損的短線操作。";
  } else if (matchScore < 30 && mainScore < 30) {
    action = "暫不建議";
    confidence = "high";
    summary =
      "主力動能與潛力條件皆偏弱，目前不符合兩套篩選邏輯的進場條件。";
  } else if (isLimitUp && matchScore < 50) {
    action = "追高風險";
    confidence = "low";
    summary =
      "雖有漲停動能，但潛力條件不足，較像短線題材行情，追高勝率與風險需自行評估。";
  } else {
    action = "觀望";
    confidence = "low";
    summary =
      "兩套條件訊號混雜或強度不足，建議持續觀察籌碼、融資與量價結構後再決定。";
  }

  return {
    action,
    confidence,
    summary,
    reasons: unique(reasons).slice(0, 6),
    risks: unique(risks).slice(0, 5),
    combinedScore,
  };
}
