import type { DailyBar } from "@/lib/stock-history";
import { calcKd, calcMacd, calcRsi, smaSeries } from "@/lib/indicators";
import type {
  AdviceAction,
  AdviceConfidence,
  GranvilleFocusBuy,
  GranvilleIndicators,
  GranvilleRuleId,
  GranvilleRuleResult,
  GranvilleStock,
  MaSlope,
  Market,
  StockAdvice,
} from "@/types/stock";

export const GRANVILLE_MA_PERIOD = 20;
export const GRANVILLE_SCORE_MAX = 100;
export const GRANVILLE_SCORE_BASE = 18;
export const MIN_GRANVILLE_BARS = 40;

const MA_SLOPE_LOOKBACK = 5;
const MA_SLOPE_PCT = 0.004;
const BUY2_WINDOW = 12;
const BUY3_WINDOW = 8;

export const GRANVILLE_RULE_DEFS: Array<{
  id: GranvilleRuleId;
  side: "buy" | "sell";
  label: string;
  title: string;
  description: string;
  highlighted: boolean;
}> = [
  {
    id: "buy1",
    side: "buy",
    label: "買點 1",
    title: "向上突破走平／上揚均線",
    description: "股價由均線下方站上走平或上揚的月線，視為趨勢翻多。",
    highlighted: false,
  },
  {
    id: "buy2",
    side: "buy",
    label: "買點 2",
    title: "回檔不破上升均線",
    description:
      "均線上升時回檔靠近月線但不跌破，為順勢加碼；主升段發動前常見的洗盤結構。",
    highlighted: true,
  },
  {
    id: "buy3",
    side: "buy",
    label: "買點 3",
    title: "跌破後迅速站回",
    description:
      "上升均線被短暫跌破後很快收復，屬假跌破／洗盤；主力布局後常見的型態。",
    highlighted: true,
  },
  {
    id: "buy4",
    side: "buy",
    label: "買點 4",
    title: "遠離均線、乖離過大",
    description: "股價大幅低於均線，超跌反彈機會增加，但趨勢未必翻多。",
    highlighted: false,
  },
  {
    id: "sell1",
    side: "sell",
    label: "賣點 1",
    title: "遠離上升均線、乖離過大",
    description: "上升趨勢中股價過度偏離均線，過熱宜獲利了結。",
    highlighted: false,
  },
  {
    id: "sell2",
    side: "sell",
    label: "賣點 2",
    title: "跌破走平／下彎均線",
    description: "股價跌破走平或下彎均線，多頭轉弱。",
    highlighted: false,
  },
  {
    id: "sell3",
    side: "sell",
    label: "賣點 3",
    title: "反彈無法突破下降均線",
    description: "下降均線成為壓力，反彈高點靠近均線後仍收在下方。",
    highlighted: false,
  },
  {
    id: "sell4",
    side: "sell",
    label: "賣點 4",
    title: "短暫突破又跌回",
    description: "下降趨勢中假突破均線後跌回，續跌機率較高。",
    highlighted: false,
  },
];

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function classifySlope(current: number, previous: number): MaSlope {
  if (current <= 0 || previous <= 0) return "flat";
  const pct = (current - previous) / previous;
  if (pct > MA_SLOPE_PCT) return "rising";
  if (pct < -MA_SLOPE_PCT) return "falling";
  return "flat";
}

function slopeLabel(slope: MaSlope): string {
  switch (slope) {
    case "rising":
      return "上揚";
    case "falling":
      return "下彎";
    default:
      return "走平";
  }
}

function mergeTodayBar(
  history: DailyBar[],
  today: DailyBar,
): DailyBar[] {
  if (history.length === 0) return [today];
  const last = history[history.length - 1];
  if (last.date >= today.date) {
    return [
      ...history.slice(0, -1),
      {
        ...last,
        open: today.open || last.open,
        high: Math.max(last.high, today.high),
        low:
          today.low > 0
            ? Math.min(last.low > 0 ? last.low : today.low, today.low)
            : last.low,
        close: today.close,
        volume: today.volume || last.volume,
      },
    ];
  }
  return [...history, today];
}

