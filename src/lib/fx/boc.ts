/**
 * Bank of China daily FX rates (外汇牌价) — the group's single conversion source (decision 2026-11-02).
 * Source page: https://www.boc.cn/sourcedb/whpj/  (HTML table; no official JSON API).
 * Columns: 货币名称 | 现汇买入价 | 现钞买入价 | 现汇卖出价 | 现钞卖出价 | 中行折算价 | 发布日期 | 发布时间
 * All prices are CNY per 100 units of foreign currency. We store rateToCny per 1 unit using 中行折算价.
 *
 * Parsing is pure (testable); fetching is a thin wrapper. Run daily via `npm run fx:fetch` (cron) or the job route.
 */

export interface BocRow {
  nameZh: string;
  currency: string; // ISO code mapped from the Chinese name
  buyRemit: number | null;
  buyCash: number | null;
  sellRemit: number | null;
  sellCash: number | null;
  middle: number | null; // 中行折算价 per 100
  publishedAt: string | null; // "YYYY-MM-DD HH:mm:ss"
}

/** Chinese names as printed by BoC → ISO code. Extend when a new currency appears. */
export const BOC_NAME_TO_ISO: Record<string, string> = {
  泰国铢: "THB",
  美元: "USD",
  欧元: "EUR",
  港币: "HKD",
  日元: "JPY",
  英镑: "GBP",
  新加坡元: "SGD",
  澳大利亚元: "AUD",
  加拿大元: "CAD",
  瑞士法郎: "CHF",
  韩国元: "KRW",
  马来西亚林吉特: "MYR",
  印尼卢比: "IDR",
  菲律宾比索: "PHP",
  越南盾: "VND",
  新台币: "TWD",
  澳门元: "MOP",
  新西兰元: "NZD",
  俄罗斯卢布: "RUB",
  阿联酋迪拉姆: "AED",
  沙特里亚尔: "SAR",
  印度卢比: "INR",
};

const num = (s: string): number | null => {
  const t = s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, "").trim();
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
};
const text = (s: string) => s.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();

/**
 * BoC has printed the publish time as "2026.11.05" + "08:29:39" in two cells, and (since ~2026-11) as
 * "2026/11/05 08:29:39" in the date cell plus the time again. Normalise any of these to "YYYY-MM-DD HH:mm:ss".
 */
export function normalizeBocTime(dateCell: string, timeCell = ""): string | null {
  const d = /(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(dateCell);
  if (!d) return null;
  const t = /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(dateCell.slice(d.index + d[0].length)) ?? /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(timeCell);
  const p = (x: string | undefined) => (x ?? "0").padStart(2, "0");
  return `${d[1]}-${p(d[2])}-${p(d[3])}${t ? ` ${p(t[1])}:${t[2]}:${p(t[3])}` : ""}`;
}

/** "YYYY-MM-DD[ HH:mm:ss]" in Beijing time → Date; null when it cannot be read (never an Invalid Date). */
export function bocDate(s: string | null): Date | null {
  const n = s ? normalizeBocTime(s) : null;
  if (!n) return null;
  const d = new Date(`${n.replace(" ", "T")}${n.length > 10 ? "" : "T00:00:00"}+08:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse the whpj HTML into rows. Tolerates attribute noise and whitespace. */
export function parseBocHtml(html: string): BocRow[] {
  const rows: BocRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => c[1]);
    if (cells.length < 7) continue;
    const nameZh = text(cells[0]);
    const currency = BOC_NAME_TO_ISO[nameZh];
    if (!currency) continue;
    const date = text(cells[6]);
    const time = cells[7] ? text(cells[7]) : "";
    rows.push({
      nameZh,
      currency,
      buyRemit: num(cells[1]),
      buyCash: num(cells[2]),
      sellRemit: num(cells[3]),
      sellCash: num(cells[4]),
      middle: num(cells[5]),
      publishedAt: normalizeBocTime(date, time),
    });
  }
  return rows;
}

/** Convert a BoC row into the FxRate record shape (per 1 unit). */
export function toFxRate(row: BocRow, rateDate: Date) {
  if (row.middle == null) throw new Error(`No 中行折算价 for ${row.currency}`);
  return {
    rateDate,
    currency: row.currency,
    rateToCny: row.middle / 100,
    buyRemit: row.buyRemit,
    sellRemit: row.sellRemit,
    source: "BOC",
    publishedAt: bocDate(row.publishedAt),
  };
}

/**
 * The BoC site is slow from Thailand and sometimes times out (trial 2026-11-05: ETIMEDOUT, no rates at all).
 * Each attempt gets 25 s; three attempts with a short pause; the error names the last cause.
 */
export async function fetchBocRates(fetchImpl: typeof fetch = fetch, attempts = 3, pauseMs = 3000): Promise<BocRow[]> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetchImpl("https://www.boc.cn/sourcedb/whpj/", { headers: { "user-agent": "Mozilla/5.0 (DCiT-OS)", accept: "text/html" }, signal: AbortSignal.timeout(25000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseBocHtml(await res.text());
      if (rows.length) return rows;
      throw new Error("no rate table in the page");
    } catch (e) {
      last = e;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, pauseMs));
    }
  }
  throw new Error(`BoC fetch failed after ${attempts} attempts: ${(last as Error)?.message ?? last}`);
}

/** Convert an amount to CNY with a given per-unit rate; rounds to 2 dp (accounting). */
export function toCny(amount: number, rateToCny: number): number {
  return Math.round(amount * rateToCny * 100) / 100;
}
