/**
 * Bank of China rates in the database (decision: fetched automatically, never typed in).
 * `refreshBocRates` is what the daily job, the admin button and the stale-rate auto refresh all call.
 */
import { localIso } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { fetchBocRates, toFxRate } from "@/lib/fx/boc";

export async function refreshBocRates(): Promise<{ rateDate: string; count: number }> {
  const rows = await fetchBocRates();
  const today = new Date();
  const rateDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  let count = 0;
  for (const row of rows) {
    if (row.middle == null) continue;
    const fx = toFxRate(row, rateDate);
    await prisma.fxRate.upsert({
      where: { rateDate_currency_source: { rateDate, currency: fx.currency, source: "BOC" } },
      update: { rateToCny: fx.rateToCny, buyRemit: fx.buyRemit ?? undefined, sellRemit: fx.sellRemit ?? undefined, publishedAt: fx.publishedAt ?? undefined, fetchedAt: new Date() },
      create: { ...fx, buyRemit: fx.buyRemit ?? undefined, sellRemit: fx.sellRemit ?? undefined, publishedAt: fx.publishedAt ?? undefined },
    });
    count++;
  }
  return { rateDate: localIso(rateDate)!.slice(0, 10), count };
}

/** Latest stored rate for a currency (CNY is 1), with its age in days. */
export async function latestRate(currency: string) {
  if (currency === "CNY") return { rateToCny: 1, rateDate: new Date(), ageDays: 0, source: "CNY" };
  const r = await prisma.fxRate.findFirst({ where: { currency }, orderBy: { rateDate: "desc" } });
  if (!r) return null;
  return { rateToCny: Number(r.rateToCny), rateDate: r.rateDate, ageDays: Math.floor((Date.now() - r.rateDate.getTime()) / 86400000), source: r.source };
}

// Pages that need a rate start a refresh in the background when the newest one is over a day old,
// so a missed daily job heals itself. One attempt at a time, at most every 30 minutes per server process.
let running: Promise<unknown> | null = null;
let lastTry = 0;
export function refreshIfStale(ageDays: number | null | undefined) {
  if (ageDays != null && ageDays < 1) return;
  if (running || Date.now() - lastTry < 30 * 60000) return;
  lastTry = Date.now();
  running = refreshBocRates().catch((e) => console.error("[fx] auto refresh failed:", (e as Error).message)).finally(() => { running = null; });
}