export function calcGain60dPct(
  currentPrice: number,
  history: DailyBar[],
  fallbackTodayISO: string,
): number {
  if (currentPrice <= 0 || history.length < 2) return 0;
  const d = new Date(`${fallbackTodayISO}T00:00:00+08:00`);
  d.setDate(d.getDate() - 60);
  const targetISO = d.toISOString().slice(0, 10);
  let pastClose: number | null = null;
  for (const bar of history) {
    if (bar.date <= targetISO) pastClose = bar.close;
    else break;
  }
  if (!pastClose || pastClose <= 0) return 0;
  return ((currentPrice - pastClose) / pastClose) * 100;
}

function detectBuy1(
  closes: number[],
  ma: number[],
  slope: MaSlope,
  i: number,
): { matched: boolean; detail: string } {
  if (i < 1 || ma[i] <= 0 || ma[i - 1] <= 0) {
    return { matched: false, detail: "均線資料不足" };
  }
  const brokeOut = closes[i - 1] <= ma[i - 1] * 1.002 && closes[i] > ma[i];
  const matched = brokeOut && (slope === "rising" || slope === "flat");
  return {
    matched,
    detail: matched
      ? `收盤由 ${closes[i - 1].toFixed(2)} 站上${slopeLabel(slope)}月線 ${ma[i].toFixed(2)}，趨勢翻多`
      : `尚未向上突破${slopeLabel(slope)}月線`,
  };
}

function detectBuy2(
  bars: DailyBar[],
  closes: number[],
  ma: number[],
  slope: MaSlope,
  i: number,
): { matched: boolean; detail: string } {
  if (slope !== "rising" || ma[i] <= 0 || closes[i] < ma[i] * 0.997) {
    return {
      matched: false,
      detail:
        slope !== "rising"
          ? "月線未上揚，不符合回檔不破的上升趨勢"
          : `收盤 ${closes[i].toFixed(2)} 未站穩月線 ${ma[i].toFixed(2)}`,
    };
  }

  const from = Math.max(GRANVILLE_MA_PERIOD, i - BUY2_WINDOW + 1);
  let maxBias = -Infinity;
  let approached = false;
  let brokeClose = false;
  let minLow = Infinity;

  for (let j = from; j <= i; j++) {
    if (ma[j] <= 0) continue;
    const bias = (closes[j] - ma[j]) / ma[j];
    maxBias = Math.max(maxBias, bias);
    const low = bars[j].low > 0 ? bars[j].low : bars[j].close;
    minLow = Math.min(minLow, low);
    if (low <= ma[j] * 1.025) approached = true;
    if (closes[j] < ma[j] * 0.99) brokeClose = true;
  }

  const recentLow = Math.min(
    ...bars.slice(Math.max(from, i - 4), i + 1).map((b) => (b.low > 0 ? b.low : b.close)),
  );
  const bouncing = closes[i] > recentLow * 1.004;
  const matched = approached && !brokeClose && maxBias >= 0.018 && bouncing;

  if (matched) {
    return {
      matched: true,
      detail: `上升月線 ${ma[i].toFixed(2)}，回檔低點 ${minLow.toFixed(2)} 靠近均線且收盤未破，屬順勢加碼結構`,
    };
  }

  return {
    matched: false,
    detail: approached
      ? "雖靠近均線，但收盤曾跌破或尚未出現止穩反彈"
      : "近期回檔尚未靠近上升月線",
  };
}

