"use client";

import { useCallback, useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import { StatsCards } from "@/components/StatsCards";
import { StockTable } from "@/components/StockTable";
import type { LimitUpResponse } from "@/types/stock";

export default function Home() {
  const [data, setData] = useState<LimitUpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [hasSearched, setHasSearched] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        minScore: String(minScore),
      });
      if (search) params.set("q", search);

      const res = await fetch(`/api/stocks/limit-up?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? "資料載入失敗");
      }
      const json: LimitUpResponse = await res.json();
      setData(json);
      setHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, [search, minScore]);

  return (
    <main className="min-h-screen bg-zinc-950">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-red-950/20 via-zinc-950 to-zinc-950" />

      <div className="relative mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-8">
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
              <h1 className="text-2xl font-bold text-zinc-100">
                台股漲停股篩選
              </h1>
              <p className="text-sm text-zinc-500">
                主力大量購入漲停股篩選器 · 資料來源：證交所公開 API
              </p>
            </div>
          </div>
        </header>

        <div className="mb-6 space-y-4">
          {hasSearched && (
            <StatsCards
              totalScanned={data?.totalScanned ?? 0}
              limitUpCount={data?.limitUpCount ?? 0}
              filteredCount={data?.stocks.length ?? 0}
              marketStatus={data?.marketStatus ?? "unknown"}
              updatedAt={data?.updatedAt ?? ""}
              loading={loading}
            />
          )}

          <SearchBar
            value={search}
            onChange={setSearch}
            onSearch={fetchData}
            loading={loading}
            minScore={minScore}
            onMinScoreChange={setMinScore}
          />
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <StockTable
          stocks={data?.stocks ?? []}
          loading={loading}
          hasSearched={hasSearched}
        />

        <footer className="mt-8 text-center text-xs text-zinc-600">
          <p>主力分數綜合評估：法人買超、量能、漲停型態（資料為當日收盤）</p>
          <p className="mt-1">
            法人資料為前一交易日三大法人買賣超 · 僅供參考，不構成投資建議
          </p>
        </footer>
      </div>
    </main>
  );
}
