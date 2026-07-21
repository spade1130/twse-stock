import type { Market, PotentialConditionResult, PotentialStock } from "@/types/stock";
import type { DailyBar } from "@/lib/stock-history";
import { sma } from "@/lib/stock-history";
import {
  calcMarginChangePct,
  marginPassesCondition,
} from "@/lib/margin-data";
import type { TdccChipMetrics } from "@/lib/tdcc-data";

export const MATCH_SCORE_MAX = 100;
export const MATCH_CONDITION_POINTS = 10;
export const MATCH_MAJOR_HOLDER_BONUS = 20;
export const MATCH_MARGIN_BONUS = 10;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function isGreen(bar: DailyBar): boolean {
  return bar.close >= bar.open;
}

function isRed(bar: DailyBar): boolean {
  return bar.close < bar.open;
}

function calcLimitUpPrice(prevClose: number): number {
  // TWSE/TPEX common limit-up is 10%.
  return Math.round(prevClose * 1.1 * 100) / 100;
}

function avgVolume(bars: DailyBar[], period = 20): number {
  if (bars.length === 0) return 0;
  const slice = bars.slice(-period);
  return slice.reduce((sum, bar) => sum + bar.volume, 0) / slice.length;
}

function barMeetsBreakout(
  priorBars: DailyBar[],
  candidate: DailyBar,
): boolean {
  if (priorBars.length < 10) return false;

  let redIdx = -1;
  for (let i = priorBars.length - 1; i >= 0; i--) {
    if (isRed(priorBars[i])) {
      redIdx = i;
      break;
    }
  }
  if (redIdx < 0) return false;

  const red = priorBars[redIdx];
  const redHigh = red.high;
  const avgVol = avgVolume(priorBars.slice(0, redIdx + 1), 20);
  const volumeThreshold = Math.max(red.volume, avgVol * 1.2);

  for (let i = redIdx + 1; i < priorBars.length; i++) {
    const b = priorBars[i];
    const prevClose = priorBars[i - 1]?.close ?? b.close;
    const limitUp = calcLimitUpPrice(prevClose);
    const isLimitUp = b.close >= limitUp * 0.999;
    const breaks =
      isGreen(b) &&
      b.close > redHigh &&
      b.volume >= volumeThreshold &&
      !isLimitUp;
    if (breaks) return false;
  }

  if (!isGreen(candidate)) return false;
  if (candidate.close <= redHigh) return false;
  if (candidate.volume < volumeThreshold) return false;

  const prevClose =
    priorBars[priorBars.length - 1]?.close ?? candidate.close;
  const limitUp = calcLimitUpPrice(prevClose);
  if (candidate.close >= limitUp * 0.999) return false;

  return true;
}

function lastMostRecentRedBreakout(
  bars: DailyBar[],
  todays: { open: number; close: number; high: number; volume: number },
): boolean {
  if (bars.length < 20) return false;

  const todayBar: DailyBar = {
    date: "today",
    open: todays.open,
    close: todays.close,
    high: todays.high,
    low: 0,
    volume: todays.volume,
  };

  if (barMeetsBreakout(bars, todayBar)) return true;

  const last = bars[bars.length - 1];
  return barMeetsBreakout(bars.slice(0, -1), last);
}

function buildCondition(
  id: number,
  label: string,
  passed: boolean,
  detail: string,
): PotentialConditionResult {
  return { id, label, passed, detail };
}

