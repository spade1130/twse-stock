import { NextRequest, NextResponse } from "next/server";
import {
  fetchDailyQuotes,
  fetchLatestQuotes,
  fetchStockQuotes,
  getMarketStatus,
} from "@/lib/twse";
import { fetchStockHistory, type DailyBar } from "@/lib/stock-history";
import {
  analyzeGranvilleStock,
  MIN_GRANVILLE_BARS,
} from "@/lib/granville-analyzer";
import type { GranvilleResponse, GranvilleStock, StockInfo } from "@/types/stock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_HISTORY_CANDIDATES = 96;
const QUERY_MATCH_LIMIT = 12;
const HISTORY_MONTHS = 4;
const HISTORY_CONCURRENCY = 8;
const OPEN_MARKET_CACHE_MS = 2 * 60 * 1000;
const WORK_BUDGET_MS = 48_000;
const MIN_VOLUME = 400_000;
const MIN_PRICE = 8;

interface GranvilleCacheEntry {
  expiresAt: number;
  response: GranvilleResponse;
}

const granvilleResponseCache = new Map<string, GranvilleCacheEntry>();

interface TaipeiDateTime {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  weekday: number;
}

const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function getTaipeiDateTime(d = new Date()): TaipeiDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    year: parseInt(getPart("year"), 10),
    month: parseInt(getPart("month"), 10),
    day: parseInt(getPart("day"), 10),
    hours: parseInt(getPart("hour"), 10),
    minutes: parseInt(getPart("minute"), 10),
    weekday: WEEKDAY_MAP[getPart("weekday")] ?? -1,
  };
}

function taipeiDateTimeToTimestamp(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): number {
  return Date.UTC(year, month - 1, day, hours - 8, minutes, 0, 0);
}

function nextMarketOpenTimestamp(now = new Date()): number {
  const taipeiNow = getTaipeiDateTime(now);
  const currentMinutes = taipeiNow.hours * 60 + taipeiNow.minutes;
  const isWeekday = taipeiNow.weekday >= 1 && taipeiNow.weekday <= 5;

  if (isWeekday && currentMinutes < 9 * 60) {
    return taipeiDateTimeToTimestamp(
      taipeiNow.year,
      taipeiNow.month,
      taipeiNow.day,
      9,
      0,
    );
  }

  for (let addDays = 1; addDays <= 7; addDays++) {
    const candidate = new Date(
      taipeiDateTimeToTimestamp(
        taipeiNow.year,
        taipeiNow.month,
        taipeiNow.day + addDays,
        12,
        0,
      ),
    );
    const taipeiCandidate = getTaipeiDateTime(candidate);
    if (taipeiCandidate.weekday >= 1 && taipeiCandidate.weekday <= 5) {
      return taipeiDateTimeToTimestamp(
        taipeiCandidate.year,
        taipeiCandidate.month,
        taipeiCandidate.day,
        9,
        0,
      );
    }
  }

  return now.getTime() + OPEN_MARKET_CACHE_MS;
}

