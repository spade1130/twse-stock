import type { InstitutionalData, Market, StockInfo } from "@/types/stock";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

const MIS_BASE = "https://mis.twse.com.tw/stock/api/getStockInfo.jsp";

interface RawStockMsg {
  c?: string;
  n?: string;
  ex?: string;
  z?: string;
  o?: string;
  h?: string;
  l?: string;
  y?: string;
  u?: string;
  w?: string;
  v?: string;
  g?: string;
  f?: string;
  b?: string;
  a?: string;
  ip?: string;
  t?: string;
}

interface StockCodeEntry {
  code: string;
  market: Market;
}

let stockListCache: { data: StockCodeEntry[]; fetchedAt: number } | null = null;
let institutionalCache: {
  data: Map<string, InstitutionalData>;
  date: string;
} | null = null;
let yesterdayVolumeCache: Map<string, number> | null = null;

function parseNum(value?: string): number {
  if (!value || value === "-" || value === "") return 0;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function parseVolumes(value?: string): number[] {
  if (!value || value === "-") return [];
  return value
    .split("_")
    .filter(Boolean)
    .map((v) => parseInt(v, 10))
    .filter((n) => Number.isFinite(n));
}

function parsePrices(value?: string): number[] {
  if (!value || value === "-") return [];
  return value
    .split("_")
    .filter(Boolean)
    .map((v) => parseFloat(v))
    .filter((n) => Number.isFinite(n));
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rocDate(d = new Date()): string {
  const rocYear = d.getFullYear() - 1911;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${rocYear}${month}${day}`;
}

function previousRocDate(d = new Date()): string {
  const prev = new Date(d);
  prev.setDate(prev.getDate() - 1);
  return rocDate(prev);
}

async function fetchJson<T>(url: string, referer?: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: referer ?? "https://mis.twse.com.tw/",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: "https://www.twse.com.tw/",
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function parseTwseCsv(text: string): string[][] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  return lines.slice(1).map((line) => {
    const cols: string[] = [];
    let current = "";
    let inQuotes = false;

    for (const ch of line) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cols.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    cols.push(current);
    return cols;
  });
}

async function fetchTwseDayAll(): Promise<string[][]> {
  const text = await fetchText(
    "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json",
  );
  if (!text) return [];
  return parseTwseCsv(text);
}

function parseStockMsg(msg: RawStockMsg): StockInfo | null {
  const code = msg.c;
  const market = msg.ex as Market;
  if (!code || (market !== "tse" && market !== "otc")) return null;
  if (!/^\d{4,6}$/.test(code)) return null;

  const yesterdayClose = parseNum(msg.y);
  const price = parseNum(msg.z) || parseNum(msg.h) || yesterdayClose;
  const change = yesterdayClose > 0 ? price - yesterdayClose : 0;
  const changePercent =
    yesterdayClose > 0 ? (change / yesterdayClose) * 100 : 0;

  return {
    code,
    name: msg.n ?? code,
    market,
    price,
    open: parseNum(msg.o),
    high: parseNum(msg.h),
    low: parseNum(msg.l),
    yesterdayClose,
    limitUp: parseNum(msg.u),
    limitDown: parseNum(msg.w),
    change,
    changePercent,
    volume: parseInt(msg.v ?? "0", 10) || 0,
    buyVolumes: parseVolumes(msg.g),
    sellVolumes: parseVolumes(msg.f),
    buyPrices: parsePrices(msg.b),
    sellPrices: parsePrices(msg.a),
    trendFlag: msg.ip ?? "0",
    updateTime: msg.t ?? "",
  };
}

export async function getStockList(): Promise<StockCodeEntry[]> {
  const now = Date.now();
  if (stockListCache && now - stockListCache.fetchedAt < 24 * 60 * 60 * 1000) {
    return stockListCache.data;
  }

  const stocks: StockCodeEntry[] = [];

  const twseRows = await fetchTwseDayAll();
  for (const row of twseRows) {
    const code = row[1];
    if (code && /^\d{4,6}$/.test(code)) {
      stocks.push({ code, market: "tse" });
    }
  }

  const tpexRes = await fetchJson<
    { SecuritiesCompanyCode: string }[]
  >("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes");

  if (Array.isArray(tpexRes)) {
    for (const item of tpexRes) {
      const code = item.SecuritiesCompanyCode;
      if (code && /^\d{4,6}$/.test(code)) {
        stocks.push({ code, market: "otc" });
      }
    }
  }

  const unique = new Map<string, StockCodeEntry>();
  for (const s of stocks) {
    unique.set(`${s.market}_${s.code}`, s);
  }

  stockListCache = { data: Array.from(unique.values()), fetchedAt: now };
  return stockListCache.data;
}

export async function getYesterdayVolumes(): Promise<Map<string, number>> {
  if (yesterdayVolumeCache) return yesterdayVolumeCache;

  const volumes = new Map<string, number>();

  const twseRows = await fetchTwseDayAll();
  for (const row of twseRows) {
    const code = row[1];
    const vol = parseInt((row[3] ?? "0").replace(/,/g, ""), 10);
    if (code) volumes.set(code, vol || 0);
  }

  const tpexRes = await fetchJson<
    { SecuritiesCompanyCode: string; TradingShares: string }[]
  >("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes");

  if (Array.isArray(tpexRes)) {
    for (const item of tpexRes) {
      const vol = parseInt(
        (item.TradingShares ?? "0").replace(/,/g, ""),
        10,
      );
      volumes.set(item.SecuritiesCompanyCode, vol || 0);
    }
  }

  yesterdayVolumeCache = volumes;
  return volumes;
}

function formatTpexDate(d = new Date()): string {
  const rocYear = d.getFullYear() - 1911;
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${rocYear}/${month}/${day}`;
}

function parseInstitutionalRow(
  code: string,
  name: string,
  foreignNet: number,
  trustNet: number,
  dealerNet: number,
  totalNet: number,
): InstitutionalData {
  return {
    code,
    name: name.trim(),
    foreignNet,
    trustNet,
    dealerNet,
    totalNet,
  };
}

async function fetchTwseInstitutional(date: string): Promise<InstitutionalData[]> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${date}&selectType=ALL`;
  const res = await fetchJson<{
    stat?: string;
    data?: string[][];
  }>(url, "https://www.twse.com.tw/");

  if (res?.stat !== "OK" || !res.data?.length) return [];

  return res.data.map((row) =>
    parseInstitutionalRow(
      row[0],
      row[1] ?? "",
      parseInt((row[4] ?? "0").replace(/,/g, ""), 10) || 0,
      parseInt((row[10] ?? "0").replace(/,/g, ""), 10) || 0,
      parseInt((row[14] ?? "0").replace(/,/g, ""), 10) || 0,
      parseInt((row[17] ?? "0").replace(/,/g, ""), 10) || 0,
    ),
  );
}

async function fetchOtcInstitutional(date: string): Promise<InstitutionalData[]> {
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&o=json&se=EW&t=D&d=${encodeURIComponent(date)}&s=0,asc`;
  const res = await fetchJson<{
    tables?: { data?: string[][] }[];
  }>(url, "https://www.tpex.org.tw/");

  const rows = res?.tables?.[0]?.data;
  if (!rows?.length) return [];

  return rows
    .filter((row) => row[0] && /^\d{4,6}$/.test(row[0]))
    .map((row) =>
      parseInstitutionalRow(
        row[0],
        row[1] ?? "",
        parseInt((row[7] ?? "0").replace(/,/g, ""), 10) || 0,
        parseInt((row[10] ?? "0").replace(/,/g, ""), 10) || 0,
        parseInt((row[16] ?? "0").replace(/,/g, ""), 10) || 0,
        parseInt((row[23] ?? "0").replace(/,/g, ""), 10) || 0,
      ),
    );
}

export async function getInstitutionalData(): Promise<
  Map<string, InstitutionalData>
> {
  const today = rocDate();
  if (institutionalCache?.date === today) {
    return institutionalCache.data;
  }

  const data = new Map<string, InstitutionalData>();

  const twseToday = await fetchTwseInstitutional(today);
  if (twseToday.length > 0) {
    for (const row of twseToday) data.set(row.code, row);
  } else {
    const fallbackDates = [previousRocDate()];
    for (let i = 0; i < 3; i++) {
      const d = new Date();
      d.setDate(d.getDate() - (i + 2));
      fallbackDates.push(rocDate(d));
    }
    for (const date of [...new Set(fallbackDates)]) {
      const rows = await fetchTwseInstitutional(date);
      if (rows.length > 0) {
        for (const row of rows) data.set(row.code, row);
        break;
      }
    }
  }

  const otcToday = await fetchOtcInstitutional(formatTpexDate());
  if (otcToday.length > 0) {
    for (const row of otcToday) data.set(row.code, row);
  } else {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const otcRows = await fetchOtcInstitutional(formatTpexDate(yesterday));
    for (const row of otcRows) data.set(row.code, row);
  }

  institutionalCache = { data, date: today };
  return data;
}

async function fetchStockBatch(
  entries: StockCodeEntry[],
): Promise<StockInfo[]> {
  const exCh = entries
    .map((e) => `${e.market}_${e.code}.tw`)
    .join("%7C");

  const url = `${MIS_BASE}?ex_ch=${exCh}&json=1&delay=0&_=${Date.now()}`;
  const res = await fetchJson<{ msgArray?: RawStockMsg[]; rtcode?: string }>(
    url,
  );

  if (!res?.msgArray) return [];
  return res.msgArray
    .map(parseStockMsg)
    .filter((s): s is StockInfo => s !== null);
}

export async function fetchDailyQuotes(): Promise<StockInfo[]> {
  const stocks: StockInfo[] = [];

  const twseRows = await fetchTwseDayAll();
  for (const row of twseRows) {
    const code = row[1];
    if (!code || !/^\d{4,6}$/.test(code)) continue;

    const close = parseNum(row[8]);
    const change = parseNum(row[9]);
    const prevClose = close - change;
    if (prevClose <= 0) continue;

    stocks.push({
      code,
      name: row[2] ?? code,
      market: "tse",
      price: close,
      open: parseNum(row[5]),
      high: parseNum(row[6]),
      low: parseNum(row[7]),
      yesterdayClose: prevClose,
      limitUp: Math.round(prevClose * 1.1 * 100) / 100,
      limitDown: Math.round(prevClose * 0.9 * 100) / 100,
      change,
      changePercent: (change / prevClose) * 100,
      volume: parseInt((row[3] ?? "0").replace(/,/g, ""), 10) || 0,
      buyVolumes: [],
      sellVolumes: [],
      buyPrices: [],
      sellPrices: [],
      trendFlag: "0",
      updateTime: "",
    });
  }

  const tpexRes = await fetchJson<
    {
      SecuritiesCompanyCode: string;
      CompanyName: string;
      Close: string;
      Change: string;
      Open: string;
      High: string;
      Low: string;
      TradingShares: string;
      NextLimitUp: string;
      NextLimitDown: string;
    }[]
  >("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes");

  if (Array.isArray(tpexRes)) {
    for (const item of tpexRes) {
      const code = item.SecuritiesCompanyCode;
      if (!code || !/^\d{4,6}$/.test(code)) continue;

      const close = parseNum(item.Close);
      const change = parseNum(item.Change.replace(/[+,\s]/g, ""));
      const prevClose = close - change;
      if (prevClose <= 0) continue;

      stocks.push({
        code,
        name: item.CompanyName ?? code,
        market: "otc",
        price: close,
        open: parseNum(item.Open),
        high: parseNum(item.High),
        low: parseNum(item.Low),
        yesterdayClose: prevClose,
        limitUp: parseNum(item.NextLimitUp),
        limitDown: parseNum(item.NextLimitDown),
        change,
        changePercent: (change / prevClose) * 100,
        volume:
          parseInt((item.TradingShares ?? "0").replace(/,/g, ""), 10) || 0,
        buyVolumes: [],
        sellVolumes: [],
        buyPrices: [],
        sellPrices: [],
        trendFlag: "0",
        updateTime: "",
      });
    }
  }

  return stocks;
}

export async function fetchStockQuotes(
  codes: { code: string; market: Market }[],
): Promise<StockInfo[]> {
  const entries: StockCodeEntry[] = codes.map((c) => ({
    code: c.code,
    market: c.market,
  }));
  const batches = chunk(entries, 60);
  const results: StockInfo[] = [];

  for (const batch of batches) {
    results.push(...(await fetchStockBatch(batch)));
    if (batches.length > 1) await delay(200);
  }

  return results;
}

export function getMarketStatus(): "open" | "closed" | "unknown" {
  const now = new Date();
  const day = now.getDay();
  if (day === 0 || day === 6) return "closed";

  const hours = now.getHours();
  const minutes = now.getMinutes();
  const time = hours * 60 + minutes;

  const morningOpen = 9 * 60;
  const morningClose = 13 * 60 + 30;
  const afternoonOpen = 14 * 60;
  const afternoonClose = 14 * 60 + 30;

  if (
    (time >= morningOpen && time <= morningClose) ||
    (time >= afternoonOpen && time <= afternoonClose)
  ) {
    return "open";
  }
  return "closed";
}
