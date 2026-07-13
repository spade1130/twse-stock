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
