const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export interface MarginSnapshot {
  code: string;
  balance: number;
  previousBalance: number;
}

function parseIntSafe(value?: string): number {
  if (!value) return 0;
  const n = parseInt(value.replace(/,/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

async function fetchJson<T>(url: string, referer: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Referer: referer },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchTwseMargin(date: string): Promise<Map<string, number>> {
  const url = `https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?date=${date}&selectType=ALL&response=json`;
  const res = await fetchJson<{
    stat?: string;
    tables?: { title?: string; data?: string[][] }[];
  }>(url, "https://www.twse.com.tw/");

  const map = new Map<string, number>();
  if (res?.stat !== "OK" || !res.tables?.length) return map;

  const summary = res.tables.find((t) => t.title?.includes("彙總"));
  if (!summary?.data?.length) return map;

  for (const row of summary.data) {
    const code = row[0];
    const balance = parseIntSafe(row[6]);
    if (code && /^\d{4,6}$/.test(code)) {
      map.set(code, balance);
    }
  }

  return map;
}

async function fetchLatestTwseMargin(): Promise<{
  date: string;
  data: Map<string, number>;
}> {
  for (let offset = 0; offset <= 10; offset++) {
    const d = new Date();
    d.setDate(d.getDate() - offset);
    const date = westernYmd(d);
    const data = await fetchTwseMargin(date);
    if (data.size > 100) {
      return { date, data };
    }
  }
  return { date: westernYmd(new Date()), data: new Map() };
}

async function fetchTpexMargin(): Promise<Map<string, number>> {
  const url = "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance";
  const res = await fetchJson<
    {
      SecuritiesCompanyCode: string;
      MarginPurchaseBalance: string;
    }[]
  >(url, "https://www.tpex.org.tw/");

  const map = new Map<string, number>();
  if (!Array.isArray(res)) return map;

  for (const row of res) {
    const code = row.SecuritiesCompanyCode;
    const balance = parseIntSafe(row.MarginPurchaseBalance);
    if (code && /^\d{4,6}$/.test(code)) {
      map.set(code, balance);
    }
  }

  return map;
}

async function fetchTpexMarginOnRocDate(
  rocYmd: string,
): Promise<Map<string, number>> {
  const url = `https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance?d=${encodeURIComponent(
    rocYmd,
  )}`;
  const res = await fetchJson<
    {
      SecuritiesCompanyCode: string;
      MarginPurchaseBalance: string;
    }[]
  >(url, "https://www.tpex.org.tw/");

  const map = new Map<string, number>();
  if (!Array.isArray(res)) return map;

  for (const row of res) {
    const code = row.SecuritiesCompanyCode;
    const balance = parseIntSafe(row.MarginPurchaseBalance);
    if (code && /^\d{4,6}$/.test(code)) {
      map.set(code, balance);
    }
  }

  return map;
}

function rocDate(d: Date): string {
  const rocYear = d.getFullYear() - 1911;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${rocYear}${month}${day}`;
}

function westernYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function westernDateFromRoc(roc: string): string {
  if (!/^\d{8}$/.test(roc)) return roc;
  const year = parseInt(roc.slice(0, 4), 10) + 1911;
  return `${year}-${roc.slice(4, 6)}-${roc.slice(6, 8)}`;
}

export async function fetchMarginOnDate(
  date: string,
): Promise<Map<string, number>> {
  return fetchTwseMargin(date);
}

export async function fetchLatestMargins(): Promise<{
  current: Map<string, number>;
  previous: Map<string, number>;
  currentDate: string;
  previousDate: string;
}> {
  const twseLatest = await fetchLatestTwseMargin();
  const currentDate = twseLatest.date;
  const current = new Map<string, number>();

  const tpexCurrent = await fetchTpexMargin();
  for (const [code, balance] of twseLatest.data) current.set(code, balance);
  for (const [code, balance] of tpexCurrent) current.set(code, balance);

  let previous = new Map<string, number>();
  let previousDate = "";

  const baseDate = new Date(
    `${currentDate.slice(0, 4)}-${currentDate.slice(4, 6)}-${currentDate.slice(6, 8)}T00:00:00`,
  );

  // Prefer common ~1-month lookbacks first to avoid scanning every day.
  const previousOffsets = [
    22, 21, 23, 20, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35,
  ];
  for (const offset of previousOffsets) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() - offset);
    const date = westernYmd(d);
    const snapshot = await fetchTwseMargin(date);
    if (snapshot.size > 100) {
      previous = snapshot;
      previousDate = date;
      break;
    }
  }

  // TPEx tpex_mainboard_margin_balance supports query param "d" in ROC compact date.
  // Derive ROC compact date from TWSE western previousDate.
  if (previousDate) {
    const prevD = new Date(
      `${previousDate.slice(0, 4)}-${previousDate.slice(4, 6)}-${previousDate.slice(6, 8)}T00:00:00`,
    );
    if (!Number.isNaN(prevD.getTime())) {
      const prevRocCompact = rocDate(prevD);
      const tpexPrev = await fetchTpexMarginOnRocDate(prevRocCompact);
      for (const [code, balance] of tpexPrev) previous.set(code, balance);
    }
  }

  return { current, previous, currentDate, previousDate };
}

export function calcMarginChangePct(
  current: number,
  previous: number,
): number {
  if (previous <= 0) return 0;
  return ((current - previous) / previous) * 100;
}

export function marginPassesCondition(changePct: number): boolean {
  return changePct <= -5 && changePct >= -15;
}

export function getMarginBalance(
  margins: Map<string, number>,
  code: string,
): number {
  return margins.get(code) ?? 0;
}

export function formatRocDateLabel(roc: string): string {
  if (!/^\d{8}$/.test(roc)) return roc;
  return westernDateFromRoc(roc);
}
