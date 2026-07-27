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
  fetchedAt: number;
} | null = null;
let yesterdayVolumeCache: {
  data: Map<string, number>;
  fetchedAt: number;
} | null = null;

const CACHE_TTL_MS = 5 * 60 * 1000;

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

const TAIPEI_TIMEZONE = "Asia/Taipei";
const WEEKDAY_MAP: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

interface TaipeiDateTime {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  weekday: number;
}

function getTaipeiDateTime(d = new Date()): TaipeiDateTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TAIPEI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);

  const getPart = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekdayLabel = getPart("weekday");

  return {
    year: parseInt(getPart("year"), 10),
    month: parseInt(getPart("month"), 10),
    day: parseInt(getPart("day"), 10),
    hours: parseInt(getPart("hour"), 10),
    minutes: parseInt(getPart("minute"), 10),
    weekday: WEEKDAY_MAP[weekdayLabel] ?? -1,
  };
}

function rocDate(d = new Date()): string {
  const taipeiNow = getTaipeiDateTime(d);
  const rocYear = taipeiNow.year - 1911;
  const month = String(taipeiNow.month).padStart(2, "0");
  const day = String(taipeiNow.day).padStart(2, "0");
  return `${rocYear}${month}${day}`;
}

/** TWSE fund APIs (e.g. T86) expect western YYYYMMDD, not ROC. */
function westernYmd(d = new Date()): string {
  const taipeiNow = getTaipeiDateTime(d);
  const year = String(taipeiNow.year);
  const month = String(taipeiNow.month).padStart(2, "0");
  const day = String(taipeiNow.day).padStart(2, "0");
  return `${year}${month}${day}`;
}

function previousRocDate(d = new Date()): string {
  const prev = new Date(d.getTime() - 24 * 60 * 60 * 1000);
  return rocDate(prev);
}

async function fetchJson<T>(url: string, referer?: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Referer: referer ?? "https://mis.twse.com.tw/",
      },
      cache: "no-store",
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
      cache: "no-store",
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

function resolveLatestPrice(msg: RawStockMsg, yesterdayClose: number): number {
  // Prefer last deal price. When MIS returns "-" (no tick in snapshot),
  // fall back to best bid/ask — never day high, which would freeze the quote.
  const lastDeal = parseNum(msg.z);
  if (lastDeal > 0) return lastDeal;

  const bid = parsePrices(msg.b)[0] ?? 0;
  const ask = parsePrices(msg.a)[0] ?? 0;
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (bid > 0) return bid;
  if (ask > 0) return ask;

  return yesterdayClose > 0 ? yesterdayClose : 0;
}

function parseStockMsg(msg: RawStockMsg): StockInfo | null {
  const code = msg.c;
  const market = msg.ex as Market;
  if (!code || (market !== "tse" && market !== "otc")) return null;
  if (!/^\d{4,6}$/.test(code)) return null;

  const yesterdayClose = parseNum(msg.y);
  const price = resolveLatestPrice(msg, yesterdayClose);
  const change = yesterdayClose > 0 ? price - yesterdayClose : 0;
  const changePercent =
    yesterdayClose > 0 ? (change / yesterdayClose) * 100 : 0;
  // MIS 累積成交量單位為「張」，轉成股數以便與收盤資料比較
  const volumeLots = parseInt(msg.v ?? "0", 10) || 0;

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
    volume: volumeLots * 1000,
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
  const now = Date.now();
  if (
    yesterdayVolumeCache &&
    now - yesterdayVolumeCache.fetchedAt < CACHE_TTL_MS
  ) {
    return yesterdayVolumeCache.data;
  }

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

  yesterdayVolumeCache = { data: volumes, fetchedAt: now };
  return volumes;
}

function formatTpexDate(d = new Date()): string {
  const taipeiNow = getTaipeiDateTime(d);
  const rocYear = taipeiNow.year - 1911;
  const month = String(taipeiNow.month).padStart(2, "0");
  const day = String(taipeiNow.day).padStart(2, "0");
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

  // T86 fields (0-based):
  // 4 外陸資買賣超, 10 投信買賣超, 11 自營商買賣超(合計), 18 三大法人買賣超
  return res.data.map((row) =>
    parseInstitutionalRow(
      row[0]?.trim() ?? "",
      row[1] ?? "",
      parseInt((row[4] ?? "0").replace(/,/g, ""), 10) || 0,
      parseInt((row[10] ?? "0").replace(/,/g, ""), 10) || 0,
      parseInt((row[11] ?? "0").replace(/,/g, ""), 10) || 0,
      parseInt((row[18] ?? "0").replace(/,/g, ""), 10) || 0,
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
  const today = westernYmd();
  const now = Date.now();
  if (
    institutionalCache?.date === today &&
    now - institutionalCache.fetchedAt < CACHE_TTL_MS
  ) {
    return institutionalCache.data;
  }

  const data = new Map<string, InstitutionalData>();

  const twseToday = await fetchTwseInstitutional(today);
  if (twseToday.length > 0) {
    for (const row of twseToday) data.set(row.code, row);
  } else {
    // Today may be empty before T86 publishes (or on weekends/holidays).
    const fallbackDates: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      fallbackDates.push(westernYmd(d));
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
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const otcRows = await fetchOtcInstitutional(formatTpexDate(yesterday));
    for (const row of otcRows) data.set(row.code, row);
  }

  institutionalCache = { data, date: today, fetchedAt: now };
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

export async function fetchLatestQuotes(): Promise<{
  stocks: StockInfo[];
  tradeDate: string;
  dataSource: "realtime" | "daily";
}> {
  const list = await getStockList();
  if (list.length === 0) {
    const daily = await fetchDailyQuotes();
    return {
      stocks: daily,
      tradeDate: rocDate(),
      dataSource: "daily",
    };
  }

  const batches = chunk(list, 80);
  const results: StockInfo[] = [];
  let tradeDate = rocDate();

  for (const batch of batches) {
    const quotes = await fetchStockBatch(batch);
    results.push(...quotes);
    await delay(250);
  }

  // 若即時報價幾乎沒取到，退回收盤資料
  if (results.length < Math.min(50, list.length / 10)) {
    const daily = await fetchDailyQuotes();
    return {
      stocks: daily,
      tradeDate: rocDate(),
      dataSource: "daily",
    };
  }

  const probe = await fetchJson<{
    msgArray?: { d?: string }[];
  }>(`${MIS_BASE}?ex_ch=tse_2330.tw&json=1&delay=0&_=${Date.now()}`);
  if (probe?.msgArray?.[0]?.d) {
    tradeDate = probe.msgArray[0].d;
  }

  return {
    stocks: results,
    tradeDate,
    dataSource: "realtime",
  };
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
  const taipeiNow = getTaipeiDateTime();
  const day = taipeiNow.weekday;
  if (day === 0 || day === 6) return "closed";

  const { hours, minutes } = taipeiNow;
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