function detectBuy3(
  bars: DailyBar[],
  closes: number[],
  ma: number[],
  slope: MaSlope,
  i: number,
): { matched: boolean; detail: string } {
  if (slope !== "rising" || ma[i] <= 0) {
    return { matched: false, detail: "月線未上揚，不符合假跌破後站回" };
  }
  if (closes[i] <= ma[i]) {
    return {
      matched: false,
      detail: `收盤 ${closes[i].toFixed(2)} 尚未站回月線 ${ma[i].toFixed(2)}`,
    };
  }

  const from = Math.max(GRANVILLE_MA_PERIOD, i - BUY3_WINDOW + 1);
  const belowIdx: number[] = [];
  let minClose = closes[i];

  for (let j = from; j <= i; j++) {
    if (ma[j] <= 0) continue;
    minClose = Math.min(minClose, closes[j]);
    if (closes[j] < ma[j] * 0.997) belowIdx.push(j);
  }

  if (belowIdx.length === 0) {
    return { matched: false, detail: "近期沒有跌破上升月線" };
  }

  const lastBelow = belowIdx[belowIdx.length - 1];
  const daysBelow = belowIdx.length;
  const recentBreak = i - lastBelow <= 3;
  const brief = daysBelow <= 3;
  const notCrash = minClose > ma[i] * 0.955;
  const reclaimedRecently = i - lastBelow >= 1 || closes[i] > ma[i] * 1.001;
  const green = bars[i].close >= bars[i].open;

  const matched =
    recentBreak && brief && notCrash && reclaimedRecently && (green || closes[i] > ma[i] * 1.003);

  return {
    matched,
    detail: matched
      ? `上升月線曾被跌破（約 ${daysBelow} 日），收盤 ${closes[i].toFixed(2)} 已迅速站回 ${ma[i].toFixed(2)}，屬假跌破洗盤`
      : "雖曾跌破月線，但跌破過深、過久或尚未有效站回",
  };
}

function detectBuy4(
  close: number,
  ma: number,
  rsi: number,
): { matched: boolean; detail: string } {
  if (ma <= 0) return { matched: false, detail: "均線資料不足" };
  const bias = ((close - ma) / ma) * 100;
  const matched = bias <= -8 && rsi <= 42;
  return {
    matched,
    detail: matched
      ? `月線乖離 ${bias.toFixed(1)}%、RSI ${rsi.toFixed(0)}，超跌反彈機會增加`
      : `乖離 ${bias.toFixed(1)}%、RSI ${rsi.toFixed(0)}，尚未達超跌反彈條件`,
  };
}

function detectSell1(
  close: number,
  ma: number,
  slope: MaSlope,
  rsi: number,
): { matched: boolean; detail: string } {
  if (ma <= 0) return { matched: false, detail: "均線資料不足" };
  const bias = ((close - ma) / ma) * 100;
  const matched = (slope === "rising" || slope === "flat") && bias >= 8 && rsi >= 68;
  return {
    matched,
    detail: matched
      ? `月線乖離 ${bias.toFixed(1)}%、RSI ${rsi.toFixed(0)}，偏離過大宜留意獲利了結`
      : `乖離 ${bias.toFixed(1)}%，尚未出現過熱賣點`,
  };
}

function detectSell2(
  closes: number[],
  ma: number[],
  slope: MaSlope,
  i: number,
): { matched: boolean; detail: string } {
  if (i < 1 || ma[i] <= 0 || ma[i - 1] <= 0) {
    return { matched: false, detail: "均線資料不足" };
  }
  const broke =
    closes[i - 1] >= ma[i - 1] * 0.998 && closes[i] < ma[i] * 0.998;
  const matched = broke && (slope === "flat" || slope === "falling");
  return {
    matched,
    detail: matched
      ? `收盤跌破${slopeLabel(slope)}月線 ${ma[i].toFixed(2)}，多頭轉弱`
      : `尚未跌破${slopeLabel(slope)}月線`,
  };
}

function detectSell3(
  bars: DailyBar[],
  closes: number[],
  ma: number[],
  slope: MaSlope,
  i: number,
): { matched: boolean; detail: string } {
  if (slope !== "falling" || ma[i] <= 0 || closes[i] >= ma[i]) {
    return {
      matched: false,
      detail:
        slope !== "falling"
          ? "月線未下彎，不符合下降壓力賣點"
          : "收盤已在月線之上",
    };
  }

  const from = Math.max(GRANVILLE_MA_PERIOD, i - 8);
  let tested = false;
  for (let j = from; j <= i; j++) {
    if (ma[j] <= 0) continue;
    const high = bars[j].high || bars[j].close;
    if (high >= ma[j] * 0.99 && closes[j] < ma[j]) tested = true;
  }

  return {
    matched: tested,
    detail: tested
      ? `反彈高點靠近下降月線 ${ma[i].toFixed(2)} 後仍收在下方，壓力確認`
      : "下降趨勢中尚未出現靠近均線的失敗反彈",
  };
}