export function analyzePotentialStock(params: {
  code: string;
  market: Market;
  name: string;
  todays: {
    price: number;
    open: number;
    high: number;
    volume: number;
  };
  history: DailyBar[];
  gain60dPct: number;
  chip: TdccChipMetrics | null;
  chipPrev: TdccChipMetrics | null;
  marginCurrent: number;
  marginPrevious: number;
}): PotentialStock {
  const { todays, history } = params;

  const closes = history.map((b) => b.close).filter((v) => v > 0);
  const lastClose = closes[closes.length - 1] ?? 0;

  const ma20 = sma(closes, 20);
  const ma60 = sma(closes, 60);

  const closesPrev = closes.slice(0, -1);
  const ma20Prev = sma(closesPrev, 20);
  const ma60Prev = sma(closesPrev, 60);

  const gain60d = params.gain60dPct;

  // Compare recent ~20 trading days vs the prior ~20 trading days.
  const recentBars = history.slice(-20);
  const priorBars = history.slice(-40, -20);
  const volCur = recentBars.reduce((sum, bar) => sum + bar.volume, 0);
  const volPrev = priorBars.reduce((sum, bar) => sum + bar.volume, 0);
  const monthlyVolChangePct =
    volPrev > 0 ? ((volCur - volPrev) / volPrev) * 100 : 0;

  const maPassed =
    todays.price > 0 &&
    ma20 > 0 &&
    ma60 > 0 &&
    todays.price > ma20 &&
    todays.price > ma60 &&
    ma20 > ma20Prev &&
    ma60 > ma60Prev;

  const hasChipHistory = params.chip != null && params.chipPrev != null;
  const chipConcentration = params.chip?.chipConcentration ?? 0;
  const chipPrevValue = params.chipPrev?.chipConcentration ?? 0;
  const chipChange = hasChipHistory
    ? chipConcentration - chipPrevValue
    : 0;

  const majorHolderPct = params.chip?.majorHolderPct ?? 0;
  const majorHolderPrev = params.chipPrev?.majorHolderPct ?? 0;
  const majorHolderChange = hasChipHistory
    ? majorHolderPct - majorHolderPrev
    : 0;

  const marginCurrent = params.marginCurrent;
  const marginPrevious = params.marginPrevious;
  const marginChangePct = calcMarginChangePct(marginCurrent, marginPrevious);

  // Condition 7: breakout of first green candle over latest red K, not limit-up.
  const breakoutPassed = lastMostRecentRedBreakout(history, {
    open: todays.open,
    close: todays.price,
    high: todays.high,
    volume: todays.volume,
  });

  const gain60dPassed = gain60d < 20;
  const chipIncPassed = hasChipHistory && chipChange > 0;
  const majorHolderIncPassed = hasChipHistory && majorHolderChange >= 3;
  const volumeIncPassed = monthlyVolChangePct >= 30;
  const marginPassed = marginPassesCondition(marginChangePct);

  const conditions: PotentialConditionResult[] = [
    buildCondition(
      1,
      "近60日漲幅 < 20%",
      gain60dPassed,
      `60日漲幅 ${gain60d.toFixed(2)}%`,
    ),
    buildCondition(
      2,
      "20日籌碼集中度增加",
      chipIncPassed,
      hasChipHistory
        ? `籌碼集中度 ${chipPrevValue.toFixed(2)}% → ${chipConcentration.toFixed(2)}%`
        : "無法取得 20 日前集保資料",
    ),
    buildCondition(
      3,
      "大戶持股增加 ≥ 3 個百分點",
      majorHolderIncPassed,
      `大戶持股 ${majorHolderPrev.toFixed(2)}% → ${majorHolderPct.toFixed(
        2,
      )}%`,
    ),
    buildCondition(
      4,
      "站上季線，月線/季線上揚",
      maPassed,
      `MA20 ${ma20Prev.toFixed(2)}→${ma20.toFixed(2)}, MA60 ${ma60Prev.toFixed(
        2,
      )}→${ma60.toFixed(2)}`,
    ),
    buildCondition(
      5,
      "成交量比前一個月 +30%",
      volumeIncPassed,
      `月量變化 ${monthlyVolChangePct.toFixed(2)}%`,
    ),
    buildCondition(
      6,
      "融資減少 5–15%",
      marginPassed,
      `融資變化 ${marginChangePct.toFixed(2)}%`,
    ),
    buildCondition(
      7,
      "第一根帶量突破紅K（未漲停）",
      breakoutPassed,
      breakoutPassed ? "已符合突破型態" : "未符合突破型態",
    ),
  ];

  const passedCount = conditions.filter((c) => c.passed).length;
  // 7 項條件各 10 分（70）＋大戶加分 20 ＋融資加分 10 ＝滿分 100
  const matchScore = clamp(
    passedCount * MATCH_CONDITION_POINTS +
      (majorHolderIncPassed ? MATCH_MAJOR_HOLDER_BONUS : 0) +
      (marginPassed ? MATCH_MARGIN_BONUS : 0),
    0,
    MATCH_SCORE_MAX,
  );

  const signals = conditions.filter((c) => c.passed).map((c) => c.label);

  return {
    code: params.code,
    name: params.name,
    market: params.market,
    price: todays.price,
    open: todays.open,
    high: todays.high,
    low: 0,
    yesterdayClose: lastClose,
    limitUp: 0,
    limitDown: 0,
    change: 0,
    changePercent: 0,
    volume: todays.volume,
    buyVolumes: [],
    sellVolumes: [],
    buyPrices: [],
    sellPrices: [],
    trendFlag: "0",
    updateTime: "",
    matchScore,
    conditions,
    gain60d,
    chipConcentration,
    chipConcentrationChange: chipChange,
    majorHolderPct,
    majorHolderChange,
    ma20,
    ma60,
    monthlyVolumeChange: monthlyVolChangePct,
    marginChangePct,
    signals,
  };
}

