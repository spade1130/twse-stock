import type { Market } from "@/types/stock";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const HISTORY_FETCH_RETRIES = 2;
const HISTORY_FETCH_RETRY_MS = 200;
const HISTORY_CACHE_TTL_MS = 60 * 60 * 1000;
const MONTH_FETCH_GAP_MS = 80;
/** Cap concurrent TWSE/TPEx month requests across the process. */
const GLOBAL_HISTORY_SLOTS = 2;

export interface DailyBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface FetchStockHistoryOptions {
  forceRefresh?: boolean;
  /** Skip the expensive full second pass when first pass is thin. */
  allowFullRetry?: boolean;
  /** Prefer a single-request Yahoo chart feed before TWSE month APIs. */
  preferFastSource?: boolean;
  minBarsToCache?: number;
}

interface HistoryCacheEntry {
  expiresAt: number;
  bars: DailyBar[];
}

const historyCache = new Map<string, HistoryCacheEntry>();

let activeHistorySlots = 0;
const historyWaitQueue: Array<() => void> = [];

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

async function acquireHistorySlot(): Promise<void> {
  if (activeHistorySlots < GLOBAL_HISTORY_SLOTS) {
    activeHistorySlots += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    historyWaitQueue.push(resolve);
  });
  activeHistorySlots += 1;
}

function releaseHistorySlot(): void {
  activeHistorySlots = Math.max(0, activeHistorySlots - 1);
  const next = historyWaitQueue.shift();
  if (next) next();
}

async function withHistorySlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireHistorySlot();
  try {
    return await fn();
  } finally {
    releaseHistorySlot();
  }
}

function toYahooSymbol(code: string, market: Market): string {
  return `${code}.${market === "tse" ? "TW" : "TWO"}`;
}

function unixToISODate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/** One request for ~4 months of bars; much faster than TWSE month loops. */
async function fetchYahooHistory(
  code: string,
  market: Market,
): Promise<DailyBar[]> {
  const symbol = toYahooSymbol(code, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=4mo`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      chart?: {
        result?: Array<{
          timestamp?: number[];
          indicators?: {
            quote?: Array<{
              open?: Array<number | null>;
              high?: Array<number | null>;
              low?: Array<number | null>;
              close?: Array<number | null>;
              volume?: Array<number | null>;
            }>;
          };
        }>;
      };
    };

    const result = json.chart?.result?.[0];
    const timestamps = result?.timestamp;
    const quote = result?.indicators?.quote?.[0];
    if (!timestamps?.length || !quote) return [];

    const bars: DailyBar[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = quote.close?.[i];
      if (close == null || !Number.isFinite(close) || close <= 0) continue;
      bars.push({
        date: unixToISODate(timestamps[i]),
        open: quote.open?.[i] ?? close,
        high: quote.high?.[i] ?? close,
        low: quote.low?.[i] ?? close,
        close,
        volume: quote.volume?.[i] ?? 0,
      });
    }

    return sortBars(bars);
  } catch {
    return [];
  }
}

async function fetchTwseMonth(
  stockNo: string,
  date: string,
): Promise<DailyBar[]> {
  return withHistorySlot(async () => {
    const url = `https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date=${date}&stockNo=${stockNo}&response=json`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://www.twse.com.tw/",
      },
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
  });
}

async function fetchTpexMonth(
  stockNo: string,
  rocYearMonth: string,
): Promise<DailyBar[]> {
  return withHistorySlot(async () => {
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
  });
}

function monthOffsets(base: Date, count: number): Date[] {
  const months: Date[] = [];
  // Always use day=1 so month rollback never overflows
  // (e.g. Jul 31 -> jun 31 would otherwise become Jul 1).
  const year = base.getFullYear();
  const month = base.getMonth();
  for (let i = 0; i < count; i++) {
    months.push(new Date(year, month - i, 1));
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
    try {
      lastResult = await fetcher();
      if (lastResult.length > 0) return lastResult;
    } catch {
      lastResult = [];
    }
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

/** Fetch months sequentially to avoid TWSE rate-limit bursts. */
async function fetchMonthsSequentially(
  code: string,
  market: Market,
  monthDates: Date[],
): Promise<DailyBar[]> {
  const merged = new Map<string, DailyBar>();

  for (let i = 0; i < monthDates.length; i++) {
    const d = monthDates[i];
    const bars =
      market === "tse"
        ? await fetchMonthWithRetry(() => fetchTwseMonth(code, toTwseDate(d)))
        : await fetchMonthWithRetry(() =>
            fetchTpexMonth(code, toTpexRocMonth(d)),
          );

    for (const bar of bars) {
      merged.set(bar.date, bar);
    }

    if (i < monthDates.length - 1) {
      await delay(MONTH_FETCH_GAP_MS);
    }
  }

  return sortBars(Array.from(merged.values()));
}

export async function fetchStockHistory(
  code: string,
  market: Market,
  months = 4,
  options?: FetchStockHistoryOptions,
): Promise<DailyBar[]> {
  const minBarsToCache = options?.minBarsToCache ?? 45;
  const allowFullRetry = options?.allowFullRetry !== false;
  const preferFastSource = options?.preferFastSource !== false;
  const key = historyCacheKey(code, market, months);
  const cached = historyCache.get(key);
  if (
    !options?.forceRefresh &&
    cached &&
    cached.expiresAt > Date.now() &&
    cached.bars.length >= minBarsToCache
  ) {
    return cached.bars;
  }

  // Fast path: one Yahoo request instead of N TWSE month round-trips.
  if (preferFastSource) {
    const yahooBars = await fetchYahooHistory(code, market);
    if (yahooBars.length >= minBarsToCache) {
      historyCache.set(key, {
        expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
        bars: yahooBars,
      });
      return yahooBars;
    }
  }

  const now = new Date();
  const monthDates = monthOffsets(now, months);
  let bars = await fetchMonthsSequentially(code, market, monthDates);

  // One full retry if the first pass looks truncated (likely rate-limited).
  if (allowFullRetry && bars.length < minBarsToCache) {
    await delay(400);
    bars = await fetchMonthsSequentially(code, market, monthDates);
  }

  // Only cache sufficiently complete histories so partial failures aren't sticky.
  if (bars.length >= minBarsToCache) {
    historyCache.set(key, {
      expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
      bars,
    });
  } else {
    historyCache.delete(key);
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
