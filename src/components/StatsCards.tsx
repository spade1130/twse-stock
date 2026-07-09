"use client";

interface StatsCardsProps {
  totalScanned: number;
  limitUpCount: number;
  filteredCount: number;
  marketStatus: "open" | "closed" | "unknown";
  updatedAt: string;
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

export function StatsCards({
  totalScanned,
  limitUpCount,
  filteredCount,
  marketStatus,
  updatedAt,
  loading,
}: StatsCardsProps) {
  const time = updatedAt
    ? new Date(updatedAt).toLocaleTimeString("zh-TW")
    : "--";

  const cards = [
    { label: "掃描標的", value: totalScanned.toLocaleString() },
    { label: "漲停股數", value: limitUpCount.toLocaleString(), accent: true },
    { label: "篩選結果", value: filteredCount.toLocaleString(), accent: true },
    {
      label: "市場狀態",
      value: statusLabel[marketStatus],
      className: statusColor[marketStatus],
    },
    { label: "更新時間", value: time },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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
