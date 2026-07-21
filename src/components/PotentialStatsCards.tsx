"use client";

import React from "react";
import type { PotentialResponse } from "@/types/stock";

interface PotentialStatsCardsProps {
  totalScanned: number;
  matchedCount: number;
  marketStatus: PotentialResponse["marketStatus"];
  updatedAt: string;
  tradeDate?: string;
  dataSource?: PotentialResponse["dataSource"];
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

export function PotentialStatsCards({
  totalScanned,
  matchedCount,
  marketStatus,
  updatedAt,
  tradeDate,
  dataSource,
  loading,
}: PotentialStatsCardsProps) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString("zh-TW")
    : "--";

  const sourceLabel =
    dataSource === "realtime"
      ? "即時報價"
      : dataSource === "daily"
        ? "收盤資料"
        : "--";

  const cards = [
    { label: "交易日", value: tradeDate || "--" },
    { label: "資料來源", value: sourceLabel },
    { label: "掃描標的", value: totalScanned.toLocaleString() },
    { label: "符合數量", value: matchedCount.toLocaleString(), accent: true },
    {
      label: "市場狀態",
      value: statusLabel[marketStatus],
      className: statusColor[marketStatus],
    },
    { label: "更新時間", value: time },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
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

