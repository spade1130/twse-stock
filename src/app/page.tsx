"use client";

import { useCallback, useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import { StatsCards } from "@/components/StatsCards";
import { StockTable } from "@/components/StockTable";
import { PotentialSearchBar } from "@/components/PotentialSearchBar";
import { PotentialStatsCards } from "@/components/PotentialStatsCards";
import { PotentialTable } from "@/components/PotentialTable";
import type { LimitUpResponse, PotentialResponse } from "@/types/stock";

export default function Home() {
  const [tab, setTab] = useState<"limitUp" | "potential">("limitUp");

  const [limitData, setLimitData] = useState<LimitUpResponse | null>(null);
  const [potentialData, setPotentialData] = useState<PotentialResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [limitHasSearched, setLimitHasSearched] = useState(false);
  const [potentialHasSearched, setPotentialHasSearched] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        minScore: String(minScore),
      });
      if (search) params.set("q", search);

      const res = await fetch(`/api/stocks/limit-up?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "資料載入失敗");
      }
      const json: LimitUpResponse = await res.json();
      setLimitData(json);
      setLimitHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, [search, minScore]);

  const fetchPotential = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      // Bust any intermediate/browser caches so each screening gets fresh quotes.
      params.set("_t", String(Date.now()));

      const res = await fetch(`/api/stocks/potential?${params.toString()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "資料載入失敗");
      }

      const json: PotentialResponse = await res.json();
      setPotentialData(json);
      setPotentialHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, [search]);

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-red-950/20 via-zinc-950 to-zinc-950" />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600">
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-zinc-100">台股股票篩選</h1>
              <p className="text-sm text-zinc-500">切換頁籤查看漲停股與優質潛力股</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTab("limitUp")}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                tab === "limitUp"
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              漲停股篩選
            </button>
            <button
              type="button"
              onClick={() => setTab("potential")}
              className={`rounded-xl border px-4 py-2 text-sm transition ${
                tab === "potential"
                  ? "border-red-500/40 bg-red-500/10 text-red-300"
                  : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-900"
              }`}
            >
              優質潛力股
            </button>
          </div>
        </header>

        <div className="mb-6 space-y-4">
          {tab === "limitUp" && limitHasSearched && limitData && (
            <StatsCards
              totalScanned={limitData.totalScanned}
              limitUpCount={limitData.limitUpCount}
              filteredCount={limitData.stocks.length}
              marketStatus={limitData.marketStatus}
              updatedAt={limitData.updatedAt}
              tradeDate={limitData.tradeDate}
              dataSource={limitData.dataSource}
              loading={loading}
            />
          )}

          {tab === "limitUp" && (
            <SearchBar
              value={search}
              onChange={setSearch}
              onSearch={fetchData}
              loading={loading}
              minScore={minScore}
              onMinScoreChange={setMinScore}
            />
          )}

          {tab === "potential" && potentialHasSearched && potentialData && (
            <PotentialStatsCards
              totalScanned={potentialData.totalScanned}
              matchedCount={potentialData.stocks.length}
              marketStatus={potentialData.marketStatus}
              updatedAt={potentialData.updatedAt}
              tradeDate={potentialData.tradeDate}
              dataSource={potentialData.dataSource}
              loading={loading}
            />
          )}

          {tab === "potential" && (
            <PotentialSearchBar
              value={search}
              onChange={setSearch}
              onSearch={fetchPotential}
              loading={loading}
            />
          )}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {tab === "limitUp" && (
          <StockTable
            stocks={limitData?.stocks ?? []}
            loading={loading}
            hasSearched={limitHasSearched}
          />
        )}

        {tab === "potential" && (
          <PotentialTable
            stocks={potentialData?.stocks ?? []}
            loading={loading}
            hasSearched={potentialHasSearched}
            matchMode={potentialData?.matchMode}
          />
        )}

        <footer className="mt-8 text-center text-xs text-zinc-600">
          <p>
            行情來自證交所 MIS 即時報價（手動篩選時更新）·
            主力分數綜合評估法人、量能與五檔委託
          </p>
          <p className="mt-1">
            優質潛力股使用歷史 K 線、融資餘額與集保籌碼（僅供參考，不構成投資建議）
          </p>
        </footer>
      </div>
    </main>
  );
}
