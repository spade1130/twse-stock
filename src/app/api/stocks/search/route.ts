import { NextRequest, NextResponse } from "next/server";
import { analyzeMainForce } from "@/lib/analyzer";
import {
  fetchStockQuotes,
  getInstitutionalData,
  getStockList,
  getYesterdayVolumes,
} from "@/lib/twse";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const q = searchParams.get("q")?.trim() ?? "";

  if (!q) {
    return NextResponse.json({ error: "請輸入股票代號或名稱" }, { status: 400 });
  }

  try {
    const list = await getStockList();
    const matched = list.filter(
      (s) => s.code.includes(q) || q.includes(s.code),
    );

    if (matched.length === 0) {
      const allList = await getStockList();
      const byCode = allList.filter((s) => s.code === q);
      if (byCode.length === 0) {
        return NextResponse.json({ stocks: [], message: "找不到符合的股票" });
      }
      matched.push(...byCode);
    }

    const limited = matched.slice(0, 20);
    const [quotes, volumes, institutional] = await Promise.all([
      fetchStockQuotes(limited),
      getYesterdayVolumes(),
      getInstitutionalData(),
    ]);

    const stocks = quotes.map((stock) =>
      analyzeMainForce(
        stock,
        volumes.get(stock.code) ?? 0,
        institutional.get(stock.code),
      ),
    );

    const nameMatched = stocks.filter((s) =>
      s.name.toLowerCase().includes(q.toLowerCase()),
    );

    return NextResponse.json({
      stocks: nameMatched.length > 0 ? nameMatched : stocks,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "搜尋失敗";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
