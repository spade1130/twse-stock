"use client";

interface PotentialSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: () => void;
  loading: boolean;
  minScore: number;
  onMinScoreChange: (score: number) => void;
  placeholder?: string;
}

export function PotentialSearchBar({
  value,
  onChange,
  onSearch,
  loading,
  minScore,
  onMinScoreChange,
  placeholder = "搜尋股票代號或名稱...",
}: PotentialSearchBarProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 py-2.5 pl-10 pr-4 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-red-500/50 focus:outline-none focus:ring-1 focus:ring-red-500/30"
        />
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-400">
          匹配分數 ≥
          <select
            value={minScore}
            onChange={(e) => onMinScoreChange(Number(e.target.value))}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:outline-none"
          >
            <option value={0}>不限</option>
            <option value={20}>20</option>
            <option value={30}>30</option>
            <option value={40}>40</option>
            <option value={50}>50</option>
            <option value={60}>60</option>
            <option value={70}>70</option>
            <option value={80}>80</option>
          </select>
        </label>

        <button
          onClick={onSearch}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
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
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          {loading ? "查詢中" : "開始篩選"}
        </button>
      </div>
    </div>
  );
}
