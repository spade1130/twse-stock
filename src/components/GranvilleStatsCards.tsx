"use client";

import type { GranvilleResponse } from "@/types/stock";

interface GranvilleStatsCardsProps {
  totalScanned: number;
  historyAnalyzed: number;
  buy2Count: number;
  buy3Count: number;
  marketStatus: GranvilleResponse["marketStatus"];
  updatedAt: string;
  tradeDate?: string;
  dataSource?: GranvilleResponse["dataSource"];
  loading: boolean;
}

const statusLabel = {
  open: "盤中",
  closed: "已收盤",
  unknown: "未知",
};

const statusColor = {
  open: "text-emerald-400",
  closed: "text-zinc-400",
  unknown: "text-amber-400",
};

export function GranvilleStatsCards({
  totalScanned,
  historyAnalyzed,
  buy2Count,
  buy3Count,
  marketStatus,
  updatedAt,
  tradeDate,
  dataSource,
  loading,
}: GranvilleStatsCardsProps) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString("zh-TW")
    : "--";

  const sourceLabel =
    dataSource === "realtime"
      ? "即時報價"
      : dataSource === "daily"
        ? "收盤資料"
        : "--";

  const cards: {
    label: string;
    value: string;
    accent?: boolean;
    className?: string;
  }[] = [
    { label: "交易日", value: tradeDate || "--" },
    { label: "資料來源", value: sourceLabel },
    { label: "掃描標的", value: totalScanned.toLocaleString() },
    { label: "完成分析", value: historyAnalyzed.toLocaleString() },
    {
      label: "第二買點",
      value: buy2Count.toLocaleString(),
      accent: true,
    },
    {
      label: "第三買點",
      value: buy3Count.toLocaleString(),
      accent: true,
    },
    {
      label: "市場狀態",
      value: statusLabel[marketStatus],
      className: statusColor[marketStatus],
    },
    { label: "更新時間", value: time },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 backdrop-blur"
        >
          <p className="text-xs text-zinc-500">{card.label}</p>
          <p
            className={`mt-1 text-xl font-semibold tabular-nums ${
              card.accent ? "text-red-400" : card.className ?? "text-zinc-100"
            } ${loading ? "animate-pulse opacity-60" : ""}`}
          >
            {loading ? "..." : card.value}
          </p>
        </div>
      ))}
    </div>
  );
}
