export type Market = "tse" | "otc";

export interface StockInfo {
  code: string;
  name: string;
  market: Market;
  price: number;
  open: number;
  high: number;
  low: number;
  yesterdayClose: number;
  limitUp: number;
  limitDown: number;
  change: number;
  changePercent: number;
  volume: number;
  buyVolumes: number[];
  sellVolumes: number[];
  buyPrices: number[];
  sellPrices: number[];
  trendFlag: string;
  updateTime: string;
}

export interface InstitutionalData {
  code: string;
  name: string;
  foreignNet: number;
  trustNet: number;
  dealerNet: number;
  totalNet: number;
}

export interface LimitUpStock extends StockInfo {
  isLimitUp: boolean;
  mainForceScore: number;
  buyPressure: number;
  volumeRatio: number;
  institutionalNet: number;
  signals: string[];
}

export interface LimitUpResponse {
  updatedAt: string;
  tradeDate: string;
  dataSource: "realtime" | "daily";
  marketStatus: "open" | "closed" | "unknown";
  totalScanned: number;
  limitUpCount: number;
  stocks: LimitUpStock[];
}

export interface PotentialConditionResult {
  id: number;
  label: string;
  passed: boolean;
  detail: string;
}

export interface PotentialStock extends StockInfo {
  matchScore: number;
  conditions: PotentialConditionResult[];
  gain60d: number;
  chipConcentration: number;
  chipConcentrationChange: number;
  majorHolderPct: number;
  majorHolderChange: number;
  ma20: number;
  ma60: number;
  monthlyVolumeChange: number;
  marginChangePct: number;
  signals: string[];
}

export type PotentialMatchMode = "full" | "partial";

export interface PotentialResponse {
  updatedAt: string;
  tradeDate: string;
  dataSource: "realtime" | "daily";
  marketStatus: "open" | "closed" | "unknown";
  totalScanned: number;
  marginFiltered: number;
  historyAnalyzed: number;
  matchMode: PotentialMatchMode;
  stocks: PotentialStock[];
}

export type AdviceAction =
  | "逢低布局"
  | "偏多觀察"
  | "強勢追蹤"
  | "追高風險"
  | "觀望"
  | "暫不建議";

export type AdviceConfidence = "high" | "medium" | "low";

export interface StockAdvice {
  action: AdviceAction;
  confidence: AdviceConfidence;
  summary: string;
  reasons: string[];
  risks: string[];
  combinedScore: number;
}

export interface StockCandidate {
  code: string;
  name: string;
  market: Market;
}

export interface StockAnalyzeResponse {
  updatedAt: string;
  tradeDate: string;
  dataSource: "realtime" | "daily";
  marketStatus: "open" | "closed" | "unknown";
  stock: LimitUpStock;
  potential: PotentialStock | null;
  potentialNote?: string;
  advice: StockAdvice;
  candidates?: StockCandidate[];
}

export type GranvilleRuleId =
  | "buy1"
  | "buy2"
  | "buy3"
  | "buy4"
  | "sell1"
  | "sell2"
  | "sell3"
  | "sell4";

export type GranvilleFocusBuy = "buy2" | "buy3" | "both" | null;

export type MaSlope = "rising" | "flat" | "falling";

export interface GranvilleRuleResult {
  id: GranvilleRuleId;
  side: "buy" | "sell";
  label: string;
  title: string;
  matched: boolean;
  highlighted: boolean;
  detail: string;
}

export interface GranvilleIndicators {
  volumeAvg20: number;
  volumeRatio20: number;
  volumeTrend: "shrinking" | "expanding" | "neutral";
  volumeNote: string;
  macdDif: number;
  macdDea: number;
  macdHistogram: number;
  macdPrevHistogram: number;
  macdSignal: string;
  k: number;
  d: number;
  j: number;
  kdSignal: string;
  rsi: number;
  rsiSignal: string;
}

export interface GranvilleStock {
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
  ma20: number;
  ma20Prev: number;
  maSlope: MaSlope;
  bias20: number;
  gain60d: number;
  rules: GranvilleRuleResult[];
  focusBuy: GranvilleFocusBuy;
  indicators: GranvilleIndicators;
  advice: StockAdvice;
  score: number;
}

export interface GranvilleResponse {
  updatedAt: string;
  tradeDate: string;
  dataSource: "realtime" | "daily";
  marketStatus: "open" | "closed" | "unknown";
  totalScanned: number;
  historyAnalyzed: number;
  buy2Count: number;
  buy3Count: number;
  stocks: GranvilleStock[];
}
