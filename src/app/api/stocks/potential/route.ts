import { NextRequest, NextResponse } from "next/server";
import {
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
export const maxDuration = 120;

const MAX_HISTORY_CANDIDATES = 120;
const MIN_HISTORY_BARS = 60;
const MARGIN_CANDIDATE_POOL = 100;
const CHIP_CANDIDATE_POOL = 80;
const VOLUME_FALLBACK_POOL = 40;
const DEFAULT_MIN_SCORE = 0;

function formatTradeDateISO(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`;
  }
  return raw;
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

async function mapLimit<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const runners = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (idx < items.length) {
        const current = idx++;
        results[current] = await worker(items[current], current);
      }
    });
  await Promise.all(runners);
  return results;
}

function sortByMatchScore(a: PotentialStock, b: PotentialStock): number {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
  const aPassed = a.conditions.filter((c) => c.passed).length;
  const bPassed = b.conditions.filter((c) => c.passed).length;
  return bPassed - aPassed;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const minScoreRaw = parseInt(searchParams.get("minScore") ?? "", 10);
  const minScore = Number.isFinite(minScoreRaw)
    ? Math.max(0, minScoreRaw)
    : DEFAULT_MIN_SCORE;

  try {
    const [latest, margins] = await Promise.all([
      fetchLatestQuotes(),
      fetchLatestMargins(),
    ]);

    const validStocks = latest.stocks.filter(
      (s) => s.price > 0 && s.volume > 0 && s.market === "tse",
    );
    const allCodes = new Set(validStocks.map((s) => s.code));

    const tdcc = await fetchTdccChipMetricsForCodesWithComparison(allCodes, 20);

    let candidates = buildCandidates(validStocks, tdcc, margins);

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

    // Re-fetch fresh quotes for candidates after the slow TDCC phase.
    const freshQuotes = await fetchStockQuotes(
      candidates.map((s) => ({ code: s.code, market: s.market })),
    );
    const freshByCode = new Map(freshQuotes.map((s) => [s.code, s]));
    candidates = candidates.map((s) => {
      const fresh = freshByCode.get(s.code);
      if (!fresh || fresh.price <= 0) return s;
      return {
        ...s,
        price: fresh.price,
        open: fresh.open || s.open,
        high: fresh.high || s.high,
        low: fresh.low || s.low,
        volume: fresh.volume || s.volume,
        change: fresh.change,
        changePercent: fresh.changePercent,
        updateTime: fresh.updateTime,
      };
    });

    const stocks = (
      await mapLimit(candidates, 8, async (stock): Promise<PotentialStock | null> => {
        const history = await fetchStockHistory(stock.code, stock.market, 4);
        if (history.length < MIN_HISTORY_BARS) return null;

        const todayISO =
          history[history.length - 1]?.date ??
          new Date().toISOString().slice(0, 10);

        const gain60dPct = calcGain60dPct(stock.price, history, todayISO);

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
      })
    ).filter((s): s is PotentialStock => s !== null);

    const results = stocks
      .filter((s) => s.matchScore >= minScore)
      .sort(sortByMatchScore);

    const fullCount = results.filter((s) =>
      s.conditions.every((c) => c.passed),
    ).length;
    const matchMode = fullCount > 0 ? "full" : "partial";

    if (results.length > 0) {
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
      tradeDate: formatTradeDateISO(latest.tradeDate),
      dataSource: latest.dataSource,
      marketStatus: getMarketStatus(),
      totalScanned: latest.stocks.length,
      marginFiltered: candidates.length,
      historyAnalyzed: stocks.length,
      matchMode,
      stocks: results,
    };

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
