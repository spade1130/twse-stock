import { NextRequest, NextResponse } from "next/server";
import { analyzeMainForce } from "@/lib/analyzer";
import { analyzePotentialStock } from "@/lib/potential-analyzer";
import { buildStockAdvice } from "@/lib/stock-advisor";
import { fetchLatestMargins } from "@/lib/margin-data";
import { fetchStockHistory, type DailyBar } from "@/lib/stock-history";
import { fetchTdccChipMetricsForCodesWithComparison } from "@/lib/tdcc-data";
import {
  fetchDailyQuotes,
  fetchStockQuotes,
  getInstitutionalData,
  getMarketStatus,
  getStockList,
  getYesterdayVolumes,
} from "@/lib/twse";
import type {
  Market,
  PotentialStock,
  StockAnalyzeResponse,
  StockCandidate,
  StockInfo,
} from "@/types/stock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HISTORY_MONTHS = 6;
const MIN_HISTORY_BARS = 80;
const MIN_HISTORY_CLOSES = 61;
const MIN_HISTORY_SPAN_DAYS = 75;

function hasStablePotentialHistory(
  history: DailyBar[],
  tradeDateISO: string,
): boolean {
  if (history.length < MIN_HISTORY_BARS) return false;

  const validCloses = history.filter((bar) => bar.close > 0).length;
  if (validCloses < MIN_HISTORY_CLOSES) return false;

  const oldest = history[0]?.date;
  if (!oldest) return false;

  const cutoff = new Date(tradeDateISO);
  cutoff.setDate(cutoff.getDate() - MIN_HISTORY_SPAN_DAYS);
  const cutoffISO = cutoff.toISOString().slice(0, 10);

  return oldest <= cutoffISO;
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

function rankCandidates(
  stocks: StockInfo[],
  q: string,
): StockInfo[] {
  const query = q.trim().toLowerCase();
  const exactCode = stocks.filter((s) => s.code.toLowerCase() === query);
  if (exactCode.length > 0) return exactCode;

  const exactName = stocks.filter((s) => s.name.toLowerCase() === query);
  if (exactName.length > 0) return exactName;

  const codePrefix = stocks.filter((s) =>
    s.code.toLowerCase().startsWith(query),
  );
  if (codePrefix.length > 0) {
    return codePrefix.sort((a, b) => a.code.localeCompare(b.code));
  }

  const nameIncludes = stocks.filter((s) =>
    s.name.toLowerCase().includes(query),
  );
  return nameIncludes.sort((a, b) => {
    const aStarts = a.name.toLowerCase().startsWith(query) ? 0 : 1;
    const bStarts = b.name.toLowerCase().startsWith(query) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.code.localeCompare(b.code);
  });
}

async function resolveCandidates(q: string): Promise<StockCandidate[]> {
  const query = q.trim();
  const isCodeLike = /^\d{3,6}$/.test(query);

  if (isCodeLike) {
    const list = await getStockList();
    const matched = list
      .filter(
        (s) => s.code === query || s.code.startsWith(query),
      )
      .slice(0, 12);

    if (matched.length === 0) return [];

    const quotes = await fetchStockQuotes(matched);
    if (quotes.length > 0) {
      return rankCandidates(quotes, query).map((s) => ({
        code: s.code,
        name: s.name,
        market: s.market,
      }));
    }

    return matched.map((s) => ({
      code: s.code,
      name: s.code,
      market: s.market,
    }));
  }

  const daily = await fetchDailyQuotes();
  return rankCandidates(daily, query)
    .slice(0, 12)
    .map((s) => ({
      code: s.code,
      name: s.name,
      market: s.market,
    }));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) {
    return NextResponse.json(
      { error: "請輸入股票代號或名稱" },
      { status: 400 },
    );
  }

  try {
    const candidates = await resolveCandidates(q);

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: `找不到符合「${q}」的股票` },
        { status: 404 },
      );
    }

    // Ambiguous name/code: return candidates for the UI to pick.
    const exact =
      candidates.find((c) => c.code === q) ??
      candidates.find((c) => c.name === q);
    const target =
      exact ?? (candidates.length === 1 ? candidates[0] : null);

    if (!target) {
      return NextResponse.json(
        {
          error: "找到多檔符合股票，請改輸入完整代號或點選下方選項",
          candidates,
        },
        { status: 409 },
      );
    }

    const [quotes, volumes, institutional, margins, tdcc] =
      await Promise.all([
        fetchStockQuotes([{ code: target.code, market: target.market }]),
        getYesterdayVolumes(),
        getInstitutionalData(),
        fetchLatestMargins(),
        fetchTdccChipMetricsForCodesWithComparison(
          new Set([target.code]),
          20,
        ),
      ]);

    let stock = quotes[0];
    if (!stock || stock.price <= 0) {
      // Fallback: rebuild minimal quote from daily if MIS fails.
      const daily = await fetchDailyQuotes();
      const fallback = daily.find((s) => s.code === target.code);
      if (!fallback) {
        return NextResponse.json(
          { error: "無法取得該股票即時報價" },
          { status: 502 },
        );
      }
      stock = fallback;
    }

    const mainForce = analyzeMainForce(
      stock,
      volumes.get(stock.code) ?? 0,
      institutional.get(stock.code),
    );

    const history = await fetchStockHistory(
      stock.code,
      stock.market,
      HISTORY_MONTHS,
    );
    const tradeDateISO = new Date().toISOString().slice(0, 10);

    let potential: PotentialStock | null = null;
    let potentialNote: string | undefined;

    if (!hasStablePotentialHistory(history, tradeDateISO)) {
      potentialNote =
        `歷史 K 線不足或不完整（${history.length} 根，需至少 ${MIN_HISTORY_BARS} 根且覆蓋 ${MIN_HISTORY_SPAN_DAYS} 天），潛力評估略過`;
    } else {
      const gain60dPct = calcGain60dPct(stock.price, history, tradeDateISO);

      potential = analyzePotentialStock({
        code: stock.code,
        market: stock.market as Market,
        name: stock.name,
        todays: {
          price: stock.price,
          open: stock.open,
          high: stock.high,
          volume: stock.volume,
        },
        history,
        gain60dPct,
        chip: tdcc.latest.get(stock.code) ?? null,
        chipPrev: tdcc.previous.get(stock.code) ?? null,
        marginCurrent: margins.current.get(stock.code) ?? 0,
        marginPrevious: margins.previous.get(stock.code) ?? 0,
      });

      // Overlay live quote fields onto potential result for display.
      potential.price = stock.price;
      potential.open = stock.open;
      potential.high = stock.high;
      potential.low = stock.low;
      potential.yesterdayClose = stock.yesterdayClose;
      potential.limitUp = stock.limitUp;
      potential.limitDown = stock.limitDown;
      potential.change = stock.change;
      potential.changePercent = stock.changePercent;
      potential.volume = stock.volume;
      potential.updateTime = stock.updateTime;
    }

    const advice = buildStockAdvice(mainForce, potential);

    const today = new Date();
    const tradeDate = `${today.getFullYear()}/${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}`;

    const response: StockAnalyzeResponse = {
      updatedAt: new Date().toISOString(),
      tradeDate,
      dataSource:
        stock.buyVolumes.length > 0 || stock.sellVolumes.length > 0
          ? "realtime"
          : "daily",
      marketStatus: getMarketStatus(),
      stock: mainForce,
      potential,
      potentialNote,
      advice,
      candidates:
        candidates.length > 1
          ? candidates.filter((c) => c.code !== target.code).slice(0, 8)
          : undefined,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store, no-cache, max-age=0, must-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "分析失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
