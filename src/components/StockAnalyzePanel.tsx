"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AdviceAction,
  StockAnalyzeResponse,
  StockCandidate,
} from "@/types/stock";
import {
  getStockScoreBreakdown,
  MAIN_FORCE_SCORE_RULES,
} from "@/lib/analyzer";
import {
  getMatchScoreBreakdown,
  MATCH_SCORE_MAX,
} from "@/lib/potential-analyzer";

interface StockAnalyzePanelProps {
  data: StockAnalyzeResponse | null;
  loading: boolean;
  hasSearched: boolean;
  candidates?: StockCandidate[];
  onSelectCandidate?: (code: string) => void;
}

function formatVolume(n: number): string {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}萬`;
  return n.toLocaleString();
}

function MetricTooltip({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  const triggerRef = useRef<HTMLSpanElement>(null);
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
    const estimatedHeight = 96;
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
        className="z-[200] w-56 rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-xs font-medium text-zinc-200">{label}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
          {description}
        </p>
      </div>,
      document.body,
    );

  return (
    <>
      <span
        ref={triggerRef}
        className="cursor-help border-b border-dotted border-zinc-600 transition hover:text-zinc-300"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        {children}
      </span>
      {tooltip}
    </>
  );
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
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-sm font-medium ${color}`}
    >
      {score}
    </span>
  );
}

function actionStyles(action: AdviceAction): string {
  switch (action) {
    case "逢低布局":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "偏多觀察":
    case "強勢追蹤":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    case "追高風險":
      return "border-orange-500/40 bg-orange-500/10 text-orange-300";
    case "暫不建議":
      return "border-red-500/40 bg-red-500/10 text-red-300";
    default:
      return "border-zinc-600 bg-zinc-800/60 text-zinc-300";
  }
}

function confidenceLabel(level: StockAnalyzeResponse["advice"]["confidence"]) {
  switch (level) {
    case "high":
      return "判定把握：高";
    case "medium":
      return "判定把握：中";
    default:
      return "判定把握：低";
  }
}

function confidenceDescription(
  action: AdviceAction,
  level: StockAnalyzeResponse["advice"]["confidence"],
): string {
  const levelText =
    level === "high" ? "高" : level === "medium" ? "中" : "低";
  return `表示系統對「${action}」這項結論的把握程度（${levelText}），不是看好或看壞的強度。例如「暫不建議」搭配「判定把握：高」，代表主力與潛力分數皆偏弱、不建議進場的訊號較明確。`;
}

