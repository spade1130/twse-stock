"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  AdviceAction,
  GranvilleRuleResult,
  GranvilleStock,
} from "@/types/stock";
import {
  getGranvilleScoreBreakdownSummary,
  GRANVILLE_RULE_DEFS,
  GRANVILLE_SCORE_MAX,
} from "@/lib/granville-analyzer";

interface GranvillePanelProps {
  stocks: GranvilleStock[];
  loading: boolean;
  hasSearched: boolean;
  queried: boolean;
}

function formatVolume(n: number): string {
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1)}萬`;
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
      className={`inline-flex rounded-full border px-2.5 py-0.5 text-sm font-medium ${color}`}
    >
      {score}
    </span>
  );
}

function ScoreTooltip({
  stock,
  align = "center",
  stopRowClick = false,
}: {
  stock: GranvilleStock;
  align?: "center" | "end";
  stopRowClick?: boolean;
}) {
  const triggerRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({
    x: 0,
    y: 0,
    placement: "bottom" as "top" | "bottom",
  });
  const { items, rawTotal, finalScore, wasClamped } =
    getGranvilleScoreBreakdownSummary(stock);
  const focusLabel =
    stock.focusBuy === "both"
      ? "買點 2＋3"
      : stock.focusBuy === "buy2"
        ? "買點 2"
        : stock.focusBuy === "buy3"
          ? "買點 3"
          : null;

  const updatePosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const estimatedHeight = 280;
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
        className="z-[200] w-80 max-w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-left shadow-xl"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <p className="text-xs font-medium text-zinc-200">
          法則分 {finalScore} / {GRANVILLE_SCORE_MAX}
          {focusLabel ? `（${focusLabel}）` : ""}
        </p>
        {items.length > 0 ? (
          <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
            {items.map(({ label, points }) => (
              <li
                key={label}
                className="flex items-start justify-between gap-2 text-xs text-zinc-400"
              >
                <span className="min-w-0 flex-1 leading-relaxed">{label}</span>
                <span
                  className={`shrink-0 font-mono ${
                    points >= 0 ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {points >= 0 ? "+" : ""}
                  {points}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs text-zinc-500">尚無加分項目</p>
        )}
        <div className="mt-2 space-y-1 border-t border-zinc-800 pt-2">
          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>加總</span>
            <span className="font-mono">{rawTotal}</span>
          </div>
          {wasClamped && (
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>封頂後（0–{GRANVILLE_SCORE_MAX}）</span>
              <span className="font-mono text-red-400">{finalScore}</span>
            </div>
          )}
          <p className="text-[10px] leading-relaxed text-zinc-500">
            基礎 18 分；買點 2／3 各 +32、共振 +8；並依 60 日漲幅、量能、MACD、KD、RSI
            與賣點結構加減，滿分 {GRANVILLE_SCORE_MAX} 分
          </p>
        </div>
      </div>,
      document.body,
    );

  return (
    <>
      <div
        ref={triggerRef}
        className={`inline-flex cursor-help ${
          align === "end" ? "justify-end" : "justify-center"
        }`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={stopRowClick ? (e) => e.stopPropagation() : undefined}
      >
        <ScoreBadge score={stock.score} />
      </div>
      {tooltip}
    </>
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

function confidenceLabel(level: GranvilleStock["advice"]["confidence"]) {
  switch (level) {
    case "high":
      return "判定把握：高";
    case "medium":
      return "判定把握：中";
    default:
      return "判定把握：低";
  }
}

function slopeText(slope: GranvilleStock["maSlope"]) {
  switch (slope) {
    case "rising":
      return "上揚";
    case "falling":
      return "下彎";
    default:
      return "走平";
  }
}

function FocusBadges({ stock }: { stock: GranvilleStock }) {
  if (!stock.focusBuy) {
    return <span className="text-[11px] text-zinc-600">—</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {(stock.focusBuy === "buy2" || stock.focusBuy === "both") && (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
          買點 2
        </span>
      )}
      {(stock.focusBuy === "buy3" || stock.focusBuy === "both") && (
        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-medium text-sky-400">
          買點 3
        </span>
      )}
    </div>
  );
}

function RuleCard({ rule }: { rule: GranvilleRuleResult }) {
  const tone = rule.matched
    ? rule.side === "buy"
      ? "border-emerald-500/30 bg-emerald-500/10"
      : "border-red-500/30 bg-red-500/10"
    : "border-zinc-800 bg-zinc-950/40";

  return (
    <div className={`rounded-lg border px-3 py-2.5 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-xs font-medium ${
              rule.matched
                ? rule.side === "buy"
                  ? "text-emerald-300"
                  : "text-red-300"
                : "text-zinc-500"
            }`}
          >
            {rule.label}
          </span>
          {rule.highlighted && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              重點
            </span>
          )}
        </div>
        <span
          className={`text-[10px] ${
            rule.matched ? "text-zinc-200" : "text-zinc-600"
          }`}
        >
          {rule.matched ? "符合" : "未符合"}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-300">{rule.title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
        {rule.detail}
      </p>
    </div>
  );
}

function GranvilleDetail({ stock }: { stock: GranvilleStock }) {
  const { indicators, advice } = stock;

  return (
    <div className="space-y-4">
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
              <FocusBadges stock={stock} />
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
            <p className="mt-2 text-xs text-zinc-500">
              成交量 {formatVolume(stock.volume)} 股．月線 {stock.ma20.toFixed(2)}（
              {slopeText(stock.maSlope)}）．乖離 {stock.bias20.toFixed(1)}%．60 日漲幅{" "}
              {stock.gain60d.toFixed(1)}%
              {stock.updateTime ? `．${stock.updateTime}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500">法則分數</p>
            <div className="mt-1 flex items-center justify-end gap-2">
              <ScoreTooltip stock={stock} align="end" />
              <span className="text-xs text-zinc-500">/ {GRANVILLE_SCORE_MAX}</span>
            </div>
            <p className="mt-1 text-[11px] text-zinc-600">買點 2／3 加權最高</p>
          </div>
        </div>
      </div>

      <div className={`rounded-xl border px-5 py-4 ${actionStyles(advice.action)}`}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xl font-semibold tracking-wide">
            {advice.action}
          </span>
          <span className="rounded-full border border-current/20 px-2 py-0.5 text-[11px] opacity-80">
            {confidenceLabel(advice.confidence)}
          </span>
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

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h3 className="text-sm font-medium text-zinc-200">葛蘭碧八大法則</h3>
          <p className="mt-1 text-xs text-zinc-500">
            以 20 日均線判定；第二、第三買點為主力布局後尚未大漲的重點型態
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {stock.rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h3 className="text-sm font-medium text-zinc-200">量能與動能確認</h3>
          <ul className="mt-3 space-y-3 text-xs">
            <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-zinc-400">成交量</p>
              <p className="mt-1 text-zinc-200">
                量比 20 日均量 {indicators.volumeRatio20.toFixed(2)} 倍
              </p>
              <p className="mt-0.5 text-zinc-500">{indicators.volumeNote}</p>
            </li>
            <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-zinc-400">MACD（12, 26, 9）</p>
              <p className="mt-1 font-mono text-zinc-200">
                DIF {indicators.macdDif.toFixed(3)}／DEA {indicators.macdDea.toFixed(3)}／柱{" "}
                {indicators.macdHistogram.toFixed(3)}
              </p>
              <p className="mt-0.5 text-zinc-500">{indicators.macdSignal}</p>
            </li>
            <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-zinc-400">KD（RSV 9）</p>
              <p className="mt-1 font-mono text-zinc-200">
                K {indicators.k.toFixed(1)}／D {indicators.d.toFixed(1)}／J{" "}
                {indicators.j.toFixed(1)}
              </p>
              <p className="mt-0.5 text-zinc-500">{indicators.kdSignal}</p>
            </li>
            <li className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2">
              <p className="text-zinc-400">RSI（14）</p>
              <p className="mt-1 font-mono text-zinc-200">
                {indicators.rsi.toFixed(1)}
              </p>
              <p className="mt-0.5 text-zinc-500">{indicators.rsiSignal}</p>
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}

export function GranvillePanel({
  stocks,
  loading,
  hasSearched,
  queried,
}: GranvillePanelProps) {
  const [focusOnly, setFocusOnly] = useState(true);
  const [notSurgedOnly, setNotSurgedOnly] = useState(true);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return stocks.filter((s) => {
      if (focusOnly && !s.focusBuy) return false;
      if (notSurgedOnly && s.gain60d >= 20) return false;
      return true;
    });
  }, [stocks, focusOnly, notSurgedOnly]);

  const visible = queried ? stocks : filtered;

  useEffect(() => {
    if (visible.length === 0) {
      setSelectedCode(null);
      return;
    }
    setSelectedCode((prev) =>
      prev && visible.some((s) => s.code === prev) ? prev : visible[0].code,
    );
  }, [visible]);

  const selected = visible.find((s) => s.code === selectedCode) ?? null;

  const select = useCallback((code: string) => {
    setSelectedCode(code);
  }, []);

  if (loading && stocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 px-6 py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-600 border-t-red-500" />
        <p className="mt-4 text-sm text-zinc-400">
          正在計算葛蘭碧法則、成交量、MACD、KD 與 RSI…
        </p>
        <p className="mt-1 text-xs text-zinc-600">
          {queried ? "個股分析約數秒" : "全市場候選篩選約需 20–40 秒"}
        </p>
      </div>
    );
  }

  if (!hasSearched) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-14">
        <p className="text-center text-sm text-zinc-400">
          篩選「主力已布局、尚未大漲」的葛蘭碧買點，或輸入代號做單檔分析
        </p>
        <p className="mt-2 text-center text-xs text-zinc-600">
          重點研究第二買點（回檔不破均線）與第三買點（假跌破後站回），並以量能、MACD、KD、RSI 確認
        </p>
        <div className="mx-auto mt-6 grid max-w-3xl gap-2 sm:grid-cols-2">
          {GRANVILLE_RULE_DEFS.map((rule) => (
            <div
              key={rule.id}
              className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`text-xs font-medium ${
                    rule.side === "buy" ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {rule.label}
                </span>
                {rule.highlighted && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
                    重點研究
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-zinc-300">{rule.title}</p>
              <p className="mt-0.5 text-[11px] text-zinc-600">{rule.description}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (stocks.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
        <p className="text-sm text-zinc-500">沒有可分析的結果，請改搜尋其他股票或放寬分數</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!queried && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 bg-zinc-900/40 px-4 py-3">
          <p className="text-xs text-zinc-500">
            為控制時間，依當日成交值（股價 × 成交量）挑前 96 檔分析。預設只顯示重點買點且 60 日漲幅 &lt; 20%；特定標的請直接輸入代號分析。
          </p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={focusOnly}
                onChange={(e) => setFocusOnly(e.target.checked)}
                className="accent-red-500"
              />
              只看買點 2／3
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={notSurgedOnly}
                onChange={(e) => setNotSurgedOnly(e.target.checked)}
                className="accent-red-500"
              />
              尚未大漲（60日 &lt; 20%）
            </label>
          </div>
        </div>
      )}

      {visible.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40">
          <p className="text-sm text-zinc-500">
            目前篩選條件沒有符合個股，請取消「只看買點 2／3」或「尚未大漲」
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-zinc-800">
            <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
              <p className="text-sm text-zinc-400">
                共{" "}
                <span className="font-medium text-zinc-200">{visible.length}</span>{" "}
                檔，點選列位查看買賣建議
              </p>
              <span className="rounded-full border border-zinc-700 bg-zinc-800/60 px-2 py-0.5 text-xs text-zinc-400">
                重點買點優先
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-xs text-zinc-500">
                    <th className="px-4 py-3 font-medium">代號</th>
                    <th className="px-4 py-3 font-medium">名稱</th>
                    <th className="px-4 py-3 font-medium text-right">現價</th>
                    <th className="px-4 py-3 font-medium text-right">60日漲幅</th>
                    <th className="px-4 py-3 font-medium">重點買點</th>
                    <th className="px-4 py-3 font-medium">建議</th>
                    <th className="px-4 py-3 text-center font-medium">分數</th>
                    <th className="px-4 py-3 font-medium">RSI / KD</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => {
                    const active = s.code === selectedCode;
                    return (
                      <tr
                        key={`${s.market}_${s.code}`}
                        onClick={() => select(s.code)}
                        className={`cursor-pointer border-b border-zinc-800/50 transition ${
                          active
                            ? "bg-red-500/10"
                            : "hover:bg-zinc-800/30"
                        }`}
                      >
                        <td className="px-4 py-3 font-mono font-medium text-zinc-200">
                          {s.code}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{s.name}</td>
                        <td className="px-4 py-3 text-right font-mono text-red-400">
                          {s.price.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-zinc-400">
                          {s.gain60d.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3">
                          <FocusBadges stock={s} />
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[11px] ${actionStyles(s.advice.action)}`}
                          >
                            {s.advice.action}
                          </span>
                        </td>
                        <td
                          className="px-4 py-3 text-center"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ScoreTooltip stock={s} stopRowClick />
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-zinc-500">
                          {s.indicators.rsi.toFixed(0)}／K {s.indicators.k.toFixed(0)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selected && <GranvilleDetail stock={selected} />}
        </>
      )}

      <p className="text-center text-[11px] text-zinc-600">
        分析結果僅供參考，不構成任何投資建議；請自行評估風險。
      </p>
    </div>
  );
}
