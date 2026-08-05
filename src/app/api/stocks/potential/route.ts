import { NextRequest, NextResponse } from "next/server";
import {
  fetchDailyQuotes,
  fetchLatestQuotes,
  fetchStockQuotes,
  getMarketStatus,
} from "@/lib/twse";
import { fetchStockHistory } from "@/lib/stock-history";
import {
  calcMarginChangePct,
  fetchLatestMargins,
  marginPassesCondition,
} from "@/lib/margin-data";
import { fetchTdccChipMetricsForCodesWithComparison } from "@/lib/tdcc-data";
import { analyzePotentialStock } from "@/lib/potential-analyzer";
import type { PotentialResponse, PotentialStock, StockInfo } from "@/types/stock";
import type { DailyBar } from "@/lib/stock-history";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Keep the work small enough for Vercel serverless timeouts (~60s).
// Prefer Yahoo fast history; fall back to TWSE only when needed.
const MAX_HISTORY_CANDIDATES = 24;
const HISTORY_MONTHS = 4;
const HISTORY_CONCURRENCY = 4;
const RECOVERY_CANDIDATES = 8;
const MIN_HISTORY_BARS = 50;
const MIN_HISTORY_CLOSES = 50;
const MIN_HISTORY_SPAN_DAYS = 55;
const SOFT_MIN_HISTORY_BARS = 40;
const MARGIN_CANDIDATE_POOL = 50;
const CHIP_CANDIDATE_POOL = 40;
const VOLUME_FALLBACK_POOL = 24;
const TDCC_PREFILTER_POOL = 120;
const DEFAULT_MIN_SCORE = 0;
const OPEN_MARKET_CACHE_MS = 2 * 60 * 1000;
/** Leave headroom under Vercel maxDuration=60. */
const WORK_BUDGET_MS = 48_000;

interface PotentialCacheEntry {
  expiresAt: number;
  response: PotentialResponse;
}

const potentialResponseCache = new Map<string, PotentialCacheEntry>();

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