export function StockAnalyzePanel({
  data,
  loading,
  hasSearched,
  candidates,
  onSelectCandidate,
}: StockAnalyzePanelProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-red-500" />
        <p className="mt-4 text-sm text-zinc-400">
          正在整合主力訊號、籌碼與潛力條件…
        </p>
      </div>
    );
  }

  if (candidates && candidates.length > 0 && !data) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h2 className="text-sm font-medium text-zinc-200">請選擇要分析的股票</h2>
        <p className="mt-1 text-xs text-zinc-500">
          找到多檔符合結果，點選其中一檔繼續分析
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {candidates.map((c) => (
            <li key={`${c.market}-${c.code}`}>
              <button
                type="button"
                onClick={() => onSelectCandidate?.(c.code)}
                className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/50 px-3 py-2.5 text-left transition hover:border-red-500/40 hover:bg-red-500/5"
              >
                <span className="font-mono text-sm text-zinc-200">{c.code}</span>
                <span className="truncate text-sm text-zinc-400">{c.name}</span>
                <span
                  className={`ml-2 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                    c.market === "tse"
                      ? "bg-blue-500/15 text-blue-400"
                      : "bg-violet-500/15 text-violet-400"
                  }`}
                >
                  {c.market === "tse" ? "上市" : "上櫃"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!hasSearched) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-16 text-center">
        <p className="text-sm text-zinc-400">輸入股票代號或名稱開始個股分析</p>
        <p className="mt-2 text-xs text-zinc-600">
          將套用「漲停股主力分數」與「優質潛力股 7 項條件」產出買賣建議
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-16 text-center text-sm text-zinc-500">
        尚無分析結果
      </div>
    );
  }

  const { stock, potential, advice, potentialNote } = data;
  const mainBreakdown = getStockScoreBreakdown(stock.signals);
  const potentialBreakdown = potential
    ? getMatchScoreBreakdown(potential)
    : [];
  const passedCount = potential
    ? potential.conditions.filter((c) => c.passed).length
    : 0;

  return (
    <div className="space-y-4">
      {/* Quote header */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-lg font-semibold text-zinc-100">
                {stock.code}
              </span>
              <span className="text-lg text-zinc-200">{stock.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  stock.market === "tse"
                    ? "bg-blue-500/15 text-blue-400"
                    : "bg-violet-500/15 text-violet-400"
                }`}
              >
                {stock.market === "tse" ? "上市" : "上櫃"}
              </span>
              {stock.isLimitUp && (
                <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-400">
                  漲停
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-3xl font-semibold text-zinc-50">
                {stock.price.toFixed(2)}
              </span>
              <span
                className={`font-mono text-sm ${
                  stock.changePercent >= 0 ? "text-red-400" : "text-emerald-400"
                }`}
              >
                {stock.changePercent >= 0 ? "+" : ""}
                {stock.change.toFixed(2)}（{stock.changePercent.toFixed(2)}%）
              </span>
            </div>
            <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs text-zinc-500">
              <MetricTooltip
                label="成交量"
                description="今日截至目前的成交股數。數值越大代表當日交投越熱絡。"
              >
                成交量 {formatVolume(stock.volume)} 股
              </MetricTooltip>
              {stock.volumeRatio > 0 && (
                <>
                  <span aria-hidden>．</span>
                  <MetricTooltip
                    label="量比"
                    description={`今日成交量 ÷ 昨日成交量。目前為 ${stock.volumeRatio.toFixed(2)} 倍；≥ 1.5 視為量能放大，≥ 3 視為量能爆發。`}
                  >
                    量比 {stock.volumeRatio.toFixed(2)}x
                  </MetricTooltip>
                </>
              )}
              {stock.institutionalNet !== 0 && (
                <>
                  <span aria-hidden>．</span>
                  <MetricTooltip
                    label="法人淨額"
                    description={`三大法人（外資、投信、自營商）當日買賣超合計。正數為買超、負數為賣超；目前為 ${stock.institutionalNet > 0 ? "買超" : "賣超"} ${formatVolume(Math.abs(stock.institutionalNet))} 股。`}
                  >
                    法人淨額{" "}
                    {stock.institutionalNet > 0 ? "+" : ""}
                    {formatVolume(stock.institutionalNet)}
                  </MetricTooltip>
                </>
              )}
              {stock.updateTime && (
                <>
                  <span aria-hidden>．</span>
                  <MetricTooltip
                    label="更新時間"
                    description="即時報價最後更新時間（證交所 MIS）。盤後或改用日收盤資料時可能空白或延遲。"
                  >
                    {stock.updateTime}
                  </MetricTooltip>
                </>
              )}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs text-zinc-500">綜合評分</p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <ScoreBadge score={advice.combinedScore} />
              <span className="text-xs text-zinc-500">/ 100</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">
              潛力 55% + 主力 45%
            </p>
          </div>
        </div>
      </div>

      {/* Advice banner */}
      <div
        className={`rounded-xl border px-5 py-4 ${actionStyles(advice.action)}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl font-semibold tracking-wide">
            {advice.action}
          </span>
          <MetricTooltip
            label="判定把握"
            description={confidenceDescription(
              advice.action,
              advice.confidence,
            )}
          >
            <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] opacity-80">
              {confidenceLabel(advice.confidence)}
            </span>
          </MetricTooltip>
        </div>
        <p className="mt-2 text-sm leading-relaxed opacity-90">{advice.summary}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {advice.reasons.length > 0 && (
            <div>
              <p className="text-xs font-medium opacity-70">支撐理由</p>
              <ul className="mt-1.5 space-y-1">
                {advice.reasons.map((r) => (
                  <li key={r} className="text-xs leading-relaxed opacity-90">
                    · {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {advice.risks.length > 0 && (
            <div>
              <p className="text-xs font-medium opacity-70">風險提醒</p>
              <ul className="mt-1.5 space-y-1">
                {advice.risks.map((r) => (
                  <li key={r} className="text-xs leading-relaxed opacity-90">
                    · {r}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Dual score panels */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Main force */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200">
              漲停股／主力評估
            </h3>
            <div className="flex items-center gap-2">
              <ScoreBadge score={stock.mainForceScore} />
              <span className="text-xs text-zinc-500">/ 100</span>
            </div>
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            買盤壓力{" "}
            {(stock.buyPressure * 100).toFixed(0)}%
            {stock.isLimitUp ? " · 符合漲停判定" : " · 非漲停"}
          </p>

          {stock.signals.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stock.signals.map((sig) => (
                <span
                  key={sig}
                  className="rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300"
                >
                  {sig}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">尚無主力加分訊號</p>
          )}

          {mainBreakdown.length > 0 && (
            <ul className="mt-3 space-y-1.5 border-t border-zinc-800 pt-3">
              {mainBreakdown.map(({ signal, points }) => (
                <li
                  key={signal}
                  className="flex items-center justify-between text-xs text-zinc-400"
                >
                  <span>{signal}</span>
                  <span className="font-mono text-red-400">+{points}</span>
                </li>
              ))}
            </ul>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300">
              查看主力分數規則
            </summary>
            <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
              {MAIN_FORCE_SCORE_RULES.map((rule) => (
                <li key={rule.signal} className="text-[11px] text-zinc-500">
                  <span className="text-zinc-400">{rule.signal}</span>（+
                  {rule.points}）— {rule.description}
                </li>
              ))}
            </ul>
          </details>
        </section>

        {/* Potential */}
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-zinc-200">優質潛力股評估</h3>
            {potential ? (
              <div className="flex items-center gap-2">
                <ScoreBadge score={potential.matchScore} />
                <span className="text-xs text-zinc-500">
                  / {MATCH_SCORE_MAX}（{passedCount}/7）
                </span>
              </div>
            ) : (
              <span className="text-xs text-zinc-500">無法評分</span>
            )}
          </div>

          {potentialNote && (
            <p className="mt-1 text-xs text-amber-500/90">{potentialNote}</p>
          )}

          {potential ? (
            <>
              <ul className="mt-3 space-y-2">
                {potential.conditions.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <p
                        className={
                          c.passed ? "text-zinc-200" : "text-zinc-500"
                        }
                      >
                        {c.id}. {c.label}
                      </p>
                      <p className="mt-0.5 text-[11px] text-zinc-600">
                        {c.detail}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        c.passed
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                    >
                      {c.passed ? "通過" : "未過"}
                    </span>
                  </li>
                ))}
              </ul>

              {potentialBreakdown.length > 0 && (
                <ul className="mt-3 space-y-1.5 border-t border-zinc-800 pt-3">
                  {potentialBreakdown.map(({ label, points }) => (
                    <li
                      key={label}
                      className="flex items-center justify-between text-xs text-zinc-400"
                    >
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <span className="shrink-0 font-mono text-red-400">
                        +{points}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-3 text-xs text-zinc-500">
              無法完成潛力條件評估，建議改查歷史較完整的上市櫃個股。
            </p>
          )}
        </section>
      </div>

      {data.candidates && data.candidates.length > 0 && onSelectCandidate && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-xs text-zinc-500">其他相近股票</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.candidates.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => onSelectCandidate(c.code)}
                className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-2.5 py-1 text-xs text-zinc-400 transition hover:border-red-500/40 hover:text-zinc-200"
              >
                <span className="font-mono">{c.code}</span> {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-zinc-600">
        分析結果僅供參考，不構成任何投資建議；請自行評估風險。
      </p>
    </div>
  );
}