function detectSell4(
  closes: number[],
  ma: number[],
  slope: MaSlope,
  i: number,
): { matched: boolean; detail: string } {
  if (slope !== "falling" || ma[i] <= 0) {
    return { matched: false, detail: "月線未下彎，不符合假突破續跌" };
  }
  if (closes[i] >= ma[i]) {
    return { matched: false, detail: "收盤仍在月線之上，尚未跌回" };
  }

  const from = Math.max(GRANVILLE_MA_PERIOD, i - 5);
  const aboveIdx: number[] = [];
  for (let j = from; j < i; j++) {
    if (ma[j] > 0 && closes[j] > ma[j]) aboveIdx.push(j);
  }

  const matched = aboveIdx.length > 0 && aboveIdx.length <= 3 && i - aboveIdx[aboveIdx.length - 1] <= 3;
  return {
    matched,
    detail: matched
      ? `曾短暫站上下降月線後跌回 ${closes[i].toFixed(2)}，屬假突破續跌`
      : "近期沒有短暫突破下降月線又跌回的結構",
  };
}

function volumeSnapshot(
  bars: DailyBar[],
): Pick<
  GranvilleIndicators,
  "volumeAvg20" | "volumeRatio20" | "volumeTrend" | "volumeNote"
> {
  const volumes = bars.map((b) => b.volume);
  const avgSeries = smaSeries(volumes, 20);
  const i = bars.length - 1;
  const avg = avgSeries[i] || 0;
  const today = volumes[i] || 0;
  const ratio = avg > 0 ? today / avg : 0;

  const recent = volumes.slice(Math.max(0, i - 4), i);
  const recentAvg =
    recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;

  let volumeTrend: GranvilleIndicators["volumeTrend"] = "neutral";
  if (avg > 0 && recentAvg > 0 && recentAvg <= avg * 0.85 && ratio < 1.1) {
    volumeTrend = "shrinking";
  } else if (ratio >= 1.25) {
    volumeTrend = "expanding";
  }

  const volumeNote =
    volumeTrend === "shrinking"
      ? `近幾日量能低於 20 日均量，回檔縮量較健康（量比 ${ratio.toFixed(2)}）`
      : volumeTrend === "expanding"
        ? `今日量能放大至 20 日均量 ${ratio.toFixed(2)} 倍`
        : avg > 0
          ? `量比 20 日均量 ${ratio.toFixed(2)} 倍，量能中性`
          : "成交量資料不足";

  return {
    volumeAvg20: avg,
    volumeRatio20: ratio,
    volumeTrend,
    volumeNote,
  };
}

function buildIndicators(
  bars: DailyBar[],
  closes: number[],
): GranvilleIndicators {
  const volume = volumeSnapshot(bars);
  const macd = calcMacd(closes);
  const kd = calcKd(bars);
  const rsi = calcRsi(closes);

  let macdSignal = "資料不足";
  if (macd) {
    if (macd.goldenCross) macdSignal = "黃金交叉，動能轉強";
    else if (macd.deathCross) macdSignal = "死亡交叉，動能轉弱";
    else if (macd.histogram > 0 && macd.histogram >= macd.prevHistogram) {
      macdSignal = "柱狀體在零軸上擴張";
    } else if (macd.histogram > macd.prevHistogram) {
      macdSignal = "柱狀體由弱轉強";
    } else if (macd.histogram < 0 && macd.histogram < macd.prevHistogram) {
      macdSignal = "柱狀體在零軸下擴大，偏空";
    } else {
      macdSignal = macd.dif >= 0 ? "DIF 在零軸上，偏多整理" : "DIF 在零軸下，偏空整理";
    }
  }

  let kdSignal = "資料不足";
  if (kd) {
    if (kd.goldenCross && kd.k < 50) kdSignal = "低檔黃金交叉";
    else if (kd.goldenCross) kdSignal = "黃金交叉";
    else if (kd.deathCross && kd.k > 50) kdSignal = "高檔死亡交叉";
    else if (kd.deathCross) kdSignal = "死亡交叉";
    else if (kd.k > 80 && kd.d > 80) kdSignal = "高檔超買";
    else if (kd.k < 20 && kd.d < 20) kdSignal = "低檔超賣";
    else if (kd.k > kd.d) kdSignal = "K 在 D 之上，偏多";
    else kdSignal = "K 在 D 之下，偏空";
  }

  let rsiSignal = "中性";
  if (rsi >= 70) rsiSignal = "超買，追高風險高";
  else if (rsi <= 30) rsiSignal = "超賣，留意反彈";
  else if (rsi >= 40 && rsi <= 60) rsiSignal = "位於 40–60，尚未過熱";
  else if (rsi > 60) rsiSignal = "偏多但接近過熱";
  else rsiSignal = "偏弱整理";

  return {
    ...volume,
    macdDif: macd?.dif ?? 0,
    macdDea: macd?.dea ?? 0,
    macdHistogram: macd?.histogram ?? 0,
    macdPrevHistogram: macd?.prevHistogram ?? 0,
    macdSignal,
    k: kd?.k ?? 50,
    d: kd?.d ?? 50,
    j: kd?.j ?? 50,
    kdSignal,
    rsi,
    rsiSignal,
  };
}

