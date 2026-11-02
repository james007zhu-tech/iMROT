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
      publishedAt: date ? `${date}${time ? " " + time : ""}` : null,
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
    publishedAt: row.publishedAt ? new Date(row.publishedAt.replace(" ", "T") + "+08:00") : null,
  };
}

export async function fetchBocRates(fetchImpl: typeof fetch = fetch): Promise<BocRow[]> {
  const res = await fetchImpl("https://www.boc.cn/sourcedb/whpj/", { headers: { "user-agent": "DCiT-OS/0.1" } });
  if (!res.ok) throw new Error(`BoC fetch failed: ${res.status}`);
  return parseBocHtml(await res.text());
}

/** Convert an amount to CNY with a given per-unit rate; rounds to 2 dp (accounting). */
export function toCny(amount: number, rateToCny: number): number {
  return Math.round(amount * rateToCny * 100) / 100;
}
