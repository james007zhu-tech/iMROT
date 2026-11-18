import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can } from "@/lib/caps";
import { actorWith } from "./guard";
import { audit } from "./audit";
import { rateFor } from "./fx";

/**
 * 开票前成本认可 (朱总 2026-11-18). Sales may estimate a cost on the quote; what the invoice stands on is the real cost,
 * read from the system and recognised by finance or the MD:
 *   parts     — every OBTH issued to the order, at the latest receipt cost of that part before the issue (else its last cost)
 *   purchases — POTH written for the order: partner repair in full, and lines that never pass through stock (no part number)
 *   labour    — the hours on the order's RPTH / PMTH (hours written on the report, else start → finish), at the engineer's
 *               monthly gross ÷ 30 ÷ 8
 *   expenses  — approved expense claims booked to the order, without input VAT
 * Nothing here is typed by hand.
 */
export type CostRow = { ref: string; what: string; qty: number; unit: string; unitCost: number | null; amount: number; note?: string };
export type OrderCost = { parts: CostRow[]; purchases: CostRow[]; labour: CostRow[]; expenses: CostRow[]; partsTotal: number; purchasesTotal: number; labourTotal: number; expensesTotal: number; hours: number; total: number; missing: string[] };
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function orderCost(orderId: string): Promise<OrderCost> {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, select: { no: true, currency: true } });
  const missing: string[] = [];
  const toOrder = async (amount: number, currency: string, on: Date) => {
    if (currency === order.currency) return amount;
    const [a, b] = await Promise.all([rateFor(currency, on), rateFor(order.currency, on)]);
    if (!a || !b) { missing.push(`${currency}→${order.currency}`); return 0; }
    return r2((amount * a.rateToCny) / b.rateToCny);
  };

  const out = await prisma.stockMovement.findMany({ where: { serviceOrderId: orderId, direction: "OUT", kind: "PART", partId: { not: null } }, include: { part: { select: { id: true, sku: true, name: true, lastCost: true } } }, orderBy: [{ movedAt: "asc" }, { lineNo: "asc" }] });
  const parts: CostRow[] = [];
  for (const m of out) {
    const rec = await prisma.stockMovement.findFirst({ where: { partId: m.partId, direction: "IN", unitCost: { not: null }, movedAt: { lte: m.movedAt } }, orderBy: { movedAt: "desc" }, select: { unitCost: true, no: true } });
    const c = rec?.unitCost != null ? Number(rec.unitCost) : m.part?.lastCost != null ? Number(m.part.lastCost) : null;
    if (c == null) missing.push(`${m.no} ${m.part?.sku ?? ""}`);
    parts.push({ ref: m.no, what: `${m.part?.sku ?? ""} ${m.part?.name ?? ""}`.trim(), qty: Number(m.qty), unit: "pcs", unitCost: c, amount: r2(Number(m.qty) * (c ?? 0)), note: rec?.no });
  }

  const pos = await prisma.purchaseOrder.findMany({ where: { serviceOrderId: orderId, status: { in: ["SENT", "PARTIAL", "RECEIVED"] } }, include: { supplier: { select: { name: true } } }, orderBy: { orderedAt: "asc" } });
  const purchases: CostRow[] = [];
  for (const po of pos) {
    for (const l of po.lines as { description: string; partSku?: string; qty: number; unit?: string; unitPrice: number }[]) {
      if (po.kind !== "SUBCONTRACT" && l.partSku) continue; // stock parts are counted when they are issued (OBTH)
      const amount = await toOrder(r2(l.qty * l.unitPrice), po.currency, po.orderedAt);
      purchases.push({ ref: po.no, what: `${l.description} · ${po.supplier.name}`, qty: l.qty, unit: l.unit ?? "pcs", unitCost: r2(amount / (l.qty || 1)), amount, note: po.currency !== order.currency ? `${po.currency} ${r2(l.qty * l.unitPrice).toFixed(2)}` : undefined });
    }
  }

  const jobs = await prisma.repairJob.findMany({ where: { serviceOrderId: orderId }, include: { engineer: { select: { id: true, code: true, name: true } } }, orderBy: { startedAt: "asc" } });
  const labour: CostRow[] = [];
  for (const j of jobs) {
    const h = j.laborHours != null ? Number(j.laborHours) : j.startedAt && j.finishedAt ? Math.max(0, Math.round(((j.finishedAt.getTime() - j.startedAt.getTime()) / 3600000) * 100) / 100) : 0;
    if (h <= 0) { missing.push(`${j.no} 0h`); continue; }
    const sal = await prisma.salaryRecord.findFirst({ where: { employeeId: j.engineer.id, effectiveFrom: { lte: j.finishedAt ?? j.startedAt ?? new Date() } }, orderBy: { effectiveFrom: "desc" }, select: { grossMonthly: true, currency: true } });
    const rate = sal ? await toOrder(r2(Number(sal.grossMonthly) / 30 / 8), sal.currency, j.finishedAt ?? new Date()) : null;
    if (rate == null) missing.push(`${j.engineer.code} salary`);
    labour.push({ ref: j.no, what: `${j.engineer.code} ${j.engineer.name}`, qty: h, unit: "h", unitCost: rate, amount: r2(h * (rate ?? 0)), note: j.laborHours != null ? undefined : "start→finish" });
  }

  const claims = await prisma.expenseClaim.findMany({ where: { serviceOrderNo: order.no, status: { in: ["APPROVED", "PAID"] } }, orderBy: { createdAt: "asc" } });
  const expenses: CostRow[] = [];
  for (const c of claims) {
    const net = await toOrder(r2(Number(c.amount) - Number(c.vatAmount ?? 0)), c.currency, c.createdAt);
    expenses.push({ ref: c.receiptNo ?? c.id.slice(-6), what: c.vendor ?? "", qty: 1, unit: "", unitCost: net, amount: net });
  }
  const sum = (rows: CostRow[]) => r2(rows.reduce((s, r) => s + r.amount, 0));
  const partsTotal = sum(parts), purchasesTotal = sum(purchases), labourTotal = sum(labour), expensesTotal = sum(expenses);
  return { parts, purchases, labour, expenses, partsTotal, purchasesTotal, labourTotal, expensesTotal, hours: r2(labour.reduce((s, r) => s + r.qty, 0)), total: r2(partsTotal + purchasesTotal + labourTotal + expensesTotal), missing };
}