function buildAdvice(
  rules: GranvilleRuleResult[],
  indicators: GranvilleIndicators,
  gain60d: number,
  bias20: number,
  slope: MaSlope,
): StockAdvice {
  const byId = Object.fromEntries(rules.map((r) => [r.id, r])) as Record<
    GranvilleRuleId,
    GranvilleRuleResult
  >;
  const buy2 = byId.buy2.matched;
  const buy3 = byId.buy3.matched;
  const buy1 = byId.buy1.matched;
  const buy4 = byId.buy4.matched;
  const sellHits = rules.filter((r) => r.side === "sell" && r.matched);
  const notSurged = gain60d < 20;
  const overbought = indicators.rsi >= 70 || bias20 >= 8;
  const macdImproving =
    indicators.macdHistogram > indicators.macdPrevHistogram ||
    indicators.macdSignal.includes("黃金交叉");
  const kdSupport =
    indicators.kdSignal.includes("黃金交叉") ||
    (indicators.k > indicators.d && indicators.k < 80);
  const volumeOk =
    indicators.volumeTrend === "shrinking" ||
    indicators.volumeTrend === "expanding";

  const reasons: string[] = [];
  const risks: string[] = [];

  if (buy2) reasons.push("符合葛蘭碧第二買點：回檔不破上升均線，適合順勢觀察加碼");
  if (buy3) reasons.push("符合葛蘭碧第三買點：假跌破後站回，洗盤後較易進入主升");
  if (buy1) reasons.push("股價向上突破月線，趨勢有翻多跡象");
  if (buy4) reasons.push("乖離過大，短線有超跌反彈空間");
  if (notSurged) reasons.push(`近 60 日漲幅 ${gain60d.toFixed(1)}%，尚未大漲`);
  if (indicators.volumeTrend === "shrinking" && (buy2 || buy3)) {
    reasons.push("回檔過程量能收斂，較符合主力洗盤而非出貨");
  }
  if (indicators.volumeTrend === "expanding" && (buy2 || buy3 || buy1)) {
    reasons.push(indicators.volumeNote);
  }
  if (macdImproving) reasons.push(`MACD：${indicators.macdSignal}`);
  if (kdSupport) reasons.push(`KD：${indicators.kdSignal}`);
  if (indicators.rsi >= 40 && indicators.rsi < 70) {
    reasons.push(`RSI ${indicators.rsi.toFixed(0)}，${indicators.rsiSignal}`);
  }

  if (gain60d >= 20) {
    risks.push(`近 60 日已漲 ${gain60d.toFixed(1)}%，比較不像「尚未大漲」標的`);
  }
  if (overbought) risks.push("RSI 或乖離偏高，追價風險增加");
  if (sellHits.length > 0) {
    risks.push(`同時出現賣點：${sellHits.map((s) => s.label).join("、")}`);
  }
  if (indicators.kdSignal.includes("死亡交叉") || indicators.macdSignal.includes("死亡交叉")) {
    risks.push("動能指標出現轉弱訊號");
  }
  if (slope === "falling" && !buy4) {
    risks.push("月線下彎，多頭結構尚未修復");
  }

  let action: AdviceAction;
  let confidence: AdviceConfidence;
  let summary: string;
  let combinedScore = 0;

  if ((buy2 || buy3) && sellHits.length === 0 && notSurged && !overbought) {
    action = "逢低布局";
    confidence =
      (buy2 && buy3) || (macdImproving && kdSupport && volumeOk) ? "high" : "medium";
    summary = buy2 && buy3
      ? "同時出現回檔不破與假跌破站回，且尚未大漲，較符合「主力已布局、準備發動」的觀察名單。"
      : buy2
        ? "上升趨勢中回檔不破月線，量價與動能若能同步，是葛蘭碧法則中最值得研究的加碼買點。"
        : "短暫跌破上升均線後迅速站回，偏洗盤而非轉空；可等量能跟上後再分批布局。";
  } else if ((buy2 || buy3) && (overbought || gain60d >= 20)) {
    action = gain60d >= 30 || indicators.rsi >= 75 ? "追高風險" : "偏多觀察";
    confidence = "medium";
    summary =
      "雖有第二／第三買點結構，但漲幅或指標已偏熱，宜等再回檔或量價確認，不宜追高。";
  } else if (buy1 && sellHits.length === 0 && indicators.rsi < 70) {
    action = "偏多觀察";
    confidence = macdImproving ? "medium" : "low";
    summary =
      "剛突破月線、趨勢翻多，屬第一買點；若尚未大漲可列入觀察，等回檔不破（第二買點）再提高勝率。";
  } else if (buy4 && sellHits.filter((s) => s.id !== "sell1").length === 0) {
    action = "觀望";
    confidence = "low";
    summary =
      "乖離過大的超跌反彈買點，反彈性質偏強、趨勢未必翻多，僅適合嚴格停損的短線。";
  } else if (sellHits.some((s) => s.id === "sell2" || s.id === "sell4") || sellHits.length >= 2) {
    action = "暫不建議";
    confidence = "high";
    summary = "賣點結構較明確，或均線已轉弱，目前不符合逢低布局條件。";
  } else if (sellHits.length > 0) {
    action = "觀望";
    confidence = "medium";
    summary = "買盤與賣壓訊號混雜，建議等待均線與量價結構更清楚。";
  } else {
    action = "觀望";
    confidence = "low";
    summary =
      "尚未出現清楚的葛蘭碧買賣點，可持續觀察是否形成回檔不破或假跌破站回。";
  }

  combinedScore = scoreGranville({
    buy1,
    buy2,
    buy3,
    buy4,
    sellHits: sellHits.map((s) => s.id),
    gain60d,
    indicators,
    bias20,
  });

  return {
    action,
    confidence,
    summary,
    reasons: unique(reasons).slice(0, 6),
    risks: unique(risks).slice(0, 5),
    combinedScore,
  };
}

