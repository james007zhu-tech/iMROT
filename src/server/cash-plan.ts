/**
 * 现金计划 (朱总 2026-11-15: "每月初自动出具一份现金计划——什么时候付多少钱给谁，固定的").
 * Built from what the system already holds, nothing typed twice:
 *   out — supplier invoices by due date · the fixed payments · last month's payroll (by the 5th) with its social
 *         security (15th) and ภ.ง.ด.1 (7th) · approved expense claims · last month's VAT (15th) and the tax withheld
 *         from suppliers (7th)
 *   in  — customers' invoices by due date
 * The plan of a month is kept as it stood when the month began; the page shows it as it is now.
 * The tax dates are the paper-filing dates; filing online allows eight more days.
 */
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { dayIn, monthStart, nextMonth, prevMonth, recursIn, sortLines, totalsOf, type CashLine } from "@/lib/cash-plan";

const r2 = (n: number) => Math.round(n * 100) / 100;
const day = (d: Date) => localIso(d)!.slice(0, 10);
export const mayPlan = (role: string) => ["MD", "FINANCE", "ADMIN"].includes(role);
export const thisMonth = (now = new Date()) => localIso(now)!.slice(0, 7);

export async function buildCashPlan(entityId: string, month: string) {
  const first = new Date(`${monthStart(month)}T00:00:00`), next = new Date(`${monthStart(nextMonth(month))}T00:00:00`);
  const prev = prevMonth(month), prevFirst = new Date(`${monthStart(prev)}T00:00:00`);
  const lines: CashLine[] = [];
  const warnings: string[] = [];
  // Every sum appears once: in the month it falls due. What fell due earlier and is still unpaid is carried into the
  // month we are in now — and only there (test report 2026-11-15, P0-11: an unpaid claim showed in every month looked at).
  const carries = month === thisMonth();
  // (a month already over shows nothing still unpaid — that has moved on into the current month; its plan as it began is kept)
  const past = month < thisMonth();
  const place = (d: Date): { date: string; overdue: boolean } | null => (past || d >= next ? null : d >= first ? { date: day(d), overdue: false } : carries ? { date: monthStart(month), overdue: true } : null);

  // ── suppliers: every open invoice due by the end of the month (what was due earlier is owed on the 1st)
  for (const s of await prisma.supplierInvoice.findMany({ where: { entityId, status: "OPEN", dueDate: { lt: next } }, include: { supplier: { select: { name: true } }, purchaseOrder: { select: { no: true } } } })) {
    const at = place(s.dueDate);
    if (at) lines.push({ ...at, dir: "OUT", kind: "SUPPLIER", party: s.supplier.name, what: s.invoiceNo, amount: Number(s.payable), currency: s.currency, ref: s.purchaseOrder.no, href: "/finance/payables", fixed: true });
  }

  // ── the fixed payments
  for (const r of await prisma.recurringPayment.findMany({ where: { entityId, active: true } }))
    if (recursIn(r, month)) lines.push({ date: dayIn(month, r.dayOfMonth), dir: "OUT", kind: "FIXED", party: r.payee, what: r.purpose, amount: Number(r.amount), currency: r.currency, href: "/finance/cash-plan/fixed", fixed: true });

  // ── last month's payroll: pay by the 5th, ภ.ง.ด.1 by the 7th, social security by the 15th
  const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId, month: prev } }, include: { lines: { select: { net: true, wht: true, ssoEmployee: true, ssoEmployer: true } } } });
  if (run) {
    const payLines = run.lines;
    const sum = (f: (l: (typeof payLines)[number]) => unknown) => r2(payLines.reduce((s, l) => s + Number(f(l)), 0));
    const draft = run.status === "DRAFT";
    if (run.status !== "PAID" && sum((l) => l.net) > 0) lines.push({ date: dayIn(month, 5), dir: "OUT", kind: "PAYROLL", party: `${run.lines.length}`, what: prev, amount: sum((l) => l.net), currency: "THB", ref: prev, href: `/people/payroll/${prev}`, fixed: !draft, estimate: draft });
    if (sum((l) => l.wht) > 0) lines.push({ date: dayIn(month, 7), dir: "OUT", kind: "PND1", party: "RD", what: prev, amount: sum((l) => l.wht), currency: "THB", href: `/people/payroll/${prev}`, fixed: !draft, estimate: draft });
    const sso = r2(sum((l) => l.ssoEmployee) + sum((l) => l.ssoEmployer));
    if (sso > 0) lines.push({ date: dayIn(month, 15), dir: "OUT", kind: "SSO", party: "SSO", what: prev, amount: sso, currency: "THB", href: `/people/payroll/${prev}`, fixed: !draft, estimate: draft });
    if (draft) warnings.push("PAYROLL_DRAFT");
  } else {
    // no payroll run yet: the standing salaries are the best figure there is, and it says it is an estimate
    const staff = await prisma.employee.findMany({ where: { entityId, active: true }, select: { salaries: { where: { effectiveFrom: { lt: first } }, orderBy: { effectiveFrom: "desc" }, take: 1, select: { grossMonthly: true } } } });
    const gross = r2(staff.reduce((s, e) => s + Number(e.salaries[0]?.grossMonthly ?? 0), 0));
    if (gross > 0) { lines.push({ date: dayIn(month, 5), dir: "OUT", kind: "PAYROLL", party: `${staff.filter((e) => e.salaries.length).length}`, what: prev, amount: gross, currency: "THB", href: `/people/payroll?month=${prev}`, estimate: true }); warnings.push("PAYROLL_NOT_RUN"); }
  }

  // ── approved expense claims the payroll does not carry
  // … each is paid on the 5th after it was approved
  for (const x of await prisma.expenseClaim.findMany({ where: { entityId, status: "APPROVED", paidAt: null, paidBy: "SELF", payrollRunId: null }, include: { employee: { select: { name: true } } } })) {
    const ok = x.decidedAt ?? x.createdAt, okDay = localIso(ok)!.slice(0, 10);
    const dueMonth = okDay.slice(8, 10) <= "05" ? okDay.slice(0, 7) : nextMonth(okDay.slice(0, 7));
    const at = place(new Date(`${dayIn(dueMonth, 5)}T00:00:00`));
    if (at) lines.push({ ...at, dir: "OUT", kind: "EXPENSE", party: x.employee.name, what: x.description, amount: Number(x.amount), currency: x.currency, ref: x.no ?? undefined, href: "/finance/expenses", fixed: true });
  }

  // ── last month's taxes
  const span = { gte: prevFirst, lt: first };
  const [vatOut, vatIn, vatExp, wht] = await Promise.all([
    prisma.taxInvoice.aggregate({ _sum: { vatAmount: true }, where: { serviceOrder: { entityId }, issuedAt: span, voidedAt: null } }),
    prisma.supplierInvoice.aggregate({ _sum: { vatAmount: true }, where: { entityId, invoiceDate: span, status: { not: "CANCELLED" }, currency: "THB" } }),
    prisma.expenseClaim.aggregate({ _sum: { vatAmount: true }, where: { entityId, spentOn: span, status: { in: ["APPROVED", "PAID"] } } }),
    prisma.supplierInvoice.aggregate({ _sum: { whtAmount: true }, where: { entityId, paidAt: span, status: "PAID" } }),
  ]);
  const vat = r2(Number(vatOut._sum.vatAmount ?? 0) - Number(vatIn._sum.vatAmount ?? 0) - Number(vatExp._sum.vatAmount ?? 0));
  if (vat > 0) lines.push({ date: dayIn(month, 15), dir: "OUT", kind: "VAT", party: "RD", what: prev, amount: vat, currency: "THB", href: "/tax", estimate: true });
  if (Number(wht._sum.whtAmount ?? 0) > 0) lines.push({ date: dayIn(month, 7), dir: "OUT", kind: "PND53", party: "RD", what: prev, amount: r2(Number(wht._sum.whtAmount)), currency: "THB", href: "/tax", fixed: true });

  // ── customers: what is invoiced and not yet paid, by its due date
  for (const i of await prisma.invoice.findMany({ where: { serviceOrder: { entityId }, cancelledAt: null, paidAt: null }, include: { serviceOrder: { select: { no: true, customer: { select: { name: true, paymentTermDays: true } } } } } })) {
    const due = i.dueAt ?? new Date(i.issuedAt.getTime() + (i.serviceOrder.customer.paymentTermDays ?? 30) * 86_400_000);
    const at = place(due);
    if (!at) continue;
    const open = r2(Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0));
    if (open > 0) lines.push({ ...at, dir: "IN", kind: "RECEIVABLE", party: i.serviceOrder.customer.name, what: i.no, amount: open, currency: i.currency, ref: i.serviceOrder.no, href: `/service-orders/${i.serviceOrder.no}` });
  }
  const sorted = sortLines(lines);
  return { month, lines: sorted, totals: totalsOf(sorted), warnings };
}