/** Finance or the MD recognises the cost the system shows. Kept on the order with who and when. */
export async function confirmOrderCost(input: { no: string; actorCode: string }) {
  const actor = await actorWith(input.actorCode, can.invoice, "COST_FINANCE_MD");
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, select: { id: true, no: true, costTotal: true } });
  const c = await orderCost(order.id);
  await prisma.serviceOrder.update({ where: { id: order.id }, data: { costActual: c.total, costDetail: c as unknown as Prisma.InputJsonValue, costConfirmedAt: new Date(), costConfirmedBy: actor.code } });
  await audit(actor.id, "COST_CONFIRMED", order.no, { total: c.total, parts: c.partsTotal, purchases: c.purchasesTotal, labour: c.labourTotal, hours: c.hours, expenses: c.expensesTotal, quoted: order.costTotal != null ? Number(order.costTotal) : null, missing: c.missing });
  return c;
}

/** Before an invoice is written: recognised, and still what the system shows (a later issue or purchase asks again). */
export async function assertCostConfirmed(order: { id: string; no: string; costConfirmedAt: Date | null; costActual: Prisma.Decimal | null }) {
  if (!order.costConfirmedAt) throw new Error(`COST_NOT_CONFIRMED:${order.no}`);
  const now = (await orderCost(order.id)).total;
  if (Math.abs(now - Number(order.costActual ?? 0)) > 0.005) throw new Error(`COST_CHANGED:${now.toFixed(2)}`);
}
