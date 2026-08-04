import { NextRequest, NextResponse } from "next/server";
import {
  analyzeMainForce,
  filterLimitUpStocks,
  searchStocks,
} from "@/lib/analyzer";
import {
  fetchDailyQuotes,
  fetchLatestQuotes,
  getInstitutionalData,
  getMarketStatus,
  getYesterdayVolumes,
} from "@/lib/twse";
import type { LimitUpResponse, StockInfo } from "@/types/stock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OPEN_MARKET_CACHE_MS = 45 * 1000;
const WORK_BUDGET_MS = 48_000;

interface LimitUpCacheEntry {
  expiresAt: number;
  response: LimitUpResponse;
}

const limitUpResponseCache = new Map<string, LimitUpCacheEntry>();

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

function formatTradeDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`;
  }
  return raw;
}

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

function cloneLimitUpResponse(response: LimitUpResponse): LimitUpResponse {
  return {
    ...response,
    stocks: response.stocks.map((stock) => ({
      ...stock,
      buyVolumes: [...stock.buyVolumes],
      sellVolumes: [...stock.sellVolumes],
      buyPrices: [...stock.buyPrices],
      sellPrices: [...stock.sellPrices],
      signals: [...stock.signals],
    })),
  };
}

function findSameDayFallback(
  tradeDate: string,
  q: string,
  minScore: number,
): LimitUpResponse | null {
  for (const entry of limitUpResponseCache.values()) {
    if (
      entry.response.tradeDate === tradeDate &&
      entry.response.stocks.length > 0
    ) {
      let stocks = entry.response.stocks.filter(
        (s) => minScore <= 0 || s.mainForceScore >= minScore,
      );
      if (q) stocks = searchStocks(stocks, q);
      if (stocks.length === 0) continue;
      return {
        ...cloneLimitUpResponse(entry.response),
        stocks,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return null;
}

async function loadQuoteUniverse(params: {
  marketStatus: "open" | "closed" | "unknown";
  deadlineMs: number;
}): Promise<{
  stocks: StockInfo[];
  tradeDate: string;
  dataSource: "realtime" | "daily";
}> {
  // After hours / weekends: daily close is enough and much faster than
  // scanning the entire MIS universe in small realtime batches.
  if (params.marketStatus !== "open") {
    const daily = await fetchDailyQuotes();
    const taipei = getTaipeiDateTime();
    return {
      stocks: daily,
      tradeDate: `${taipei.year}${String(taipei.month).padStart(2, "0")}${String(taipei.day).padStart(2, "0")}`,
      dataSource: "daily",
    };
  }

  return fetchLatestQuotes({
    concurrency: 6,
    batchSize: 120,
    deadlineMs: params.deadlineMs,
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = (searchParams.get("q") ?? "").trim();
  const minScoreRaw = parseInt(searchParams.get("minScore") ?? "0", 10);
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
      q: query.toLowerCase(),
      minScore,
    });

    const cached = limitUpResponseCache.get(provisionalKey);
    if (cached && cached.response.stocks.length === 0) {
      limitUpResponseCache.delete(provisionalKey);
    } else if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(cloneLimitUpResponse(cached.response), {
        headers: {
          "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    const [latest, volumes, institutional] = await Promise.all([
      loadQuoteUniverse({ marketStatus, deadlineMs }),
      getYesterdayVolumes(),
      getInstitutionalData(),
    ]);

    const tradeDate = formatTradeDate(latest.tradeDate);
    const cacheKey = buildCacheKey({
      tradeDate,
      dataSource: latest.dataSource,
      marketStatus,
      q: query.toLowerCase(),
      minScore,
    });

    const analyzed = latest.stocks.map((stock) =>
      analyzeMainForce(
        stock,
        volumes.get(stock.code) ?? 0,
        institutional.get(stock.code),
      ),
    );

    const allLimitUp = analyzed.filter((s) => s.isLimitUp);
    let stocks = filterLimitUpStocks(analyzed, minScore);
    if (query) stocks = searchStocks(stocks, query);

    // If this run somehow emptied out, reuse last good same-day snapshot.
    if (stocks.length === 0 && allLimitUp.length === 0) {
      const fallback = findSameDayFallback(tradeDate, query, minScore);
      if (fallback) {
        return NextResponse.json(fallback, {
          headers: {
            "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
            Pragma: "no-cache",
            Expires: "0",
          },
        });
      }
    }

    const response: LimitUpResponse = {
      updatedAt: new Date().toISOString(),
      tradeDate,
      dataSource: latest.dataSource,
      marketStatus,
      totalScanned: analyzed.length,
      limitUpCount: allLimitUp.length,
      stocks,
    };

    if (response.stocks.length > 0 || response.limitUpCount > 0) {
      const entry = {
        expiresAt:
          Date.now() +
          (marketStatus === "open"
            ? OPEN_MARKET_CACHE_MS
            : Math.max(1, nextMarketOpenTimestamp() - Date.now())),
        response: cloneLimitUpResponse(response),
      };
      limitUpResponseCache.set(cacheKey, entry);
      // Also index under provisional key so the next click hits cache immediately.
      limitUpResponseCache.set(provisionalKey, entry);
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
