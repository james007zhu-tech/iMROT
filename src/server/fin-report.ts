/**
 * 财务报表: a management view built from the documents the system already holds — tax invoices, receipts, supplier
 * invoices, expense claims, payroll. THB only (foreign-currency invoices are listed beside it, unconverted).
 * It is not the statutory ledger: the accountant's books remain the record for filing.
 */
import { localIso } from "@/lib/dates";
import { prisma } from "@/lib/db";

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Month key in Bangkok time. */
const mk = (d: Date) => new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 7);
const DAY = 86_400_000;

export interface MonthRow { month: string; revenue: number; vatOut: number; collected: number; whtByCustomers: number; purchases: number; vatIn: number; paidSuppliers: number; expenses: number; payroll: number; result: number; vatNet: number }
export const AGE_KEYS = ["notDue", "d30", "d60", "d90", "over"] as const;
type Ageing = Record<(typeof AGE_KEYS)[number], number>;
const bucket = (due: Date | null, now: Date): keyof Ageing => { const days = due ? Math.floor((now.getTime() - due.getTime()) / DAY) : 0; return days <= 0 ? "notDue" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "over"; };

export async function financeReport(entityId: string, year: number, opts: { withPayroll: boolean }) {
  const from = new Date(Date.UTC(year, 0, 1) - 7 * 3600_000), to = new Date(Date.UTC(year + 1, 0, 1) - 7 * 3600_000);
  const now = new Date();
  const [tis, rcs, sis, sPaid, exps, runs, openInv, openAp, foreign] = await Promise.all([
    prisma.taxInvoice.findMany({ where: { voidedAt: null, issuedAt: { gte: from, lt: to }, serviceOrder: { entityId } }, select: { issuedAt: true, subtotal: true, vatAmount: true, serviceOrder: { select: { mode: true, customer: { select: { name: true } } } } } }),
    prisma.receipt.findMany({ where: { receivedAt: { gte: from, lt: to }, currency: "THB", invoice: { serviceOrder: { entityId } } }, select: { receivedAt: true, cashAmount: true, whtAmount: true } }),
    prisma.supplierInvoice.findMany({ where: { entityId, status: { not: "CANCELLED" }, currency: "THB", invoiceDate: { gte: from, lt: to } }, select: { invoiceDate: true, subtotal: true, vatAmount: true } }),
    prisma.supplierInvoice.findMany({ where: { entityId, status: "PAID", currency: "THB", paidAt: { gte: from, lt: to } }, select: { paidAt: true, payable: true } }),
    prisma.expenseClaim.findMany({ where: { entityId, status: { in: ["APPROVED", "PAID"] }, currency: "THB", spentOn: { gte: from, lt: to } }, select: { spentOn: true, amount: true, vatAmount: true, category: true } }),
    opts.withPayroll ? prisma.payrollRun.findMany({ where: { entityId, status: { not: "DRAFT" }, month: { gte: `${year}-01`, lte: `${year}-12` } }, select: { month: true, totals: true } }) : Promise.resolve([]),
    prisma.invoice.findMany({ where: { cancelledAt: null, paidAt: null, serviceOrder: { entityId } }, select: { no: true, dueAt: true, issuedAt: true, currency: true, amountDue: true, paidAmount: true, whtAmount: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } }),
    prisma.supplierInvoice.findMany({ where: { entityId, status: "OPEN" }, select: { invoiceNo: true, dueDate: true, currency: true, payable: true, supplier: { select: { name: true } } } }),
    prisma.invoice.findMany({ where: { cancelledAt: null, currency: { not: "THB" }, issuedAt: { gte: from, lt: to }, serviceOrder: { entityId } }, select: { currency: true, amountDue: true } }),
  ]);
  const months: MonthRow[] = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, revenue: 0, vatOut: 0, collected: 0, whtByCustomers: 0, purchases: 0, vatIn: 0, paidSuppliers: 0, expenses: 0, payroll: 0, result: 0, vatNet: 0 }));
  const at = (d: Date) => months.find((m) => m.month === mk(d));
  for (const x of tis) { const m = at(x.issuedAt); if (m) { m.revenue += Number(x.subtotal); m.vatOut += Number(x.vatAmount); } }
  for (const x of rcs) { const m = at(x.receivedAt); if (m) { m.collected += Number(x.cashAmount); m.whtByCustomers += Number(x.whtAmount); } }
  for (const x of sis) { const m = at(x.invoiceDate); if (m) { m.purchases += Number(x.subtotal); m.vatIn += Number(x.vatAmount); } }
  for (const x of sPaid) { const m = x.paidAt && at(x.paidAt); if (m) m.paidSuppliers += Number(x.payable); }
  for (const x of exps) { const m = months.find((y) => y.month === localIso(x.spentOn)!.slice(0, 7)); if (m) { m.expenses += Number(x.amount) - Number(x.vatAmount ?? 0); m.vatIn += Number(x.vatAmount ?? 0); } }
  for (const x of runs) { const m = months.find((y) => y.month === x.month); if (m) m.payroll += Number((x.totals as { employerCost?: number }).employerCost ?? 0); }
  for (const m of months) { for (const k of Object.keys(m) as (keyof MonthRow)[]) if (k !== "month") (m[k] as number) = r2(m[k] as number); m.result = r2(m.revenue - m.purchases - m.expenses - m.payroll); m.vatNet = r2(m.vatOut - m.vatIn); }
  const total = months.reduce((s, m) => { for (const k of Object.keys(m) as (keyof MonthRow)[]) if (k !== "month") (s[k] as number) = r2((s[k] as number) + (m[k] as number)); return s; }, { month: String(year), revenue: 0, vatOut: 0, collected: 0, whtByCustomers: 0, purchases: 0, vatIn: 0, paidSuppliers: 0, expenses: 0, payroll: 0, result: 0, vatNet: 0 } as MonthRow);

  const group = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => { const m = new Map<string, number>(); for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r)); return [...m].map(([k, v]) => [k, r2(v)] as [string, number]).sort((a, b) => b[1] - a[1]); };
  const ar: Ageing = { notDue: 0, d30: 0, d60: 0, d90: 0, over: 0 }, ap: Ageing = { notDue: 0, d30: 0, d60: 0, d90: 0, over: 0 };
  const arRows = openInv.filter((i) => i.currency === "THB").map((i) => ({ no: i.no, order: i.serviceOrder.no, customer: i.serviceOrder.customer.name, due: i.dueAt, open: r2(Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0)) })).filter((i) => i.open > 0.005);
  for (const i of arRows) ar[bucket(i.due, now)] += i.open;
  const apRows = openAp.filter((i) => i.currency === "THB").map((i) => ({ no: i.invoiceNo, supplier: i.supplier.name, due: i.dueDate, open: Number(i.payable) }));
  for (const i of apRows) ap[bucket(i.due, now)] += i.open;
  for (const k of AGE_KEYS) { ar[k] = r2(ar[k]); ap[k] = r2(ap[k]); }
  return {
    months, total, ar, ap,
    arOverdue: arRows.filter((i) => i.due && i.due < now).sort((a, b) => a.due!.getTime() - b.due!.getTime()).slice(0, 10),
    apOverdue: apRows.filter((i) => i.due < now).sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 10),
    byMode: group(tis, (x) => x.serviceOrder.mode, (x) => Number(x.subtotal)),
    byCustomer: group(tis, (x) => x.serviceOrder.customer.name, (x) => Number(x.subtotal)).slice(0, 8),
    byExpense: group(exps, (x) => x.category, (x) => Number(x.amount) - Number(x.vatAmount ?? 0)),
    foreign: group(foreign, (x) => x.currency, (x) => Number(x.amountDue)),
    otherCurrencyOpen: openInv.filter((i) => i.currency !== "THB").length + openAp.filter((i) => i.currency !== "THB").length,
  };
}