function scoreGranville(params: {
  buy1: boolean;
  buy2: boolean;
  buy3: boolean;
  buy4: boolean;
  sellHits: GranvilleRuleId[];
  gain60d: number;
  indicators: GranvilleIndicators;
  bias20: number;
}): number {
  const { buy1, buy2, buy3, buy4, sellHits, gain60d, indicators, bias20 } = params;
  let score = 18;

  if (buy2) score += 32;
  if (buy3) score += 32;
  if (buy2 && buy3) score += 8;
  if (buy1) score += 10;
  if (buy4) score += 6;

  for (const id of sellHits) {
    if (id === "sell2" || id === "sell4") score -= 18;
    else score -= 12;
  }

  if (gain60d < 10) score += 12;
  else if (gain60d < 20) score += 8;
  else if (gain60d >= 30) score -= 16;
  else if (gain60d >= 20) score -= 8;

  if ((buy2 || buy3) && indicators.volumeTrend === "shrinking") score += 8;
  if ((buy2 || buy3 || buy1) && indicators.volumeTrend === "expanding") score += 6;
  if (indicators.volumeRatio20 >= 0.7 && indicators.volumeRatio20 <= 2.2) score += 4;

  if (indicators.macdSignal.includes("黃金交叉")) score += 8;
  else if (indicators.macdHistogram > indicators.macdPrevHistogram) score += 5;
  if (indicators.macdSignal.includes("死亡交叉")) score -= 8;

  if (indicators.kdSignal.includes("低檔黃金交叉")) score += 8;
  else if (indicators.kdSignal.includes("黃金交叉")) score += 5;
  else if (indicators.k > indicators.d && indicators.k < 80) score += 3;
  if (indicators.kdSignal.includes("死亡交叉")) score -= 6;
  if (indicators.k > 80 && indicators.d > 80) score -= 6;

  if (indicators.rsi >= 40 && indicators.rsi <= 60) score += 6;
  else if (indicators.rsi > 30 && indicators.rsi < 70) score += 2;
  if (indicators.rsi >= 70) score -= 8;

  if (bias20 > 0 && bias20 < 5 && (buy2 || buy3)) score += 4;

  return clamp(Math.round(score), 0, GRANVILLE_SCORE_MAX);
}

