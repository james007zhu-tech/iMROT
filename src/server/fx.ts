/**
 * Bank of China rates in the database (decision: fetched automatically, never typed in).
 * `refreshBocRates` is what the daily job, the admin button and the stale-rate auto refresh all call.
 */
import { localIso } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { fetchBocRates, toFxRate } from "@/lib/fx/boc";
import { audit } from "@/server/audit";
import { can, hasRole } from "@/lib/caps";
import { Prisma } from "@prisma/client";

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

export type Rate = { rateToCny: number; rateDate: Date; source: "BOC" | "MANUAL" | "CNY"; note?: string | null; setBy?: string | null; setAt?: Date | null };
const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * The booking rate (MD 2026-11-17 18:29: 中国银行价, not Kasikorn). The newest rate on or before the day; on the same
 * day a rate set by finance (MANUAL) stands in front of the fetched one. Every document keeps the rate, its day and
 * its source, and shows them: "中国银行价 2026-11-17" / "财务手工价 2026-11-17".
 */
export async function rateFor(currency: string, onOrBefore: Date = new Date()): Promise<Rate | null> {
  if (currency === "CNY") return { rateToCny: 1, rateDate: utcDay(onOrBefore), source: "CNY" };
  const r = await prisma.fxRate.findFirst({ where: { currency, rateDate: { lte: onOrBefore } }, orderBy: [{ rateDate: "desc" }, { source: "desc" }] }); // MANUAL before BOC
  return r ? { rateToCny: Number(r.rateToCny), rateDate: r.rateDate, source: r.source === "MANUAL" ? "MANUAL" : "BOC", note: r.note, setBy: r.setBy, setAt: r.source === "MANUAL" ? r.fetchedAt : null } : null;
}
/** The same, for writing a document today: when today's rate is not in yet, it is fetched first (a few seconds at most). */
export async function rateForNew(currency: string): Promise<Rate | null> {
  if (currency === "CNY") return rateFor(currency);
  const today = utcDay(new Date());
  let r = await rateFor(currency);
  if (!r || r.rateDate.getTime() < today.getTime()) {
    if (!running && Date.now() - lastTry > 10 * 60000) { lastTry = Date.now(); running = refreshBocRates().catch((e) => console.error("[fx] refresh failed:", (e as Error).message)).finally(() => { running = null; }); }
    if (running) await Promise.race([running, new Promise((ok) => setTimeout(ok, 6000))]);
    r = await rateFor(currency);
  }
  return r;
}
/** What a document stores about its rate. */
export const fxFields = (r: Rate | null | undefined) => (r ? { fxRateToCny: r.rateToCny, fxRateDate: r.rateDate, fxSource: r.source === "CNY" ? "BOC" : r.source, fxBy: r.source === "MANUAL" ? `${r.setBy ?? ""} ${r.setAt ? localIso(r.setAt)!.slice(0, 16).replace("T", " ") : ""}`.trim() : null } : {});

/**
 * 财务手工覆盖 — finance (or the MD) sets the rate of a day by hand, with a reason. It stands in front of the Bank of
 * China rate of that day for documents written from then on; documents already written keep the rate they were written
 * with. Every override and every removal is in the audit log with the Bank of China rate it replaced.
 */
