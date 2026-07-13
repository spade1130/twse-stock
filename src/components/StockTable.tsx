"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LimitUpStock } from "@/types/stock";
import {
  getStockScoreBreakdown,
  MAIN_FORCE_SCORE_RULES,
} from "@/lib/analyzer";

interface StockTableProps {
  stocks: LimitUpStock[];
  loading: boolean;
  hasSearched: boolean;
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 10000) {
    return `${(n / 10000).toFixed(1)}萬`;
  }
  return n.toLocaleString();
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 70
      ? "bg-red-500/20 text-red-400 border-red-500/30"
      : score >= 50
        ? "bg-orange-500/20 text-orange-400 border-orange-500/30"
        : "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {score}
    </span>
  );
}

function ScoreTooltip({ stock }: { stock: LimitUpStock }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
    placement: "bottom" as "top" | "bottom",
  });
  const breakdown = getStockScoreBreakdown(stock.signals);

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const estimatedHeight = 180;
    const gap = 8;
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const preferBelow =
      spaceBelow >= estimatedHeight + gap || spaceBelow >= spaceAbove;

    if (preferBelow) {
      setCoords({ x: centerX, y: rect.bottom + gap, placement: "bottom" });
    } else {
      setCoords({ x: centerX, y: rect.top - gap, placement: "top" });
    }
  }, []);

  const show = useCallback(() => {
    updatePosition();
    setVisible(true);
  }, [updatePosition]);

  const hide = useCallback(() => setVisible(false), []);

  useEffect(() => {
    if (!visible) return;

    const handleReposition = () => updatePosition();
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("resize", handleReposition);

    return () => {
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("resize", handleReposition);
    };
  }, [visible, updatePosition]);

  const tooltip =
    visible &&
    createPortal(
      <div
        role="tooltip"
        style={{
          position: "fixed",
          left: coords.x,
          top: coords.y,
          transform:
            coords.placement === "bottom"
              ? "translateX(-50%)"
              : "translate(-50%, -100%)",
        }}
        className="z-[200] w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-xs font-medium text-zinc-200">
          主力分 {stock.mainForceScore} / 100
        </p>
        {breakdown.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {breakdown.map(({ signal, points }) => (
              <li
                key={signal}
                className="flex items-center justify-between text-xs text-zinc-400"
              >
                <span>{signal}</span>
                <span className="font-mono text-red-400">+{points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">尚無加分項目</p>
        )}
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <p className="text-[10px] leading-relaxed text-zinc-500">
            分數越高代表主力跡象越明顯，滿分 100 分
          </p>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-flex cursor-help justify-center"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <ScoreBadge score={stock.mainForceScore} />
      </div>
      {tooltip}
    </>
  );
}

function ScoreRulesModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="關閉"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="score-rules-title"
        className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 id="score-rules-title" className="text-sm font-medium text-zinc-100">
            主力分數評估說明
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="關閉"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <ul className="overflow-y-auto px-4 py-3 space-y-3">
          {MAIN_FORCE_SCORE_RULES.map((rule) => (
            <li key={rule.signal} className="text-sm leading-snug">
              <div className="flex items-center justify-between">
                <span className="font-medium text-zinc-200">{rule.signal}</span>
                <span className="font-mono text-sm text-red-400">
                  +{rule.points}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{rule.description}</p>
            </li>
          ))}
        </ul>
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="text-xs text-zinc-500">
            各項分數可累加，最高 100 分。標註「即時」的項目需盤中行情資料；目前以收盤資料評估法人、量能與漲停型態。
          </p>
        </div>
      </div>
    </div>
  );
}

function ScoreHeaderTooltip() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex cursor-pointer items-center justify-center gap-1 rounded px-1 py-0.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
        aria-label="查看主力分數評估說明"
      >
        主力分
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>
      <ScoreRulesModal open={open} onClose={close} />
    </>
  );
}

export function StockTable({ stocks, loading, hasSearched }: StockTableProps) {
  if (!hasSearched && !loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-500">
          點擊「開始篩選」查詢今日主力漲停股
        </p>
      </div>
    );
  }

  if (loading && stocks.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
          <p className="mt-3 text-sm text-zinc-500">正在取得最新即時報價並篩選...</p>
          <p className="mt-1 text-xs text-zinc-600">全市場掃描約需 20–40 秒</p>
        </div>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-500">目前沒有符合條件的漲停股</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
        <p className="text-sm text-zinc-400">
          共 <span className="font-medium text-zinc-200">{stocks.length}</span>{" "}
          檔符合條件
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs text-zinc-500">
              <th className="px-4 py-3 font-medium">代號</th>
              <th className="px-4 py-3 font-medium">名稱</th>
              <th className="px-4 py-3 font-medium">市場</th>
              <th className="px-4 py-3 font-medium text-right">現價</th>
              <th className="px-4 py-3 font-medium text-right">漲跌%</th>
              <th className="px-4 py-3 font-medium text-right">成交量</th>
              <th className="px-4 py-3 font-medium text-right">法人買超</th>
              <th className="px-4 py-3 text-center font-medium">
                <ScoreHeaderTooltip />
              </th>
              <th className="px-4 py-3 font-medium">訊號</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((stock) => (
              <tr
                key={`${stock.market}_${stock.code}`}
                className="border-b border-zinc-800/50 transition hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3 font-mono font-medium text-zinc-200">
                  {stock.code}
                </td>
                <td className="px-4 py-3 text-zinc-300">{stock.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      stock.market === "tse"
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-purple-500/15 text-purple-400"
                    }`}
                  >
                    {stock.market === "tse" ? "上市" : "上櫃"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-red-400">
                  {stock.price.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-red-400">
                  +{stock.changePercent.toFixed(2)}%
                </td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                  {formatNumber(stock.volume)}
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  <span
                    className={
                      stock.institutionalNet > 0
                        ? "text-red-400"
                        : stock.institutionalNet < 0
                          ? "text-emerald-400"
                          : "text-zinc-500"
                    }
                  >
                    {stock.institutionalNet > 0 ? "+" : ""}
                    {formatNumber(stock.institutionalNet)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <ScoreTooltip stock={stock} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {stock.signals.map((sig) => (
                      <span
                        key={sig}
                        className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-zinc-400"
                      >
                        {sig}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
