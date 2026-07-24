"use client";

interface AnalyzeSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
}

export function AnalyzeSearchBar({
  value,
  onChange,
  onSearch,
  loading,
}: AnalyzeSearchBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <svg
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="輸入股票代號或名稱，例如 2330、台積電"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) onSearch();
          }}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/50 focus:outline-none focus:ring-1 focus:ring-red-500/30"
        />
      </div>

      <button
        type="button"
        onClick={onSearch}
        disabled={loading || !value.trim()}
        className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
      >
        <svg
          className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
          />
        </svg>
        {loading ? "分析中" : "開始分析"}
      </button>
    </div>
  );
}