export async function overrideRate(input: { actorCode: string; currency: string; rateDate: Date; rateToCny: number; note: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!can.finance(actor)) throw new Error("NO_PERMISSION");
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency) || currency === "CNY") throw new Error("FX_CURRENCY");
  if (!(input.rateToCny > 0)) throw new Error("FX_RATE_REQUIRED");
  if (!input.note?.trim()) throw new Error("REASON_REQUIRED");
  const rateDate = utcDay(input.rateDate);
  if (rateDate.getTime() > utcDay(new Date()).getTime()) throw new Error("FX_FUTURE");
  const boc = await prisma.fxRate.findFirst({ where: { currency, source: "BOC", rateDate: { lte: rateDate } }, orderBy: { rateDate: "desc" } });
  const was = await prisma.fxRate.findUnique({ where: { rateDate_currency_source: { rateDate, currency, source: "MANUAL" } } });
  const row = await prisma.fxRate.upsert({ where: { rateDate_currency_source: { rateDate, currency, source: "MANUAL" } },
    update: { rateToCny: input.rateToCny, setBy: actor.code, note: input.note.trim(), fetchedAt: new Date() },
    create: { rateDate, currency, source: "MANUAL", rateToCny: input.rateToCny, setBy: actor.code, note: input.note.trim() } });
  await audit(actor.id, "FX_OVERRIDE", `${currency} ${localIso(rateDate)!.slice(0, 10)}`, { rate: input.rateToCny, boc: boc ? Number(boc.rateToCny) : null, bocDate: boc ? localIso(boc.rateDate)!.slice(0, 10) : null, before: was ? Number(was.rateToCny) : null, note: input.note.trim() });
  return row;
}
export async function removeOverride(input: { actorCode: string; id: string; note: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!can.finance(actor)) throw new Error("NO_PERMISSION");
  if (!input.note?.trim()) throw new Error("REASON_REQUIRED");
  const r = await prisma.fxRate.findUniqueOrThrow({ where: { id: input.id } });
  if (r.source !== "MANUAL") throw new Error("FX_NOT_MANUAL");
  await prisma.fxRate.delete({ where: { id: r.id } });
  await audit(actor.id, "FX_OVERRIDE_REMOVED", `${r.currency} ${localIso(r.rateDate)!.slice(0, 10)}`, { rate: Number(r.rateToCny), setBy: r.setBy, note: input.note.trim() });
}

