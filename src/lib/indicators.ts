import type { DailyBar } from "@/lib/stock-history";

export function smaAt(values: number[], period: number, endIndex: number): number {
  if (endIndex + 1 < period) return 0;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    sum += values[i];
  }
  return sum / period;
}

export function smaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function emaSeries(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(Number.NaN);
  if (values.length < period) return out;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;

  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export interface MacdSnapshot {
  dif: number;
  dea: number;
  histogram: number;
  prevHistogram: number;
  goldenCross: boolean;
  deathCross: boolean;
}

export function calcMacd(closes: number[]): MacdSnapshot | null {
  if (closes.length < 35) return null;

  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const dif: number[] = closes.map((_, i) =>
    Number.isFinite(ema12[i]) && Number.isFinite(ema26[i])
      ? ema12[i] - ema26[i]
      : Number.NaN,
  );

  const firstValid = dif.findIndex((v) => Number.isFinite(v));
  if (firstValid < 0 || dif.length - firstValid < 9) return null;

  const aligned = dif.slice(firstValid);
  const deaAligned = emaSeries(aligned, 9);
  const last = aligned.length - 1;
  const prev = last - 1;
  if (!Number.isFinite(deaAligned[last]) || !Number.isFinite(aligned[last])) {
    return null;
  }

  const difNow = aligned[last];
  const deaNow = deaAligned[last];
  const difPrev = aligned[prev];
  const deaPrev = deaAligned[prev];
  const histogram = difNow - deaNow;
  const prevHistogram =
    Number.isFinite(difPrev) && Number.isFinite(deaPrev)
      ? difPrev - deaPrev
      : histogram;

  return {
    dif: difNow,
    dea: deaNow,
    histogram,
    prevHistogram,
    goldenCross:
      Number.isFinite(difPrev) &&
      Number.isFinite(deaPrev) &&
      difPrev <= deaPrev &&
      difNow > deaNow,
    deathCross:
      Number.isFinite(difPrev) &&
      Number.isFinite(deaPrev) &&
      difPrev >= deaPrev &&
      difNow < deaNow,
  };
}

export function calcRsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface KdSnapshot {
  k: number;
  d: number;
  j: number;
  prevK: number;
  prevD: number;
  goldenCross: boolean;
  deathCross: boolean;
}

/** 台股常用：RSV 9 日，K/D 以 1/3、2/3 平滑。 */
export function calcKd(bars: DailyBar[], n = 9): KdSnapshot | null {
  if (bars.length < n + 2) return null;

  let k = 50;
  let d = 50;
  let prevK = 50;
  let prevD = 50;

  for (let i = n - 1; i < bars.length; i++) {
    const slice = bars.slice(i - n + 1, i + 1);
    const high = Math.max(...slice.map((b) => b.high || b.close));
    const low = Math.min(...slice.map((b) => (b.low > 0 ? b.low : b.close)));
    const rsv = high === low ? 50 : ((bars[i].close - low) / (high - low)) * 100;
    prevK = k;
    prevD = d;
    k = (2 / 3) * k + (1 / 3) * rsv;
    d = (2 / 3) * d + (1 / 3) * k;
  }

  return {
    k,
    d,
    j: 3 * k - 2 * d,
    prevK,
    prevD,
    goldenCross: prevK <= prevD && k > d,
    deathCross: prevK >= prevD && k < d,
  };
}
