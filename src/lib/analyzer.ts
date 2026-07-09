import type { InstitutionalData, LimitUpStock, StockInfo } from "@/types/stock";

export const MAIN_FORCE_SCORE_RULES = [
  { signal: "漲停", points: 20, description: "收盤價達漲停價或漲幅 ≥ 9.5%" },
  {
    signal: "法人買超",
    points: 30,
    description: "當日三大法人買超 > 10 萬股",
  },
  {
    signal: "法人小幅買超",
    points: 15,
    description: "當日三大法人小幅買超",
  },
  {
    signal: "量能爆發",
    points: 20,
    description: "成交量 ≥ 500 萬股，或達昨日 3 倍以上",
  },
  {
    signal: "量能放大",
    points: 10,
    description: "成交量 ≥ 100 萬股，或達昨日 1.5 倍以上",
  },
  {
    signal: "鎖漲停",
    points: 15,
    description: "收盤價等於當日最高價（收在漲停）",
  },
  {
    signal: "一字漲停",
    points: 10,
    description: "開盤價等於最高價且漲停",
  },
  { signal: "買盤佔優", points: 30, description: "即時五檔買量佔比 ≥ 70%" },
  { signal: "買盤略強", points: 15, description: "即時五檔買量佔比 ≥ 55%" },
  { signal: "賣壓稀薄", points: 25, description: "即時漲停價位無明顯賣單" },
  { signal: "暫緩撮合", points: 15, description: "即時達漲停後暫緩撮合" },
  { signal: "趨漲", points: 15, description: "即時價格趨勢向上" },
  { signal: "大單買進", points: 10, description: "即時買一量 > 1,000 張" },
] as const;

const SIGNAL_POINTS = Object.fromEntries(
  MAIN_FORCE_SCORE_RULES.map((r) => [r.signal, r.points]),
) as Record<string, number>;

export function getStockScoreBreakdown(signals: string[]) {
  return signals.map((signal) => ({
    signal,
    points: SIGNAL_POINTS[signal] ?? 0,
  }));
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function isLimitUp(stock: StockInfo): boolean {
  if (stock.limitUp <= 0 || stock.yesterdayClose <= 0) return false;

  const tolerance = 0.005;
  const atLimit =
    Math.abs(stock.price - stock.limitUp) <= tolerance ||
    Math.abs(stock.high - stock.limitUp) <= tolerance;

  const changePercent =
    ((stock.price - stock.yesterdayClose) / stock.yesterdayClose) * 100;

  return atLimit || changePercent >= 9.5;
}

export function calcBuyPressure(stock: StockInfo): number {
  const buyVol = sum(stock.buyVolumes);
  const sellVol = sum(stock.sellVolumes);
  const total = buyVol + sellVol;
  if (total === 0) return 0.5;
  return buyVol / total;
}

export function analyzeMainForce(
  stock: StockInfo,
  yesterdayVolume: number,
  institutional?: InstitutionalData,
): LimitUpStock {
  const signals: string[] = [];
  let score = 0;

  const hasOrderBook =
    stock.buyVolumes.length > 0 || stock.sellVolumes.length > 0;
  const buyPressure = hasOrderBook ? calcBuyPressure(stock) : 0;
  const volumeRatio =
    yesterdayVolume > 0
      ? stock.volume / yesterdayVolume
      : 0;

  if (hasOrderBook) {
    if (buyPressure >= 0.7) {
      score += 30;
      signals.push("買盤佔優");
    } else if (buyPressure >= 0.55) {
      score += 15;
      signals.push("買盤略強");
    }

    if (
      stock.sellPrices.length === 0 ||
      stock.sellVolumes.every((v) => v === 0)
    ) {
      score += 25;
      signals.push("賣壓稀薄");
    }

    if (stock.trendFlag === "2" || stock.trendFlag === "3") {
      score += 15;
      signals.push(stock.trendFlag === "3" ? "暫緩撮合" : "趨漲");
    }

    if (stock.buyVolumes[0] > 1000) {
      score += 10;
      signals.push("大單買進");
    }
  }

  if (isLimitUp(stock)) {
    score += 20;
    signals.push("漲停");
  }

  if (volumeRatio >= 3) {
    score += 20;
    signals.push("量能爆發");
  } else if (volumeRatio >= 1.5) {
    score += 10;
    signals.push("量能放大");
  } else if (!hasOrderBook) {
    if (stock.volume >= 5_000_000) {
      score += 20;
      signals.push("量能爆發");
    } else if (stock.volume >= 1_000_000) {
      score += 10;
      signals.push("量能放大");
    }
  }

  if (
    isLimitUp(stock) &&
    stock.high > 0 &&
    Math.abs(stock.price - stock.high) < 0.01
  ) {
    score += 15;
    signals.push("鎖漲停");
  }

  if (
    isLimitUp(stock) &&
    stock.open > 0 &&
    stock.high > 0 &&
    Math.abs(stock.open - stock.high) < 0.01
  ) {
    score += 10;
    signals.push("一字漲停");
  }

  const instNet = institutional?.totalNet ?? 0;
  if (instNet > 100000) {
    score += 30;
    signals.push("法人買超");
  } else if (instNet > 0) {
    score += 15;
    signals.push("法人小幅買超");
  }

  return {
    ...stock,
    isLimitUp: isLimitUp(stock),
    mainForceScore: Math.min(score, 100),
    buyPressure,
    volumeRatio,
    institutionalNet: instNet,
    signals,
  };
}

export function filterLimitUpStocks(
  stocks: LimitUpStock[],
  minScore = 0,
): LimitUpStock[] {
  return stocks
    .filter(
      (s) => s.isLimitUp && (minScore <= 0 || s.mainForceScore >= minScore),
    )
    .sort((a, b) => b.mainForceScore - a.mainForceScore);
}

export function searchStocks(
  stocks: LimitUpStock[],
  query: string,
): LimitUpStock[] {
  const q = query.trim().toLowerCase();
  if (!q) return stocks;

  return stocks.filter(
    (s) =>
      s.code.includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.signals.some((sig) => sig.includes(q)),
  );
}