function formatTradeDateISO(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`;
  }
  return raw;
}

function toTradeDateISO(raw: string): string {
  return formatTradeDateISO(raw).replace(/\//g, "-");
}

function buildCacheKey(params: {
  tradeDate: string;
  dataSource: string;
  marketStatus: string;
  q: string;
  minScore: number;
}): string {
  return [
    params.tradeDate,
    params.dataSource,
    params.marketStatus,
    params.q,
    String(params.minScore),
  ].join("|");
}

function cloneResponse(response: GranvilleResponse): GranvilleResponse {
  return {
    ...response,
    stocks: response.stocks.map((stock) => ({
      ...stock,
      rules: stock.rules.map((rule) => ({ ...rule })),
      indicators: { ...stock.indicators },
      advice: {
        ...stock.advice,
        reasons: [...stock.advice.reasons],
        risks: [...stock.advice.risks],
      },
    })),
  };
}

async function loadQuoteUniverse(params: {
  marketStatus: "open" | "closed" | "unknown";
  deadlineMs: number;
}): Promise<{
  stocks: StockInfo[];
  tradeDate: string;
  dataSource: "realtime" | "daily";
}> {
  if (params.marketStatus !== "open") {
    const daily = await fetchDailyQuotes();
    const taipei = getTaipeiDateTime();
    return {
      stocks: daily,
      tradeDate: `${taipei.year}/${String(taipei.month).padStart(2, "0")}/${String(taipei.day).padStart(2, "0")}`,
      dataSource: "daily",
    };
  }

  return fetchLatestQuotes({
    concurrency: 6,
    batchSize: 120,
    deadlineMs: params.deadlineMs,
  });
}

function rankQueryMatches(stocks: StockInfo[], q: string): StockInfo[] {
  const query = q.trim().toLowerCase();
  const exactCode = stocks.filter((s) => s.code.toLowerCase() === query);
  if (exactCode.length > 0) return exactCode;

  const exactName = stocks.filter((s) => s.name.toLowerCase() === query);
  if (exactName.length > 0) return exactName;

  const codePrefix = stocks.filter((s) => s.code.toLowerCase().startsWith(query));
  if (codePrefix.length > 0) {
    return codePrefix.sort((a, b) => a.code.localeCompare(b.code));
  }

  return stocks
    .filter((s) => s.name.toLowerCase().includes(query))
    .sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
      const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.code.localeCompare(b.code);
    });
}

function buildScanCandidates(validStocks: StockInfo[]): StockInfo[] {
  return validStocks
    .filter(
      (s) =>
        s.volume >= MIN_VOLUME &&
        s.price >= MIN_PRICE &&
        s.changePercent < 9.5,
    )
    .sort((a, b) => b.price * b.volume - a.price * a.volume)
    .slice(0, MAX_HISTORY_CANDIDATES);
}

function sortGranville(a: GranvilleStock, b: GranvilleStock): number {
  const focusRank = (s: GranvilleStock) =>
    s.focusBuy === "both" ? 3 : s.focusBuy ? 2 : 0;
  const fa = focusRank(a);
  const fb = focusRank(b);
  if (fb !== fa) return fb - fa;
  if (b.score !== a.score) return b.score - a.score;
  return a.gain60d - b.gain60d;
}

async function mapLimitWithDeadline<T, R>(
  items: T[],
  concurrency: number,
  deadlineMs: number,
  worker: (item: T) => Promise<R | null>,
): Promise<Array<R | null>> {
  const results: Array<R | null> = new Array(items.length).fill(null);
  let idx = 0;
  let stopped = false;

  const runners = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (!stopped) {
        if (Date.now() >= deadlineMs) {
          stopped = true;
          break;
        }
        const current = idx++;
        if (current >= items.length) break;
        results[current] = await worker(items[current]);
      }
    });

  await Promise.all(runners);
  return results;
}

function hasEnoughHistory(history: DailyBar[]): boolean {
  if (history.length < MIN_GRANVILLE_BARS) return false;
  return history.filter((bar) => bar.close > 0).length >= MIN_GRANVILLE_BARS;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();
  const qLower = q.toLowerCase();
  const minScoreRaw = parseInt(searchParams.get("minScore") ?? "", 10);
  const minScore = Number.isFinite(minScoreRaw) ? Math.max(0, minScoreRaw) : 0;

  try {
    const startedAt = Date.now();
    const deadlineMs = startedAt + WORK_BUDGET_MS;
    const marketStatus = getMarketStatus();
    const taipeiNow = getTaipeiDateTime();
    const provisionalTradeDate = `${taipeiNow.year}/${String(taipeiNow.month).padStart(2, "0")}/${String(taipeiNow.day).padStart(2, "0")}`;
    const expectedSource = marketStatus === "open" ? "realtime" : "daily";

    const provisionalKey = buildCacheKey({
      tradeDate: provisionalTradeDate,
      dataSource: expectedSource,
      marketStatus,
      q: qLower,
      minScore,
    });

    const cached = granvilleResponseCache.get(provisionalKey);
    const forceRefresh = searchParams.has("_t");
    if (cached && cached.response.stocks.length === 0) {
      granvilleResponseCache.delete(provisionalKey);
    } else if (
      !forceRefresh &&
      cached &&
      cached.expiresAt > Date.now()
    ) {
      return NextResponse.json(cloneResponse(cached.response), {
        headers: {
          "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    const latest = await loadQuoteUniverse({ marketStatus, deadlineMs });
    const tradeDate = formatTradeDateISO(latest.tradeDate);
    const tradeDateISO = toTradeDateISO(tradeDate);
    const dataSource = latest.dataSource;
    const validStocks = latest.stocks.filter((s) => s.price > 0 && s.volume > 0);

    const cacheKey = buildCacheKey({
      tradeDate,
      dataSource,
      marketStatus,
      q: qLower,
      minScore,
    });

    let candidates: StockInfo[];
    if (q) {
      candidates = rankQueryMatches(validStocks, q).slice(0, QUERY_MATCH_LIMIT);
      if (candidates.length === 0) {
        return NextResponse.json(
          { error: `找不到符合「${q}」的股票` },
          { status: 404 },
        );
      }
    } else {
      candidates = buildScanCandidates(validStocks);
    }

    const analyzed = (
      await mapLimitWithDeadline(
        candidates,
        q ? Math.min(4, candidates.length) : HISTORY_CONCURRENCY,
        deadlineMs,
        async (stock): Promise<GranvilleStock | null> => {
          const history = await fetchStockHistory(
            stock.code,
            stock.market,
            HISTORY_MONTHS,
            {
              preferFastSource: true,
              allowFullRetry: Boolean(q),
              minBarsToCache: MIN_GRANVILLE_BARS,
            },
          );
          if (!hasEnoughHistory(history)) return null;

          return analyzeGranvilleStock({
            code: stock.code,
            name: stock.name,
            market: stock.market,
            price: stock.price,
            open: stock.open,
            high: stock.high,
            low: stock.low,
            yesterdayClose: stock.yesterdayClose,
            change: stock.change,
            changePercent: stock.changePercent,
            volume: stock.volume,
            updateTime: stock.updateTime,
            history,
            tradeDateISO,
          });
        },
      )
    ).filter((s): s is GranvilleStock => s !== null);

    if (
      dataSource === "daily" &&
      analyzed.length > 0 &&
      Date.now() < deadlineMs - 3_000
    ) {
      const quotes = await fetchStockQuotes(
        analyzed.map((s) => ({ code: s.code, market: s.market })),
      );
      const quoteMap = new Map(quotes.map((s) => [s.code, s]));
      for (const stock of analyzed) {
        const quote = quoteMap.get(stock.code);
        if (!quote || quote.price <= 0) continue;
        stock.price = quote.price;
        stock.open = quote.open || stock.open;
        stock.high = quote.high || stock.high;
        stock.low = quote.low || stock.low;
        stock.volume = quote.volume || stock.volume;
        stock.change = quote.change;
        stock.changePercent = quote.changePercent;
        stock.updateTime = quote.updateTime;
      }
    }

    const stocks = analyzed
      .filter((s) => s.score >= minScore)
      .sort(sortGranville);

    const response: GranvilleResponse = {
      updatedAt: new Date().toISOString(),
      tradeDate,
      dataSource,
      marketStatus,
      totalScanned: validStocks.length,
      historyAnalyzed: analyzed.length,
      buy2Count: stocks.filter((s) => s.focusBuy === "buy2" || s.focusBuy === "both").length,
      buy3Count: stocks.filter((s) => s.focusBuy === "buy3" || s.focusBuy === "both").length,
      stocks,
    };

    if (response.stocks.length > 0) {
      const entry = {
        expiresAt:
          Date.now() +
          (marketStatus === "open"
            ? OPEN_MARKET_CACHE_MS
            : Math.max(1, nextMarketOpenTimestamp() - Date.now())),
        response: cloneResponse(response),
      };
      granvilleResponseCache.set(cacheKey, entry);
      granvilleResponseCache.set(provisionalKey, entry);
    }

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "資料取得失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
