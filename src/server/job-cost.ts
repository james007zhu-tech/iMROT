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

/**
 * 逐行「预估 → 真实」 (派修单 v5 P0-2, MD Q7). Every quote line gets its real cost before the invoice:
 *   · a line with a part number — what was issued to the order for that part (OBTH); nothing issued → the system
 *     cost the quote already carried (last purchase price);
 *   · a line Sales estimated — finance or the MD says which system record replaces the estimate: the hours on the
 *     reports, one purchase line, one expense claim, or "nothing was spent". Until every estimate is replaced the
 *     cost cannot be recognised and no invoice is written.
 */
export type LineCost = { lineNo: number; description: string; est: boolean; quoted: number | null; real: number | null; source: string; choice?: string };
export type CostChoice = { id: string; label: string; amount: number };
export function costChoices(c: OrderCost): CostChoice[] {
  return [
    ...(c.labour.length ? [{ id: "labour", label: `${c.labour.map((r) => r.ref).join(" ")} · ${c.hours} h`, amount: c.labourTotal }] : []),
    ...c.purchases.map((r, i) => ({ id: `po:${r.ref}:${i}`, label: `${r.ref} · ${r.what}`, amount: r.amount })),
    ...c.expenses.map((r, i) => ({ id: `exp:${r.ref}:${i}`, label: `${r.ref} · ${r.what}`, amount: r.amount })),
    { id: "none", label: "0", amount: 0 },
  ];
}
export async function lineCosts(orderId: string, c: OrderCost, map: Record<string, string> = {}): Promise<LineCost[]> {
  const lines = await prisma.quoteLine.findMany({ where: { serviceOrderId: orderId }, orderBy: { lineNo: "asc" }, include: { part: { select: { sku: true } } } });
  const choices = costChoices(c);
  return lines.map((l) => {
    const quoted = l.unitCost != null ? r2(Number(l.unitCost) * Number(l.qty)) : null;
    if (!l.costEst) {
      const issued = l.part ? c.parts.filter((p) => p.what.startsWith(l.part!.sku)) : [];
      return issued.length ? { lineNo: l.lineNo, description: l.description, est: false, quoted, real: r2(issued.reduce((s, p) => s + p.amount, 0)), source: [...new Set(issued.map((p) => p.ref))].join(" ") }
        : { lineNo: l.lineNo, description: l.description, est: false, quoted, real: quoted, source: "SYSTEM" };
    }
    const pick = choices.find((x) => x.id === map[String(l.lineNo)]);
    return { lineNo: l.lineNo, description: l.description, est: true, quoted, real: pick ? pick.amount : null, source: pick ? pick.label : "", choice: pick?.id };
  });
}

/** 开票即结算 (朱总 2026-11-18 11:59): once a tax invoice stands on the order, its cost is frozen — nothing more is booked to it. */
export async function assertNotSettled(order: { id: string; no: string } | null | undefined) {
  if (!order) return;
  if (await prisma.taxInvoice.count({ where: { serviceOrderId: order.id, voidedAt: null } })) throw new Error(`ORDER_SETTLED:${order.no}`);
}
export const isSettled = async (orderId: string) => (await prisma.taxInvoice.count({ where: { serviceOrderId: orderId, voidedAt: null } })) > 0;

/** What must be decided before the cost can be called clear: claims still waiting, purchase orders not yet approved and sent. */
export async function openCostItems(order: { id: string; no: string }): Promise<string[]> {
  const [claims, pos] = await Promise.all([
    prisma.expenseClaim.count({ where: { serviceOrderNo: order.no, status: "PENDING" as never } }).catch(() => 0),
    prisma.purchaseOrder.findMany({ where: { serviceOrderId: order.id, status: { in: ["DRAFT"] as never } }, select: { no: true } }),
  ]);
  return [...(claims ? [`expense ×${claims}`] : []), ...pos.map((p) => p.no)];
}

/**
 * Finance or the MD recognises the cost the system shows. Clear: every estimate replaced, nothing still open, and a gap
 * in the system's own data (a part without a cost, a report without hours, no salary on file) is named in a note.
 */
export async function confirmOrderCost(input: { no: string; actorCode: string; map?: Record<string, string>; note?: string }) {
  const actor = await actorWith(input.actorCode, can.invoice, "COST_FINANCE_MD");
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, select: { id: true, no: true, costTotal: true } });
  await assertNotSettled(order);
  const open = await openCostItems(order);
  if (open.length) throw new Error(`COST_OPEN_ITEMS:${open.join("、")}`);
  const c = await orderCost(order.id);
  const lines = await lineCosts(order.id, c, input.map ?? {});
  const left = lines.filter((l) => l.est && l.real == null).map((l) => l.lineNo);
  if (left.length) throw new Error(`COST_EST_LEFT:${left.join("、")}`);
  const used = lines.filter((l) => l.choice && l.choice !== "none").map((l) => l.choice!);
  if (new Set(used).size !== used.length) throw new Error("COST_CHOICE_TWICE");
  if (c.missing.length && !input.note?.trim()) throw new Error(`COST_GAPS_NEED_NOTE:${c.missing.join("、")}`);
  await prisma.serviceOrder.update({ where: { id: order.id }, data: { costActual: c.total, costDetail: { ...c, lines, map: input.map ?? {}, note: input.note?.trim() || null } as unknown as Prisma.InputJsonValue, costConfirmedAt: new Date(), costConfirmedBy: actor.code } });
  await audit(actor.id, "COST_CONFIRMED", order.no, { total: c.total, parts: c.partsTotal, purchases: c.purchasesTotal, labour: c.labourTotal, hours: c.hours, expenses: c.expensesTotal, quoted: order.costTotal != null ? Number(order.costTotal) : null, missing: c.missing, note: input.note?.trim() || null, lines: lines.map((l) => ({ n: l.lineNo, est: l.est, quoted: l.quoted, real: l.real, source: l.source })) });
  return c;
}

/** Before an invoice is written: recognised, and still what the system shows (a later issue or purchase asks again). */
export async function assertCostConfirmed(order: { id: string; no: string; costConfirmedAt: Date | null; costActual: Prisma.Decimal | null }) {
  if (!order.costConfirmedAt) throw new Error(`COST_NOT_CONFIRMED:${order.no}`);
  const now = (await orderCost(order.id)).total;
  if (Math.abs(now - Number(order.costActual ?? 0)) > 0.005) throw new Error(`COST_CHANGED:${now.toFixed(2)}`);
}
