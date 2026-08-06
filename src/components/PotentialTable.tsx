"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PotentialStock } from "@/types/stock";
import {
  getMatchScoreBreakdown,
  MATCH_SCORE_MAX,
  MATCH_SCORE_RULES,
} from "@/lib/potential-analyzer";

interface PotentialTableProps {
  stocks: PotentialStock[];
  loading: boolean;
  hasSearched: boolean;
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

function ScoreTooltip({ stock }: { stock: PotentialStock }) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
    placement: "bottom" as "top" | "bottom",
  });
  const breakdown = getMatchScoreBreakdown(stock);
  const passedCount = stock.conditions.filter((c) => c.passed).length;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const estimatedHeight = 220;
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
        className="z-[200] w-72 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-xs font-medium text-zinc-200">
          匹配分 {stock.matchScore} / {MATCH_SCORE_MAX}（{passedCount}/7 項）
        </p>
        {breakdown.length > 0 ? (
          <ul className="mt-2 space-y-1">
            {breakdown.map(({ label, points }) => (
              <li
                key={label}
                className="flex items-center justify-between gap-2 text-xs text-zinc-400"
              >
                <span className="min-w-0 flex-1">{label}</span>
                <span className="shrink-0 font-mono text-red-400">+{points}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">尚無加分項目</p>
        )}
        <div className="mt-2 border-t border-zinc-800 pt-2">
          <p className="text-[10px] leading-relaxed text-zinc-500">
            每項條件通過加 10 分（最高 70 分），大戶持股額外 +20、融資減少額外 +10，滿分{" "}
            {MATCH_SCORE_MAX} 分
          </p>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-flex cursor-help flex-col items-center gap-1"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <ScoreBadge score={stock.matchScore} />
        <span className="text-[11px] text-zinc-500">{passedCount}/7</span>
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
        aria-labelledby="match-score-rules-title"
        className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2
            id="match-score-rules-title"
            className="text-sm font-medium text-zinc-100"
          >
            匹配分數評估說明
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
        <ul className="space-y-3 overflow-y-auto px-4 py-3">
          {MATCH_SCORE_RULES.map((rule) => (
            <li key={rule.label} className="text-sm leading-snug">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-200">{rule.label}</span>
                <span className="shrink-0 font-mono text-sm text-red-400">
                  +{rule.points}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">{rule.description}</p>
            </li>
          ))}
        </ul>
        <div className="border-t border-zinc-800 px-4 py-3">
          <p className="text-xs text-zinc-500">
            7 項篩選條件各 10 分（最高 70 分）；大戶持股額外 +20、融資減少額外 +10，總分上限{" "}
            {MATCH_SCORE_MAX} 分。
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
        aria-label="查看匹配分數評估說明"
      >
        匹配分數
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

function ConditionPill({ passed }: { passed: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        passed ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-800 text-zinc-400"
      }`}
    >
      {passed ? "通過" : "未通過"}
    </span>
  );
}

function ConditionItem({
  condition,
}: {
  condition: PotentialStock["conditions"][number];
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
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
    const centerX = rect.left + rect.width / 2;
    const estimatedHeight = 80;
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
        className="z-[200] max-w-xs rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left shadow-xl"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-xs font-medium text-zinc-200">{condition.label}</p>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
          {condition.detail}
        </p>
      </div>,
      document.body,
    );

  return (
    <>
      <div
        ref={triggerRef}
        className="flex cursor-help items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/40 px-2 py-1"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <ConditionPill passed={condition.passed} />
        <span className="text-[11px] text-zinc-400">{condition.label}</span>
      </div>
      {tooltip}
    </>
  );
}

export function PotentialTable({
  stocks,
  loading,
  hasSearched,
}: PotentialTableProps) {
  if (!hasSearched && !loading) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-500">點擊「開始篩選」尋找優質潛力股</p>
      </div>
    );
  }

  if (loading && stocks.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-red-500 border-t-transparent" />
          <p className="mt-3 text-sm text-zinc-500">正在取得歷史資料並篩選...</p>
          <p className="mt-1 text-xs text-zinc-600">候選檔約需 20–40 秒</p>
        </div>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-500">目前沒有符合條件的潛力股</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-800">
      <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
        <p className="text-sm text-zinc-400">
          共 <span className="font-medium text-zinc-200">{stocks.length}</span> 檔符合匹配分數條件
        </p>
        <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-400">
          依匹配分數排序
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs text-zinc-500">
              <th className="px-4 py-3 font-medium">代號</th>
              <th className="px-4 py-3 font-medium">名稱</th>
              <th className="px-4 py-3 font-medium">市場</th>
              <th className="px-4 py-3 font-medium text-right">現價</th>
              <th className="px-4 py-3 font-medium text-right">60日漲幅</th>
              <th className="px-4 py-3 text-center font-medium">
                <ScoreHeaderTooltip />
              </th>
              <th className="px-4 py-3 font-medium">條件</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((s) => (
              <tr
                key={`${s.market}_${s.code}`}
                className="border-b border-zinc-800/50 transition hover:bg-zinc-800/30"
              >
                <td className="px-4 py-3 font-mono font-medium text-zinc-200">{s.code}</td>
                <td className="px-4 py-3 text-zinc-300">{s.name}</td>
                <td className="px-4 py-3">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs ${
                      s.market === "tse"
                        ? "bg-blue-500/15 text-blue-400"
                        : "bg-purple-500/15 text-purple-400"
                    }`}
                  >
                    {s.market === "tse" ? "上市" : "上櫃"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right font-mono text-red-400">{s.price.toFixed(2)}</td>
                <td className="px-4 py-3 text-right font-mono text-zinc-400">
                  {s.gain60d.toFixed(2)}%
                </td>
                <td className="px-4 py-3 text-center">
                  <ScoreTooltip stock={s} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {s.conditions.slice(0, 7).map((c) => (
                      <ConditionItem key={c.id} condition={c} />
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
