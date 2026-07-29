const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const TDCC_OFFICIAL_URL =
  "https://smart.tdcc.com.tw/opendata/getOD.ashx?id=1-5";

const TDCC_ARCHIVE_RAW_BASE =
  "https://raw.githubusercontent.com/wirelessr/tdcc-opendata-archive/main/snapshots";

export interface TdccChipMetrics {
  code: string;
  date: string;
  chipConcentration: number;
  majorHolderPct: number;
}

type SnapshotStore = Map<string, TdccChipMetrics>;

const snapshotHistory = new Map<string, SnapshotStore>();

function parseFloatSafe(value?: string): number {
  if (!value) return 0;
  const n = parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function ymdToDate(ymd: string): Date | null {
  if (!/^\d{8}$/.test(ymd)) return null;
  const year = parseInt(ymd.slice(0, 4), 10);
  const month = parseInt(ymd.slice(4, 6), 10) - 1;
  const day = parseInt(ymd.slice(6, 8), 10);
  const d = new Date(year, month, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function dateToYmd(d: Date): string {
  const yyyy = String(d.getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function archiveRawUrlForYmd(ymd: string): string {
  const d = ymdToDate(ymd);
  if (!d) return "";
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${TDCC_ARCHIVE_RAW_BASE}/${year}/${year}-${month}-${day}.csv`;
}

async function readFirstCsvRecordDate(onlyFirstDataLine = true): Promise<string> {
  const res = await fetch(TDCC_OFFICIAL_URL, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok || !res.body) return "";

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let linesSeen = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // We only need the first data line's date. The file is huge,
    // so stop reading as soon as we have it.
    const lines = buffer.split(/\r?\n/);
    if (lines.length <= 1) continue;

    // Remove header line
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      linesSeen++;
      const date = line.split(",")[0]?.trim() ?? "";
      if (/^\d{8}$/.test(date)) return date;
      if (onlyFirstDataLine && linesSeen >= 1) return "";
    }

    // Keep last partial line
    buffer = lines[lines.length - 1];
  }

  return "";
}

async function fetchTdccChipMetricsForCodes(
  snapshotYmd: string,
  codes: Set<string>,
): Promise<Map<string, TdccChipMetrics>> {
  const url = archiveRawUrlForYmd(snapshotYmd);
  if (!url) return new Map();

  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  if (!res.ok || !res.body) return new Map();

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let isFirstLine = true;

  const totals = new Map<string, { chip: number; major: number }>();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n/);
    // Keep last partial line in buffer
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (isFirstLine) {
        // Skip CSV header
        isFirstLine = false;
        continue;
      }

      const cols = line.split(",");
      if (cols.length < 6) continue;

      const code = cols[1]?.trim() ?? "";
      if (!codes.has(code)) continue;

      const tier = parseInt(cols[2], 10);
      const proportion = parseFloatSafe(cols[5]);

      if (tier >= 12 && tier <= 15) {
        const entry = totals.get(code) ?? { chip: 0, major: 0 };
        entry.chip += proportion;
        if (tier === 15) entry.major = proportion;
        totals.set(code, entry);
      } else if (tier === 15) {
        const entry = totals.get(code) ?? { chip: 0, major: 0 };
        entry.major = proportion;
        totals.set(code, entry);
      }
    }
  }

  const metrics = new Map<string, TdccChipMetrics>();
  for (const [code, { chip, major }] of totals.entries()) {
    metrics.set(code, {
      code,
      date: snapshotYmd,
      chipConcentration: chip,
      majorHolderPct: major,
    });
  }

  return metrics;
}

export async function fetchTdccChipData(): Promise<{
  date: string;
  metrics: Map<string, TdccChipMetrics>;
}> {
  const latestYmd = await readFirstCsvRecordDate(true);
  if (!latestYmd) return { date: "", metrics: new Map() };

  const metrics = await fetchTdccChipMetricsForCodes(
    latestYmd,
    // fallback: keep previous behavior (all codes) is too heavy,
    // so we just seed with an empty map here.
    // Potential screening should use the dedicated function below.
    new Set<string>(),
  );

  snapshotHistory.set(latestYmd, metrics);
  return { date: latestYmd, metrics };
}

export function getHistoricalTdccSnapshot(
  minAgeDays = 20,
): TdccChipMetrics | null {
  if (snapshotHistory.size === 0) return null;

  // Keep an approximate: 20 days ≈ 3 weekly snapshots.
  const dates = Array.from(snapshotHistory.keys()).sort();
  if (dates.length < 4) return null;

  const latest = dates[dates.length - 1];
  const latestIdx = dates.indexOf(latest);
  const stepWeeks = Math.max(1, Math.floor(minAgeDays / 7));
  const prevIdx = Math.max(0, latestIdx - stepWeeks);
  const snapshot = snapshotHistory.get(dates[prevIdx]);
  if (!snapshot) return null;
  // Caller only needs one ticker's snapshot; this function isn't used
  // by our potential analyzer.
  return null;
}

export function findTdccComparisonSnapshot(
  currentDate: string,
): SnapshotStore | null {
  if (!currentDate || snapshotHistory.size < 2) return null;

  const dates = Array.from(snapshotHistory.keys()).sort();
  const currentIdx = dates.indexOf(currentDate);
  const targetIdx =
    currentIdx >= 0 ? Math.max(0, currentIdx - 3) : Math.max(0, dates.length - 4);

  if (targetIdx === currentIdx) return null;
  return snapshotHistory.get(dates[targetIdx]) ?? null;
}

export function compareTdccMetrics(
  current: TdccChipMetrics,
  previous: TdccChipMetrics,
): {
  chipChange: number;
  majorChange: number;
} {
  return {
    chipChange: current.chipConcentration - previous.chipConcentration,
    majorChange: current.majorHolderPct - previous.majorHolderPct,
  };
}

export function seedTdccSnapshot(
  date: string,
  metrics: Map<string, TdccChipMetrics>,
): void {
  snapshotHistory.set(date, metrics);
}

export function getTdccSnapshotCount(): number {
  return snapshotHistory.size;
}

interface TdccComparisonDateCache {
  latestDate: string;
  previousDate: string;
  expiresAt: number;
}

let comparisonDateCache: TdccComparisonDateCache | null = null;
const COMPARISON_DATE_CACHE_MS = 6 * 60 * 60 * 1000;

async function resolveTdccComparisonDates(): Promise<{
  latestDate: string;
  previousDate: string;
}> {
  if (
    comparisonDateCache &&
    comparisonDateCache.expiresAt > Date.now() &&
    comparisonDateCache.latestDate
  ) {
    return {
      latestDate: comparisonDateCache.latestDate,
      previousDate: comparisonDateCache.previousDate,
    };
  }

  const latestDate = await readFirstCsvRecordDate(true);
  if (!latestDate) {
    return { latestDate: "", previousDate: "" };
  }

  const latestD = ymdToDate(latestDate);
  if (!latestD) {
    return { latestDate, previousDate: "" };
  }

  // TDCC archive snapshots are weekly (typically Fridays). Step back in
  // weekly increments and allow +/- 2 days to align with actual files.
  let previousDate = "";
  const weeklyOffsets = [21, 14, 28, 35];

  outer: for (const offset of weeklyOffsets) {
    for (const dayAdjust of [0, -1, 1, -2, 2]) {
      const prev = new Date(latestD);
      prev.setDate(prev.getDate() - offset + dayAdjust);
      const candidate = dateToYmd(prev);
      const candidateUrl = archiveRawUrlForYmd(candidate);
      if (!candidateUrl) continue;

      const head = await fetch(candidateUrl, {
        method: "HEAD",
        headers: { "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (head.ok) {
        previousDate = candidate;
        break outer;
      }
    }
  }

  comparisonDateCache = {
    latestDate,
    previousDate,
    expiresAt: Date.now() + COMPARISON_DATE_CACHE_MS,
  };

  return { latestDate, previousDate };
}

export async function fetchTdccChipMetricsForCodesWithComparison(
  codes: Set<string>,
  _minAgeDays = 20,
): Promise<{
  latestDate: string;
  previousDate: string;
  latest: Map<string, TdccChipMetrics>;
  previous: Map<string, TdccChipMetrics>;
}> {
  if (codes.size === 0) {
    return {
      latestDate: "",
      previousDate: "",
      latest: new Map(),
      previous: new Map(),
    };
  }

  const { latestDate, previousDate } = await resolveTdccComparisonDates();
  if (!latestDate) {
    return {
      latestDate: "",
      previousDate: "",
      latest: new Map(),
      previous: new Map(),
    };
  }

  const [latest, previous] = await Promise.all([
    fetchTdccChipMetricsForCodes(latestDate, codes),
    previousDate
      ? fetchTdccChipMetricsForCodes(previousDate, codes)
      : Promise.resolve(new Map<string, TdccChipMetrics>()),
  ]);

  return { latestDate, previousDate, latest, previous };
}
