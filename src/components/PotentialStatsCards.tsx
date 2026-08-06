"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

function StatsLabelTooltip({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) {
  const triggerRef = useRef<HTMLParagraphElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
    placement: "bottom" as "top" | "bottom",
  });

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const padding = 8;
    const gap = 8;
    const estimatedHeight = 100;
    const tooltipWidth = Math.min(
      256,
      window.innerWidth - padding * 2,
      tooltipRef.current?.offsetWidth || 256,
    );

    // 水平置中於觸發點，再夾在視窗內避免左右溢出
    let x = rect.left + rect.width / 2 - tooltipWidth / 2;
    x = Math.max(
      padding,
      Math.min(x, window.innerWidth - padding - tooltipWidth),
    );

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const preferBelow =
      spaceBelow >= estimatedHeight + gap || spaceBelow >= spaceAbove;

    if (preferBelow) {
      setCoords({ x, y: rect.bottom + gap, placement: "bottom" });
    } else {
      setCoords({ x, y: rect.top - gap, placement: "top" });
    }
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setVisible(true);
  }, [updatePosition]);

  const hide = useCallback(() => setVisible(false), []);

  const toggle = useCallback(() => {
    setVisible((prev) => {
      if (prev) return false;
      updatePosition();
      return true;
    });
  }, [updatePosition]);

  useEffect(() => {
    if (!visible) return;

    const handleReposition = () => updatePosition();
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (tooltipRef.current?.contains(target)) return;
      hide();
    };

    // portal 掛載後依實際寬度再校正一次
    const raf = requestAnimationFrame(updatePosition);

    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);
    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [visible, updatePosition, hide]);

  const portal =
    visible &&
    createPortal(
      <div
        ref={tooltipRef}
        role="tooltip"
        style={{
          position: "fixed",
          left: coords.x,
          top: coords.y,
          transform:
            coords.placement === "top" ? "translateY(-100%)" : undefined,
        }}
        className="z-[200] w-64 max-w-[min(16rem,calc(100vw-2rem))] rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left shadow-xl"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-[11px] leading-relaxed text-zinc-300">{tooltip}</p>
      </div>,
      document.body,
    );

  return (
    <>
      <p
        ref={triggerRef}
        className="inline-block w-fit max-w-full cursor-help border-b border-dotted border-zinc-600 text-xs text-zinc-500"
        onMouseEnter={() => {
          if (!window.matchMedia("(hover: hover)").matches) return;
          show();
        }}
        onMouseLeave={() => {
          if (!window.matchMedia("(hover: hover)").matches) return;
          hide();
        }}
        onClick={() => {
          // 觸控裝置沒有穩定 hover，改以點擊切換
          if (window.matchMedia("(hover: hover)").matches) return;
          toggle();
        }}
      >
        {label}
      </p>
      {portal}
    </>
  );
}

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
            <StatsLabelTooltip label={card.label} tooltip={card.tooltip} />
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