/** The plan as the month began — written once, the first time anyone opens the system in that month. */
export async function ensureCashPlan(entityId: string, month = thisMonth()) {
  const have = await prisma.cashPlan.findUnique({ where: { entityId_month: { entityId, month } } });
  if (have) return { plan: have, created: false };
  const built = await buildCashPlan(entityId, month);
  const plan = await prisma.cashPlan.create({ data: { entityId, month, lines: built.lines as object[], totals: built.totals as object } }).catch(() => prisma.cashPlan.findUniqueOrThrow({ where: { entityId_month: { entityId, month } } }));
  return { plan, created: true };
}

export async function setOpeningBalance(entityId: string, month: string, amount: number | null, actorId: string) {
  await ensureCashPlan(entityId, month);
  await prisma.cashPlan.update({ where: { entityId_month: { entityId, month } }, data: { openingBalance: amount } });
  await prisma.auditLog.create({ data: { actorId, action: "CASH_PLAN_OPENING", target: month, detail: { amount } } });
}

export interface RecurringInput { payee: string; purpose: string; amount: number; dayOfMonth: number; startMonth: string; endMonth?: string; note?: string; currency?: string }
export async function saveRecurring(entityId: string, actor: { id: string; role: string }, id: string | null, d: RecurringInput) {
  if (!mayPlan(actor.role)) throw new Error("FORBIDDEN");
  if (!d.payee.trim() || !d.purpose.trim() || !(d.amount > 0) || !(d.dayOfMonth >= 1 && d.dayOfMonth <= 31) || !/^\d{4}-\d{2}$/.test(d.startMonth) || (d.endMonth && (!/^\d{4}-\d{2}$/.test(d.endMonth) || d.endMonth < d.startMonth))) throw new Error("INVALID_INPUT");
  const data = { payee: d.payee.trim(), purpose: d.purpose.trim(), amount: d.amount, dayOfMonth: Math.round(d.dayOfMonth), startMonth: d.startMonth, endMonth: d.endMonth || null, note: d.note?.trim() || null, currency: d.currency || "THB" };
  const r = id ? await prisma.recurringPayment.update({ where: { id }, data }) : await prisma.recurringPayment.create({ data: { ...data, entityId, createdById: actor.id } });
  await prisma.auditLog.create({ data: { actorId: actor.id, action: id ? "FIXED_PAYMENT_UPDATED" : "FIXED_PAYMENT_ADDED", target: r.payee, detail: { amount: d.amount, day: d.dayOfMonth, purpose: d.purpose } } });
  return r;
}
export async function stopRecurring(actor: { id: string; role: string }, id: string) {
  if (!mayPlan(actor.role)) throw new Error("FORBIDDEN");
  const r = await prisma.recurringPayment.update({ where: { id }, data: { active: false } });
  await prisma.auditLog.create({ data: { actorId: actor.id, action: "FIXED_PAYMENT_STOPPED", target: r.payee, detail: { purpose: r.purpose } } });
}

/** The month's plan is written as the month begins (hourly check from the server's start hook), for every company. */
export async function autoCashPlans() {
  const made: string[] = [];
  for (const e of await prisma.legalEntity.findMany({ select: { id: true, code: true } })) { const r = await ensureCashPlan(e.id).catch(() => null); if (r?.created) made.push(`${e.code} ${thisMonth()}`); }
  return made;
}