export function getGranvilleScoreBreakdown(stock: GranvilleStock): Array<{
  label: string;
  points: number;
}> {
  const items: Array<{ label: string; points: number }> = [];
  items.push({ label: "基礎分", points: GRANVILLE_SCORE_BASE });

  const matched = new Map(
    stock.rules.filter((r) => r.matched).map((r) => [r.id, r]),
  );
  const buy1 = matched.has("buy1");
  const buy2 = matched.has("buy2");
  const buy3 = matched.has("buy3");
  const buy4 = matched.has("buy4");

  if (buy2) items.push({ label: "買點 2（回檔不破均線）", points: 32 });
  if (buy3) items.push({ label: "買點 3（假跌破站回）", points: 32 });
  if (buy2 && buy3) items.push({ label: "買點 2＋3 共振", points: 8 });
  if (buy1) items.push({ label: "買點 1（突破均線）", points: 10 });
  if (buy4) items.push({ label: "買點 4（超跌反彈）", points: 6 });

  for (const rule of stock.rules.filter((r) => r.side === "sell" && r.matched)) {
    if (rule.id === "sell2" || rule.id === "sell4") {
      items.push({ label: `${rule.label}（${rule.title}）`, points: -18 });
    } else {
      items.push({ label: `${rule.label}（${rule.title}）`, points: -12 });
    }
  }

  const { gain60d, indicators, bias20 } = stock;

  if (gain60d < 10) {
    items.push({ label: "60 日漲幅 < 10%（尚未大漲）", points: 12 });
  } else if (gain60d < 20) {
    items.push({ label: "60 日漲幅 < 20%（尚未大漲）", points: 8 });
  } else if (gain60d >= 30) {
    items.push({ label: "60 日漲幅 ≥ 30%（已大漲）", points: -16 });
  } else if (gain60d >= 20) {
    items.push({ label: "60 日漲幅 ≥ 20%", points: -8 });
  }

  if ((buy2 || buy3) && indicators.volumeTrend === "shrinking") {
    items.push({ label: "回檔縮量", points: 8 });
  }
  if ((buy2 || buy3 || buy1) && indicators.volumeTrend === "expanding") {
    items.push({ label: "量能放大", points: 6 });
  }
  if (indicators.volumeRatio20 >= 0.7 && indicators.volumeRatio20 <= 2.2) {
    items.push({ label: "量比適中（0.7–2.2 倍）", points: 4 });
  }

  if (indicators.macdSignal.includes("黃金交叉")) {
    items.push({ label: "MACD 黃金交叉", points: 8 });
  } else if (indicators.macdHistogram > indicators.macdPrevHistogram) {
    items.push({ label: "MACD 柱狀體轉強", points: 5 });
  }
  if (indicators.macdSignal.includes("死亡交叉")) {
    items.push({ label: "MACD 死亡交叉", points: -8 });
  }

  if (indicators.kdSignal.includes("低檔黃金交叉")) {
    items.push({ label: "KD 低檔黃金交叉", points: 8 });
  } else if (indicators.kdSignal.includes("黃金交叉")) {
    items.push({ label: "KD 黃金交叉", points: 5 });
  } else if (indicators.k > indicators.d && indicators.k < 80) {
    items.push({ label: "K 在 D 之上（未超買）", points: 3 });
  }
  if (indicators.kdSignal.includes("死亡交叉")) {
    items.push({ label: "KD 死亡交叉", points: -6 });
  }
  if (indicators.k > 80 && indicators.d > 80) {
    items.push({ label: "KD 高檔超買", points: -6 });
  }

  if (indicators.rsi >= 40 && indicators.rsi <= 60) {
    items.push({ label: "RSI 40–60（未過熱）", points: 6 });
  } else if (indicators.rsi > 30 && indicators.rsi < 70) {
    items.push({ label: "RSI 適中", points: 2 });
  }
  if (indicators.rsi >= 70) {
    items.push({ label: "RSI 超買", points: -8 });
  }

  if (bias20 > 0 && bias20 < 5 && (buy2 || buy3)) {
    items.push({ label: "乖離適中（買點 2／3）", points: 4 });
  }

  return items;
}

