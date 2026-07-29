"use client";

import { useCallback, useState } from "react";
import { SearchBar } from "@/components/SearchBar";
import { StatsCards } from "@/components/StatsCards";
import { StockTable } from "@/components/StockTable";
import { PotentialSearchBar } from "@/components/PotentialSearchBar";
import { PotentialStatsCards } from "@/components/PotentialStatsCards";
import { PotentialTable } from "@/components/PotentialTable";
import { AnalyzeSearchBar } from "@/components/AnalyzeSearchBar";
import { StockAnalyzePanel } from "@/components/StockAnalyzePanel";
import type {
  LimitUpResponse,
  PotentialResponse,
  StockAnalyzeResponse,
  StockCandidate,
} from "@/types/stock";

type TabId = "limitUp" | "potential" | "analyze";

export default function Home() {
  const [tab, setTab] = useState<TabId>("limitUp");

  const [limitData, setLimitData] = useState<LimitUpResponse | null>(null);
  const [potentialData, setPotentialData] = useState<PotentialResponse | null>(
    null,
  );
  const [analyzeData, setAnalyzeData] = useState<StockAnalyzeResponse | null>(
    null,
  );
  const [analyzeCandidates, setAnalyzeCandidates] = useState<
    StockCandidate[] | undefined
  >(undefined);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [analyzeQuery, setAnalyzeQuery] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [potentialMinScore, setPotentialMinScore] = useState(0);
  const [limitHasSearched, setLimitHasSearched] = useState(false);
  const [potentialHasSearched, setPotentialHasSearched] = useState(false);
  const [analyzeHasSearched, setAnalyzeHasSearched] = useState(false);

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
      const params = new URLSearchParams({
        minScore: String(potentialMinScore),
      });
      if (search) params.set("q", search);

      const res = await fetch(`/api/stocks/potential?${params.toString()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      const text = await res.text();
      let json: PotentialResponse | { error?: string } | null = null;
      try {
        json = text ? (JSON.parse(text) as PotentialResponse | { error?: string }) : null;
      } catch {
        if (
          text.includes("FUNCTION_INVOCATION_TIMEOUT") ||
          text.includes("An error occurred with your deployment")
        ) {
          throw new Error(
            "伺服器處理逾時，請稍後再試一次（篩選請求較重，偶發會超時）",
          );
        }
        throw new Error("伺服器回應格式異常，請稍後再試");
      }

      if (!res.ok) {
        throw new Error(
          (json && "error" in json && json.error) || "資料載入失敗",
        );
      }

      setPotentialData(json as PotentialResponse);
      setPotentialHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, [search, potentialMinScore]);

  const fetchAnalyze = useCallback(async (queryOverride?: string) => {
    const q = (queryOverride ?? analyzeQuery).trim();
    if (!q) {
      setError("請輸入股票代號或名稱");
      return;
    }

    if (queryOverride != null) {
      setAnalyzeQuery(queryOverride);
    }

    setLoading(true);
    setError(null);
    setAnalyzeCandidates(undefined);

    try {
      const params = new URLSearchParams({
        q,
        _t: String(Date.now()),
      });

      const res = await fetch(`/api/stocks/analyze?${params.toString()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });

      const json = await res.json();

      if (res.status === 409 && Array.isArray(json.candidates)) {
        setAnalyzeData(null);
        setAnalyzeCandidates(json.candidates);
        setAnalyzeHasSearched(true);
        setError(json.error ?? "找到多檔符合股票，請選擇其中一檔");
        return;
      }

      if (!res.ok) {
        setAnalyzeData(null);
        throw new Error(json.error ?? "分析失敗");
      }

      setAnalyzeData(json as StockAnalyzeResponse);
      setAnalyzeCandidates(undefined);
      setAnalyzeHasSearched(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "未知錯誤");
    } finally {
      setLoading(false);
    }
  }, [analyzeQuery]);

  const tabBtn = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => {
        setTab(id);
        setError(null);
      }}
      className={`rounded-xl border px-4 py-2 text-sm transition ${
        tab === id
          ? "border-red-500/40 bg-red-500/10 text-red-300"
          : "border-zinc-800 bg-zinc-900/50 text-zinc-400 hover:bg-zinc-900"
      }`}
    >
      {label}
    </button>
  );

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
              <p className="text-sm text-zinc-500">
                漲停篩選、優質潛力股與個股分析建議
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {tabBtn("limitUp", "漲停股篩選")}
            {tabBtn("potential", "優質潛力股")}
            {tabBtn("analyze", "個股分析建議")}
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
              minScore={potentialMinScore}
              onMinScoreChange={setPotentialMinScore}
            />
          )}

          {tab === "analyze" && (
            <AnalyzeSearchBar
              value={analyzeQuery}
              onChange={setAnalyzeQuery}
              onSearch={() => fetchAnalyze()}
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

        {tab === "analyze" && (
          <StockAnalyzePanel
            data={analyzeData}
            loading={loading}
            hasSearched={analyzeHasSearched}
            candidates={analyzeCandidates}
            onSelectCandidate={(code) => fetchAnalyze(code)}
          />
        )}

        <footer className="mt-8 text-center text-xs text-zinc-600">
          <p>
            行情來自證交所 MIS 即時報價（手動篩選時更新）·
            主力分數綜合評估法人、量能與五檔委託
          </p>
          <p className="mt-1">
            優質潛力股與個股分析使用歷史 K 線、融資餘額與集保籌碼（僅供參考，不構成投資建議）
          </p>
        </footer>
      </div>
    </main>
  );
}
