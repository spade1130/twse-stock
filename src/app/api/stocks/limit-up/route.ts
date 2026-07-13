import { NextRequest, NextResponse } from "next/server";
import {
  analyzeMainForce,
  filterLimitUpStocks,
  searchStocks,
} from "@/lib/analyzer";
import {
  fetchLatestQuotes,
  getInstitutionalData,
  getMarketStatus,
  getYesterdayVolumes,
} from "@/lib/twse";
import type { LimitUpResponse } from "@/types/stock";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function formatTradeDate(raw: string): string {
  if (/^\d{8}$/.test(raw)) {
    return `${raw.slice(0, 4)}/${raw.slice(4, 6)}/${raw.slice(6, 8)}`;
  }
  return raw;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") ?? "";
  const minScore = parseInt(searchParams.get("minScore") ?? "0", 10);

  try {
    const [latest, volumes, institutional] = await Promise.all([
      fetchLatestQuotes(),
      getYesterdayVolumes(),
      getInstitutionalData(),
    ]);

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

    const response: LimitUpResponse = {
      updatedAt: new Date().toISOString(),
      tradeDate: formatTradeDate(latest.tradeDate),
      dataSource: latest.dataSource,
      marketStatus: getMarketStatus(),
      totalScanned: analyzed.length,
      limitUpCount: allLimitUp.length,
      stocks,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "資料取得失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