export function getGranvilleScoreBreakdownSummary(stock: GranvilleStock): {
  items: Array<{ label: string; points: number }>;
  rawTotal: number;
  finalScore: number;
  wasClamped: boolean;
} {
  const items = getGranvilleScoreBreakdown(stock);
  const rawTotal = items.reduce((sum, item) => sum + item.points, 0);
  const finalScore = clamp(Math.round(rawTotal), 0, GRANVILLE_SCORE_MAX);
  return {
    items,
    rawTotal: Math.round(rawTotal),
    finalScore,
    wasClamped: finalScore !== Math.round(rawTotal),
  };
}

export function analyzeGranvilleStock(params: {
  code: string;
  name: string;
  market: Market;
  price: number;
  open: number;
  high: number;
  low: number;
  yesterdayClose: number;
  change: number;
  changePercent: number;
  volume: number;
  updateTime: string;
  history: DailyBar[];
  tradeDateISO: string;
}): GranvilleStock | null {
  const todayBar: DailyBar = {
    date: params.tradeDateISO,
    open: params.open || params.price,
    high: params.high || params.price,
    low: params.low || params.price,
    close: params.price,
    volume: params.volume,
  };

  const bars = mergeTodayBar(params.history, todayBar).filter(
    (b) => b.close > 0,
  );
  if (bars.length < MIN_GRANVILLE_BARS) return null;

  const closes = bars.map((b) => b.close);
  const ma = smaSeries(closes, GRANVILLE_MA_PERIOD);
  const i = bars.length - 1;
  const ma20 = ma[i];
  const ma20Prev = ma[Math.max(0, i - MA_SLOPE_LOOKBACK)] || ma20;
  if (ma20 <= 0) return null;

  const slope = classifySlope(ma20, ma20Prev);
  const bias20 = ((closes[i] - ma20) / ma20) * 100;
  const gain60d = calcGain60dPct(params.price, bars, params.tradeDateISO);
  const indicators = buildIndicators(bars, closes);

  const detections: Record<GranvilleRuleId, { matched: boolean; detail: string }> = {
    buy1: detectBuy1(closes, ma, slope, i),
    buy2: detectBuy2(bars, closes, ma, slope, i),
    buy3: detectBuy3(bars, closes, ma, slope, i),
    buy4: detectBuy4(closes[i], ma20, indicators.rsi),
    sell1: detectSell1(closes[i], ma20, slope, indicators.rsi),
    sell2: detectSell2(closes, ma, slope, i),
    sell3: detectSell3(bars, closes, ma, slope, i),
    sell4: detectSell4(closes, ma, slope, i),
  };

  const rules: GranvilleRuleResult[] = GRANVILLE_RULE_DEFS.map((def) => ({
    id: def.id,
    side: def.side,
    label: def.label,
    title: def.title,
    matched: detections[def.id].matched,
    highlighted: def.highlighted,
    detail: detections[def.id].detail,
  }));

  const buy2 = detections.buy2.matched;
  const buy3 = detections.buy3.matched;
  const focusBuy: GranvilleFocusBuy =
    buy2 && buy3 ? "both" : buy2 ? "buy2" : buy3 ? "buy3" : null;

  const advice = buildAdvice(rules, indicators, gain60d, bias20, slope);

  return {
    code: params.code,
    name: params.name,
    market: params.market,
    price: params.price,
    open: params.open,
    high: params.high,
    low: params.low,
    yesterdayClose: params.yesterdayClose,
    change: params.change,
    changePercent: params.changePercent,
    volume: params.volume,
    updateTime: params.updateTime,
    ma20,
    ma20Prev,
    maSlope: slope,
    bias20,
    gain60d,
    rules,
    focusBuy,
    indicators,
    advice,
    score: advice.combinedScore,
  };
}