export const MATCH_SCORE_RULES = [
  {
    label: "近60日漲幅 < 20%",
    points: MATCH_CONDITION_POINTS,
    description: "60 日漲幅低於 20%，避免追高",
  },
  {
    label: "20日籌碼集中度增加",
    points: MATCH_CONDITION_POINTS,
    description: "集保大戶持股比例較 3 週前提升",
  },
  {
    label: "大戶持股增加 ≥ 3 個百分點",
    points: MATCH_CONDITION_POINTS,
    description: "1000 張以上大戶持股比例增加 ≥ 3 個百分點",
  },
  {
    label: "站上季線，月線/季線上揚",
    points: MATCH_CONDITION_POINTS,
    description: "股價站上月線與季線，且均線向上",
  },
  {
    label: "成交量比前一個月 +30%",
    points: MATCH_CONDITION_POINTS,
    description: "近 20 個交易日成交量較前 20 日增加 30% 以上",
  },
  {
    label: "融資減少 5–15%",
    points: MATCH_CONDITION_POINTS,
    description: "融資餘額較約一個月前減少 5% 至 15%",
  },
  {
    label: "第一根帶量突破紅K（未漲停）",
    points: MATCH_CONDITION_POINTS,
    description: "出現第一根帶量突破近期紅 K 高點的陽線，且未漲停",
  },
  {
    label: "大戶持股加分",
    points: MATCH_MAJOR_HOLDER_BONUS,
    description: "符合大戶持股條件時，於條件分數外額外加 20 分",
  },
  {
    label: "融資減少加分",
    points: MATCH_MARGIN_BONUS,
    description: "符合融資減少條件時，於條件分數外額外加 10 分",
  },
] as const;

export function getMatchScoreBreakdown(stock: PotentialStock) {
  const items: { label: string; points: number }[] = [];

  for (const condition of stock.conditions) {
    if (condition.passed) {
      items.push({ label: condition.label, points: MATCH_CONDITION_POINTS });
    }
  }

  const majorPassed = stock.conditions.find((c) => c.id === 3)?.passed;
  const marginPassed = stock.conditions.find((c) => c.id === 6)?.passed;

  if (majorPassed) {
    items.push({ label: "大戶持股加分", points: MATCH_MAJOR_HOLDER_BONUS });
  }
  if (marginPassed) {
    items.push({ label: "融資減少加分", points: MATCH_MARGIN_BONUS });
  }

  return items;
}

