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

const CANDIDATE_TOOLTIP =
  "為控制篩選時間，系統先以籌碼／融資／成交量從全市場挑出候選，再依前置分數排序，最多只對前 24 檔抓歷史 K 線並計算 7 項條件。";

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

  const cards: {
    label: string;
    value: string;
    accent?: boolean;
    className?: string;
    tooltip?: string;
  }[] = [
    { label: "交易日", value: tradeDate || "--" },
    { label: "資料來源", value: sourceLabel },
    { label: "掃描標的", value: totalScanned.toLocaleString() },
    {
      label: "排名前 24 的候選股",
      value: matchedCount.toLocaleString(),
      accent: true,
      tooltip: CANDIDATE_TOOLTIP,
    },
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
          {card.tooltip ? (
            <div className="group relative inline-flex max-w-full">
              <p className="cursor-help border-b border-dotted border-zinc-600 text-xs text-zinc-500">
                {card.label}
              </p>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100"
              >
                <p className="text-[11px] leading-relaxed text-zinc-300">
                  {card.tooltip}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500">{card.label}</p>
          )}
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