function formatTradeDateISO(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`;
  }
  return raw;
}

function toTradeDateISO(raw: string): string {
  const formatted = formatTradeDateISO(raw);
  return formatted.replace(/\//g, "-");
}

function hasStablePotentialHistory(
  history: DailyBar[],
  tradeDateISO: string,
  minBars = MIN_HISTORY_BARS,
  minSpanDays = MIN_HISTORY_SPAN_DAYS,
): boolean {
  if (history.length < minBars) return false;

  const validCloses = history.filter((bar) => bar.close > 0).length;
  if (validCloses < Math.min(minBars, MIN_HISTORY_CLOSES)) return false;

  const oldest = history[0]?.date;
  if (!oldest) return false;

  // Parse as Taipei calendar day to avoid UTC off-by-one on cutoff.
  const [y, m, d] = tradeDateISO.split("-").map((v) => parseInt(v, 10));
  if (!y || !m || !d) return history.length >= minBars;
  const cutoff = new Date(Date.UTC(y, m - 1, d));
  cutoff.setUTCDate(cutoff.getUTCDate() - minSpanDays);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  return oldest <= cutoffISO;
}

function buildPotentialCacheKey(params: {
  tradeDate: string;
  dataSource: string;
  marketStatus: "open" | "closed" | "unknown";
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

function clonePotentialResponse(response: PotentialResponse): PotentialResponse {
  return {
    ...response,
    stocks: response.stocks.map((stock) => ({
      ...stock,
      conditions: stock.conditions.map((condition) => ({ ...condition })),
      signals: [...stock.signals],
    })),
  };
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

function calcGain60dPct(
  currentPrice: number,
  history: DailyBar[],
  fallbackTodayISO: string,
): number {
  if (currentPrice <= 0 || history.length < 2) return 0;
  const d = new Date(fallbackTodayISO);
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

function scorePreconditions(
  stock: StockInfo,
  tdcc: Awaited<ReturnType<typeof fetchTdccChipMetricsForCodesWithComparison>>,
  margins: Awaited<ReturnType<typeof fetchLatestMargins>>,
): number {
  let score = 0;

  const chip = tdcc.latest.get(stock.code);
  const chipPrev = tdcc.previous.get(stock.code);
  if (chip && chipPrev && chip.chipConcentration > chipPrev.chipConcentration) {
    score += 2;
  }
  if (chip && chipPrev && chip.majorHolderPct - chipPrev.majorHolderPct >= 3) {
    score += 3;
  } else if (
    chip &&
    chipPrev &&
    chip.majorHolderPct - chipPrev.majorHolderPct > 0
  ) {
    score += 1;
  }

  const marginCurrent = margins.current.get(stock.code) ?? 0;
  const marginPrevious = margins.previous.get(stock.code) ?? 0;
  if (marginPassesCondition(calcMarginChangePct(marginCurrent, marginPrevious))) {
    score += 4;
  }

  return score;
}

function buildCandidates(
  validStocks: StockInfo[],
  tdcc: Awaited<ReturnType<typeof fetchTdccChipMetricsForCodesWithComparison>>,
  margins: Awaited<ReturnType<typeof fetchLatestMargins>>,
): StockInfo[] {
  const candidateMap = new Map<string, StockInfo>();

  // Chip concentration up and/or major holder increasing.
  const chipQualified = validStocks
    .filter((stock) => {
      const chip = tdcc.latest.get(stock.code);
      const chipPrev = tdcc.previous.get(stock.code);
      if (!chip || !chipPrev) return false;
      const chipUp = chip.chipConcentration > chipPrev.chipConcentration;
      const majorUp = chip.majorHolderPct > chipPrev.majorHolderPct;
      return chipUp || majorUp;
    })
    .sort((a, b) => {
      const aChip = tdcc.latest.get(a.code);
      const aPrev = tdcc.previous.get(a.code);
      const bChip = tdcc.latest.get(b.code);
      const bPrev = tdcc.previous.get(b.code);
      const aDelta =
        (aChip?.majorHolderPct ?? 0) - (aPrev?.majorHolderPct ?? 0);
      const bDelta =
        (bChip?.majorHolderPct ?? 0) - (bPrev?.majorHolderPct ?? 0);
      if (bDelta !== aDelta) return bDelta - aDelta;
      return b.volume - a.volume;
    })
    .slice(0, CHIP_CANDIDATE_POOL);

  for (const stock of chipQualified) {
    candidateMap.set(stock.code, stock);
  }

  const marginStocks = validStocks
    .filter((stock) => {
      const marginCurrent = margins.current.get(stock.code) ?? 0;
      const marginPrevious = margins.previous.get(stock.code) ?? 0;
      return marginPassesCondition(
        calcMarginChangePct(marginCurrent, marginPrevious),
      );
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MARGIN_CANDIDATE_POOL);

  for (const stock of marginStocks) {
    candidateMap.set(stock.code, stock);
  }

  // Volume fallback so the pool stays large enough on quiet chip/margin days.
  if (candidateMap.size < MAX_HISTORY_CANDIDATES) {
    const byVolume = [...validStocks].sort((a, b) => b.volume - a.volume);
    for (const stock of byVolume.slice(0, VOLUME_FALLBACK_POOL)) {
      candidateMap.set(stock.code, stock);
      if (candidateMap.size >= MAX_HISTORY_CANDIDATES) break;
    }
  }

  return Array.from(candidateMap.values())
    .map((stock) => ({
      stock,
      score: scorePreconditions(stock, tdcc, margins),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.stock.volume - a.stock.volume;
    })
    .slice(0, MAX_HISTORY_CANDIDATES)
    .map(({ stock }) => stock);
}

/** Shrink universe before expensive TDCC CSV parsing. */
function buildTdccPrefilterPool(
  validStocks: StockInfo[],
  margins: Awaited<ReturnType<typeof fetchLatestMargins>>,
): StockInfo[] {
  const pool = new Map<string, StockInfo>();

  const marginStocks = validStocks
    .filter((stock) => {
      const marginCurrent = margins.current.get(stock.code) ?? 0;
      const marginPrevious = margins.previous.get(stock.code) ?? 0;
      return marginPassesCondition(
        calcMarginChangePct(marginCurrent, marginPrevious),
      );
    })
    .sort((a, b) => b.volume - a.volume)
    .slice(0, MARGIN_CANDIDATE_POOL);

  for (const stock of marginStocks) {
    pool.set(stock.code, stock);
  }

  const byVolume = [...validStocks].sort((a, b) => b.volume - a.volume);
  for (const stock of byVolume) {
    pool.set(stock.code, stock);
    if (pool.size >= TDCC_PREFILTER_POOL) break;
  }

  return Array.from(pool.values());
}

function sortByMatchScore(a: PotentialStock, b: PotentialStock): number {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  const aPassed = a.conditions.filter((c) => c.passed).length;
  const bPassed = b.conditions.filter((c) => c.passed).length;
  return bPassed - aPassed;
}

async function analyzeCandidate(params: {
  stock: StockInfo;
  tradeDateISO: string;
  tdcc: Awaited<ReturnType<typeof fetchTdccChipMetricsForCodesWithComparison>>;
  margins: Awaited<ReturnType<typeof fetchLatestMargins>>;
  q: string;
  softHistory?: boolean;
  forceRefresh?: boolean;
  allowFullRetry?: boolean;
}): Promise<PotentialStock | null> {
  const {
    stock,
    tradeDateISO,
    tdcc,
    margins,
    q,
    softHistory = false,
    forceRefresh = false,
    allowFullRetry = false,
  } = params;

  const minBars = softHistory ? SOFT_MIN_HISTORY_BARS : MIN_HISTORY_BARS;
  const minSpan = softHistory ? 45 : MIN_HISTORY_SPAN_DAYS;

  const history = await fetchStockHistory(
    stock.code,
    stock.market,
    HISTORY_MONTHS,
    {
      forceRefresh,
      allowFullRetry,
      preferFastSource: true,
      minBarsToCache: minBars,
    },
  );

  if (!hasStablePotentialHistory(history, tradeDateISO, minBars, minSpan)) {
    return null;
  }

  const gain60dPct = calcGain60dPct(stock.price, history, tradeDateISO);
  const chip = tdcc.latest.get(stock.code) ?? null;
  const chipPrev = tdcc.previous.get(stock.code) ?? null;
  const marginCurrent = margins.current.get(stock.code) ?? 0;
  const marginPrevious = margins.previous.get(stock.code) ?? 0;

  const result = analyzePotentialStock({
    code: stock.code,
    market: stock.market,
    name: stock.name,
    todays: {
      price: stock.price,
      open: stock.open,
      high: stock.high,
      volume: stock.volume,
    },
    history,
    gain60dPct,
    chip,
    chipPrev,
    marginCurrent,
    marginPrevious,
  });

  if (
    q &&
    !(
      stock.code.toLowerCase().includes(q) ||
      stock.name.toLowerCase().includes(q) ||
      result.signals.some((s) => s.toLowerCase().includes(q))
    )
  ) {
    return null;
  }

  return result;
}

function findSameDayFallback(
  tradeDate: string,
  q: string,
  minScore: number,
): PotentialResponse | null {
  for (const entry of potentialResponseCache.values()) {
    if (
      entry.response.tradeDate === tradeDate &&
      entry.response.stocks.length > 0
    ) {
      const filtered = entry.response.stocks
        .filter((s) => s.matchScore >= minScore)
        .filter((s) => {
          if (!q) return true;
          return (
            s.code.toLowerCase().includes(q) ||
            s.name.toLowerCase().includes(q) ||
            s.signals.some((sig) => sig.toLowerCase().includes(q))
          );
        });
      if (filtered.length === 0) continue;
      return {
        ...clonePotentialResponse(entry.response),
        stocks: filtered,
        updatedAt: new Date().toISOString(),
      };
    }
  }
  return null;
}

async function mapLimitWithDeadline<T, R>(
  items: T[],
  concurrency: number,
  deadlineMs: number,
  worker: (item: T, idx: number) => Promise<R | null>,
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
        results[current] = await worker(items[current], current);
      }
    });

  await Promise.all(runners);
  return results;
}

async function loadQuoteUniverse(params: {
  marketStatus: "open" | "closed" | "unknown";
  deadlineMs: number;
}): Promise<{
  stocks: StockInfo[];
  tradeDate: string;
  dataSource: "realtime" | "daily";
}> {
  // Match limit-up: use MIS realtime while the market is open; otherwise
  // daily close is faster and sufficient after hours / weekends.
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

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const minScoreRaw = parseInt(searchParams.get("minScore") ?? "", 10);
  const minScore = Number.isFinite(minScoreRaw)
    ? Math.max(0, minScoreRaw)
    : DEFAULT_MIN_SCORE;

  try {
    const startedAt = Date.now();
    const deadlineMs = startedAt + WORK_BUDGET_MS;
    const marketStatus = getMarketStatus();
    const taipeiNow = getTaipeiDateTime();
    const provisionalTradeDate = `${taipeiNow.year}/${String(taipeiNow.month).padStart(2, "0")}/${String(taipeiNow.day).padStart(2, "0")}`;
    const expectedSource = marketStatus === "open" ? "realtime" : "daily";

    const provisionalKey = buildPotentialCacheKey({
      tradeDate: provisionalTradeDate,
      dataSource: expectedSource,
      marketStatus,
      q,
      minScore,
    });

    const cached = potentialResponseCache.get(provisionalKey);
    if (cached && cached.response.stocks.length === 0) {
      potentialResponseCache.delete(provisionalKey);
    } else if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json(clonePotentialResponse(cached.response), {
        headers: {
          "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      });
    }

    const [latest, margins] = await Promise.all([
      loadQuoteUniverse({ marketStatus, deadlineMs }),
      fetchLatestMargins(),
    ]);

    const tradeDate = formatTradeDateISO(latest.tradeDate);
    const tradeDateISO = toTradeDateISO(tradeDate);
    const dataSource = latest.dataSource;

    const cacheKey = buildPotentialCacheKey({
      tradeDate,
      dataSource,
      marketStatus,
      q,
      minScore,
    });

    const validStocks = latest.stocks.filter(
      (s) => s.price > 0 && s.volume > 0,
    );

    // Only parse TDCC for a pre-filtered pool, not the entire market.
    const prefilterPool = buildTdccPrefilterPool(validStocks, margins);
    const tdccCodes = new Set(prefilterPool.map((s) => s.code));

    if (q) {
      for (const stock of validStocks) {
        if (
          stock.code.toLowerCase().includes(q) ||
          stock.name.toLowerCase().includes(q)
        ) {
          tdccCodes.add(stock.code);
          if (!prefilterPool.some((s) => s.code === stock.code)) {
            prefilterPool.push(stock);
          }
        }
      }
    }

    const tdcc = await fetchTdccChipMetricsForCodesWithComparison(tdccCodes, 20);

    let candidates = buildCandidates(prefilterPool, tdcc, margins);

    if (q) {
      const existing = new Set(candidates.map((s) => s.code));
      for (const stock of validStocks) {
        if (existing.has(stock.code)) continue;
        if (
          stock.code.toLowerCase().includes(q) ||
          stock.name.toLowerCase().includes(q)
        ) {
          candidates.push(stock);
        }
      }
    }

    let stocks = (
      await mapLimitWithDeadline(
        candidates,
        HISTORY_CONCURRENCY,
        deadlineMs,
        async (stock): Promise<PotentialStock | null> =>
          analyzeCandidate({
            stock,
            tradeDateISO,
            tdcc,
            margins,
            q,
            allowFullRetry: false,
          }),
      )
    ).filter((s): s is PotentialStock => s !== null);

    // Recovery wave only if first pass emptied out AND we still have budget.
    const remainingMs = deadlineMs - Date.now();
    if (stocks.length === 0 && candidates.length > 0 && remainingMs > 12_000) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const recoveryPool = [...candidates]
        .sort((a, b) => b.volume - a.volume)
        .slice(0, RECOVERY_CANDIDATES);

      stocks = (
        await mapLimitWithDeadline(
          recoveryPool,
          2,
          deadlineMs,
          async (stock): Promise<PotentialStock | null> =>
            analyzeCandidate({
              stock,
              tradeDateISO,
              tdcc,
              margins,
              q,
              softHistory: true,
              forceRefresh: true,
              allowFullRetry: true,
            }),
        )
      ).filter((s): s is PotentialStock => s !== null);
    }

    let results = stocks
      .filter((s) => s.matchScore >= minScore)
      .sort(sortByMatchScore);

    // Same-day fallback: if this run still failed, reuse the last good snapshot.
    if (results.length === 0) {
      const fallback = findSameDayFallback(tradeDate, q, minScore);
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

    const fullCount = results.filter((s) =>
      s.conditions.every((c) => c.passed),
    ).length;
    const matchMode = fullCount > 0 ? "full" : "partial";

    // When the universe came from daily close, refresh matched rows with MIS.
    if (
      dataSource === "daily" &&
      results.length > 0 &&
      Date.now() < deadlineMs - 3_000
    ) {
      const latestQuotes = await fetchStockQuotes(
        results.map((s) => ({ code: s.code, market: s.market })),
      );
      const quoteMap = new Map(latestQuotes.map((s) => [s.code, s]));
      for (const stock of results) {
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

    const response: PotentialResponse = {
      updatedAt: new Date().toISOString(),
      tradeDate,
      dataSource,
      marketStatus,
      totalScanned: validStocks.length,
      marginFiltered: candidates.length,
      historyAnalyzed: stocks.length,
      matchMode,
      stocks: results,
    };

    if (response.stocks.length > 0) {
      const entry = {
        expiresAt:
          Date.now() +
          (marketStatus === "open"
            ? OPEN_MARKET_CACHE_MS
            : Math.max(1, nextMarketOpenTimestamp() - Date.now())),
        response: clonePotentialResponse(response),
      };
      potentialResponseCache.set(cacheKey, entry);
      // Also index under provisional key so the next click hits cache immediately.
      potentialResponseCache.set(provisionalKey, entry);
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
