import type { Market } from "@/types/stock";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const HISTORY_FETCH_RETRIES = 2;
const HISTORY_FETCH_RETRY_MS = 120;
const HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface HistoryCacheEntry {
  expiresAt: number;
  bars: DailyBar[];
}

const historyCache = new Map<string, HistoryCacheEntry>();

function parseNum(value?: string): number {
  if (!value || value === "-" || value === "") return 0;
  const n = parseFloat(value.replace(/,/g, "").replace(/\s/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseRocDate(value: string): string {
  const parts = value.split("/");
  if (parts.length !== 3) return value;
  const year = parseInt(parts[0], 10) + 1911;
  const month = parts[1].padStart(2, "0");
  const day = parts[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortBars(bars: DailyBar[]): DailyBar[] {
  return [...bars].sort((a, b) => a.date.localeCompare(b.date));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchTwseMonth(
  stockNo: string,
  date: string,
): Promise<DailyBar[]> {
  const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=${stockNo}&response=json`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Referer: "https://www.twse.com.tw/" },
    cache: "no-store",
  });
  if (!res.ok) return [];

  const json = (await res.json()) as {
    stat?: string;
    data?: string[][];
  };
  if (json.stat !== "OK" || !json.data?.length) return [];

  return json.data.map((row) => ({
    date: parseRocDate(row[0]),
    volume: parseInt((row[1] ?? "0").replace(/,/g, ""), 10) || 0,
    open: parseNum(row[3]),
    high: parseNum(row[4]),
    low: parseNum(row[5]),
    close: parseNum(row[6]),
  }));
}

async function fetchTpexMonth(
  stockNo: string,
  rocYearMonth: string,
): Promise<DailyBar[]> {
  const url = `https://www.tpex.org.tw/web/stock/aftertrading/day/trading_info.php?l=zh-tw&d=${rocYearMonth}&stkno=${stockNo}&s=0,asc&o=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Referer: "https://www.tpex.org.tw/",
    },
    cache: "no-store",
  });
  if (!res.ok) return [];

  const text = await res.text();
  if (text.startsWith("<!")) return [];

  let json: { tables?: { data?: string[][] }[] };
  try {
    json = JSON.parse(text) as { tables?: { data?: string[][] }[] };
  } catch {
    return [];
  }

  const rows = json.tables?.[0]?.data;
  if (!rows?.length) return [];

  return rows.map((row) => ({
    date: parseRocDate(row[0]),
    volume: parseInt((row[1] ?? "0").replace(/,/g, ""), 10) || 0,
    open: parseNum(row[3]),
    high: parseNum(row[4]),
    low: parseNum(row[5]),
    close: parseNum(row[6]),
  }));
}

function monthOffsets(base: Date, count: number): Date[] {
  const months: Date[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(base);
    d.setMonth(d.getMonth() - i);
    months.push(d);
  }
  return months;
}

function toTwseDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function toTpexRocMonth(d: Date): string {
  const rocYear = d.getFullYear() - 1911;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${rocYear}/${month}`;
}

async function fetchMonthWithRetry(
  fetcher: () => Promise<DailyBar[]>,
): Promise<DailyBar[]> {
  let lastResult: DailyBar[] = [];

  for (let attempt = 0; attempt < HISTORY_FETCH_RETRIES; attempt++) {
    lastResult = await fetcher();
    if (lastResult.length > 0) return lastResult;
    if (attempt < HISTORY_FETCH_RETRIES - 1) {
      await delay(HISTORY_FETCH_RETRY_MS * (attempt + 1));
    }
  }

  return lastResult;
}

function historyCacheKey(code: string, market: Market, months: number): string {
  const day = new Date().toISOString().slice(0, 10);
  return `${day}|${market}|${code}|${months}`;
}

export async function fetchStockHistory(
  code: string,
  market: Market,
  months = 4,
): Promise<DailyBar[]> {
  const key = historyCacheKey(code, market, months);
  const cached = historyCache.get(key);
  if (cached && cached.expiresAt > Date.now() && cached.bars.length > 0) {
    return cached.bars;
  }

  const now = new Date();
  const monthDates = monthOffsets(now, months);
  const chunks = await Promise.all(
    monthDates.map((d) => {
      if (market === "tse") {
        return fetchMonthWithRetry(() => fetchTwseMonth(code, toTwseDate(d)));
      }
      return fetchMonthWithRetry(() => fetchTpexMonth(code, toTpexRocMonth(d)));
    }),
  );

  const merged = new Map<string, DailyBar>();
  for (const bars of chunks) {
    for (const bar of bars) {
      merged.set(bar.date, bar);
    }
  }

  const bars = sortBars(Array.from(merged.values()));
  if (bars.length > 0) {
    historyCache.set(key, {
      expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
      bars,
    });
  }
  return bars;
}

export function sma(values: number[], period: number): number {
  if (values.length < period) return 0;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

export function sumVolumeByMonth(
  bars: DailyBar[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const bar of bars) {
    const month = bar.date.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0) + bar.volume);
  }
  return totals;
}