/** Latest stored rate for a currency (CNY is 1), with its age in days. */
export async function latestRate(currency: string) {
  if (currency === "CNY") return { rateToCny: 1, rateDate: new Date(), ageDays: 0, source: "CNY" };
  const r = await rateFor(currency);
  if (!r) return null;
  return { rateToCny: r.rateToCny, rateDate: r.rateDate, ageDays: Math.floor((Date.now() - r.rateDate.getTime()) / 86400000), source: r.source };
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

/**
 * 单据上改汇率 (派修单 v4 B): finance sets the rate of one quote or one purchase order by hand — the bank's actual
 * rate, a rate agreed in the contract — with a reason. The document then says 手动, who and when; the CNY total follows;
 * the change, the rate before and the Bank of China rate of the day are in the audit log.
 */
export const FX_REASONS = ["bank", "contract", "other"] as const;
export const FX_MD_THRESHOLD = 0.02;
/** The Bank of China rate a hand-set rate is measured against: the day's, or the last published before it (the date says which). */
export async function bocFor(currency: string, on: Date = new Date()) {
  const r = await prisma.fxRate.findFirst({ where: { currency, source: "BOC", rateDate: { lte: on } }, orderBy: { rateDate: "desc" } });
  return r ? { rate: Number(r.rateToCny), date: localIso(r.rateDate)!.slice(0, 10) } : null;
}
export const fxDiff = (rate: number, boc: number | null | undefined) => (boc && boc > 0 ? Math.abs(rate - boc) / boc : 0);
export type FxPending = { rate: number; boc: number; bocDate: string; diffPct: number; reason: string; by: string; at: string };
/**
 * 派修单 v5 P1-2 (MD Q3). The rate of an order is what its 开票单 (IVTH / TITH) is written at. Up to 2 % off the Bank of
 * China rate a hand-set rate takes effect at once, with its trace. Beyond that it waits for the MD: nothing changes on
 * the order, it carries 汇率待 MD 批准, and no tax invoice is issued until the MD has decided. A purchase order has no
 * threshold — its payment goes to the MD anyway (P1-3). The global rate table is never touched from here.
 */
export async function overrideDocRate(input: { kind: "order" | "po"; no: string; actorCode: string; rateToCny: number; reason: string }): Promise<"saved" | "pending"> {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!can.finance(actor)) throw new Error("NO_PERMISSION");
  if (!(input.rateToCny > 0)) throw new Error("FX_RATE_REQUIRED");
  if (!input.reason?.trim()) throw new Error("REASON_REQUIRED");
  const doc = input.kind === "order" ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, select: { id: true, currency: true, total: true, fxRateToCny: true, fxRateDate: true } }) : await prisma.purchaseOrder.findUniqueOrThrow({ where: { no: input.no }, select: { id: true, currency: true, total: true, fxRateToCny: true, fxRateDate: true } });
  if (doc.currency === "CNY") throw new Error("FX_CURRENCY");
  if (input.kind === "order" && (await prisma.taxInvoice.count({ where: { serviceOrderId: doc.id, voidedAt: null } }))) throw new Error(`FX_ISSUED:${input.no}`); // an issued tax invoice is not re-rated: void and re-issue
  const boc = await bocFor(doc.currency);
  const now = new Date(), by = `${actor.code} ${localIso(now)!.slice(0, 16).replace("T", " ")}`;
  if (input.kind === "order" && boc && fxDiff(input.rateToCny, boc.rate) > FX_MD_THRESHOLD + 1e-9) {
    const pending: FxPending = { rate: input.rateToCny, boc: boc.rate, bocDate: boc.date, diffPct: Math.round(fxDiff(input.rateToCny, boc.rate) * 10000) / 100, reason: input.reason.trim(), by, at: now.toISOString() };
    await prisma.serviceOrder.update({ where: { id: doc.id }, data: { fxPending: pending as unknown as Prisma.InputJsonValue } });
    await audit(actor.id, "FX_DOC_PENDING", input.no, { currency: doc.currency, current: doc.fxRateToCny != null ? Number(doc.fxRateToCny) : null, ...pending });
    return "pending";
  }
  const data = { fxRateToCny: input.rateToCny, fxRateDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), fxSource: "MANUAL", fxBy: by, totalCny: doc.total != null ? Math.round(Number(doc.total) * input.rateToCny * 100) / 100 : undefined };
  if (input.kind === "order") await prisma.serviceOrder.update({ where: { id: doc.id }, data: { ...data, fxPending: Prisma.DbNull } }); else await prisma.purchaseOrder.update({ where: { id: doc.id }, data });
  await audit(actor.id, "FX_DOC_OVERRIDE", input.no, { currency: doc.currency, before: doc.fxRateToCny != null ? Number(doc.fxRateToCny) : null, rate: input.rateToCny, boc: boc?.rate ?? null, bocDate: boc?.date ?? null, note: input.reason.trim() });
  return "saved";
}
/** The MD decides on a rate that waits (more than 2 % off): approved → it becomes the order's rate; refused → dropped. Both are kept. */
export async function decideDocRate(input: { no: string; actorCode: string; approve: boolean; note?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!hasRole(actor, "MD")) throw new Error("MD_ONLY");
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, select: { id: true, currency: true, total: true, fxRateToCny: true, fxPending: true } });
  const p = o.fxPending as FxPending | null;
  if (!p) throw new Error("FX_NOT_WAITING");
  if (!input.approve && !input.note?.trim()) throw new Error("REASON_REQUIRED");
  const now = new Date();
  await prisma.serviceOrder.update({ where: { id: o.id }, data: input.approve
    ? { fxRateToCny: p.rate, fxRateDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), fxSource: "MANUAL", fxBy: p.by, totalCny: o.total != null ? Math.round(Number(o.total) * p.rate * 100) / 100 : undefined, fxPending: Prisma.DbNull }
    : { fxPending: Prisma.DbNull } });
  if (input.approve) await audit(actor.id, "FX_DOC_OVERRIDE", input.no, { currency: o.currency, before: o.fxRateToCny != null ? Number(o.fxRateToCny) : null, rate: p.rate, boc: p.boc, bocDate: p.bocDate, note: p.reason, approvedBy: actor.code, diffPct: p.diffPct });
  await audit(actor.id, input.approve ? "FX_DOC_APPROVED" : "FX_DOC_REJECTED", input.no, { rate: p.rate, boc: p.boc, diffPct: p.diffPct, askedBy: p.by, note: input.note?.trim() || null });
}
/** What the yellow line on a hand-rated document says: the rate, the Bank of China rate it stands in for, who and when, why. */
export async function docRateNote(no: string, d: { currency: string; fxSource: string | null; fxRateToCny: unknown; fxBy: string | null }) {
  if (d.fxSource !== "MANUAL" || d.fxRateToCny == null) return null;
  const log = await prisma.auditLog.findFirst({ where: { action: "FX_DOC_OVERRIDE", target: no }, orderBy: { at: "desc" } });
  const det = (log?.detail ?? {}) as { boc?: number | null; before?: number | null; note?: string };
  return { rate: Number(d.fxRateToCny), boc: det.boc ?? null, before: det.before ?? null, by: d.fxBy ?? "", why: det.note ?? "" };
}
