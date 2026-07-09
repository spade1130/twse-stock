import { NextRequest, NextResponse } from "next/server";
import {
  analyzeMainForce,
  filterLimitUpStocks,
  searchStocks,
} from "@/lib/analyzer";
import {
  fetchDailyQuotes,
  getInstitutionalData,
  getMarketStatus,
} from "@/lib/twse";
import type { LimitUpResponse } from "@/types/stock";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") ?? "";
  const minScore = parseInt(searchParams.get("minScore") ?? "0", 10);

  try {
    const [quotes, institutional] = await Promise.all([
      fetchDailyQuotes(),
      getInstitutionalData(),
    ]);

    const analyzed = quotes.map((stock) =>
      analyzeMainForce(stock, 0, institutional.get(stock.code)),
    );

    const allLimitUp = analyzed.filter((s) => s.isLimitUp);
    let stocks = filterLimitUpStocks(analyzed, minScore);
    if (query) stocks = searchStocks(stocks, query);

    const response: LimitUpResponse = {
      updatedAt: new Date().toISOString(),
      marketStatus: getMarketStatus(),
      totalScanned: analyzed.length,
      limitUpCount: allLimitUp.length,
      stocks,
    };

    return NextResponse.json(response);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "資料取得失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
