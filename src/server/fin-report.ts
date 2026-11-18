/**
 * 财务报表: a management view built from the documents the system already holds — tax invoices, receipts, supplier
 * invoices, expense claims, payroll. THB only (foreign-currency invoices are listed beside it, unconverted).
 * It is not the statutory ledger: the accountant's books remain the record for filing.
 */
import { fifoOf } from "@/server/fifo";
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

export interface Range { from: string; to: string } // YYYY-MM-DD, both days included, Bangkok time
/** 本月、上月、本季、今年 — and a year as before. */
export function presetRange(key: string, today = new Date(Date.now() + 7 * 3600_000)): Range {
  const y = today.getUTCFullYear(), m = today.getUTCMonth(), iso = (d: Date) => d.toISOString().slice(0, 10), end = (yy: number, mm: number) => iso(new Date(Date.UTC(yy, mm + 1, 0)));
  if (key === "lastMonth") return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: end(y, m - 1) };
  if (key === "quarter") { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(Date.UTC(y, q, 1))), to: end(y, q + 2) }; }
  if (key === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  if (/^\d{4}$/.test(key)) return { from: `${key}-01-01`, to: `${key}-12-31` };
  return { from: iso(new Date(Date.UTC(y, m, 1))), to: end(y, m) }; // month
}
const bounds = (r: Range) => ({ from: new Date(new Date(`${r.from}T00:00:00Z`).getTime() - 7 * 3600_000), to: new Date(new Date(`${r.to}T00:00:00Z`).getTime() + DAY - 7 * 3600_000) });
const monthsOf = (r: Range) => { const out: string[] = []; for (let d = new Date(`${r.from.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= r.to.slice(0, 7); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) out.push(d.toISOString().slice(0, 7)); return out.slice(0, 60); };
/** TEST 数据默认不计入 (V4-P0-14): documents numbered TEST-…, and suppliers / invoices named TEST…, stay out unless asked for. */
const isTest = (...s: (string | null | undefined)[]) => s.some((x) => !!x && /^TEST[-\s_]/i.test(x.trim()));

export async function financeReport(entityId: string, period: number | Range, opts: { withPayroll: boolean; includeTest?: boolean }) {
  const range: Range = typeof period === "number" ? { from: `${period}-01-01`, to: `${period}-12-31` } : period;
  const { from, to } = bounds(range), year = Number(range.from.slice(0, 4));
  const keep = opts.includeTest ?? typeof period === "number"; // the old call by year counts everything, as before
  const now = new Date();
  const [tis0, rcs0, sis0, sPaid0, exps, runs, openInv0, openAp0, foreign] = await Promise.all([
    prisma.taxInvoice.findMany({ where: { voidedAt: null, issuedAt: { gte: from, lt: to }, serviceOrder: { entityId } }, select: { no: true, issuedAt: true, subtotal: true, vatAmount: true, serviceOrder: { select: { mode: true, customer: { select: { name: true } } } } } }),
    prisma.receipt.findMany({ where: { voidedAt: null, receivedAt: { gte: from, lt: to }, currency: "THB", invoice: { serviceOrder: { entityId } } }, select: { no: true, receivedAt: true, cashAmount: true, whtAmount: true } }),
    prisma.supplierInvoice.findMany({ where: { entityId, status: { not: "CANCELLED" }, currency: "THB", invoiceDate: { gte: from, lt: to } }, select: { invoiceNo: true, invoiceDate: true, subtotal: true, vatAmount: true, accrued: true, supplier: { select: { name: true } } } }),
    prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { gte: from, lt: to }, supplierInvoice: { currency: "THB" } }, select: { paidAt: true, amount: true, supplierInvoice: { select: { invoiceNo: true, supplier: { select: { name: true } } } } } }), // what left the bank, part payments included
    prisma.expenseClaim.findMany({ where: { entityId, status: { in: ["APPROVED", "PAID"] }, currency: "THB", spentOn: { gte: from, lt: to } }, select: { spentOn: true, amount: true, vatAmount: true, category: true } }),
    opts.withPayroll ? prisma.payrollRun.findMany({ where: { entityId, status: { not: "DRAFT" }, month: { gte: range.from.slice(0, 7), lte: range.to.slice(0, 7) } }, select: { month: true, totals: true } }) : Promise.resolve([]),
    prisma.invoice.findMany({ where: { cancelledAt: null, paidAt: null, serviceOrder: { entityId } }, select: { id: true, no: true, dueAt: true, issuedAt: true, currency: true, amountDue: true, paidAmount: true, whtAmount: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } }),
    prisma.supplierInvoice.findMany({ where: { entityId, status: "OPEN" }, select: { invoiceNo: true, dueDate: true, currency: true, total: true, payable: true, paidAmount: true, whtAmount: true, supplier: { select: { name: true } }, purchaseOrder: { select: { no: true } } } }),
    prisma.invoice.findMany({ where: { cancelledAt: null, currency: { not: "THB" }, issuedAt: { gte: from, lt: to }, serviceOrder: { entityId } }, select: { currency: true, amountDue: true } }),
  ]);
  const tis = tis0.filter((x) => keep || !isTest(x.no)), rcs = rcs0.filter((x) => keep || !isTest(x.no));
  const sis = sis0.filter((x) => keep || !isTest(x.invoiceNo, x.supplier.name)), sPaid = sPaid0.filter((x) => keep || !isTest(x.supplierInvoice.invoiceNo, x.supplierInvoice.supplier.name));
  const openInv = openInv0.filter((x) => keep || !isTest(x.no)), openAp = openAp0.filter((x) => keep || !isTest(x.invoiceNo, x.supplier.name));
  const cns = await prisma.creditNote.findMany({ where: { voidedAt: null, issuedAt: { gte: from, lt: to }, currency: "THB", taxInvoice: { serviceOrder: { entityId } } }, select: { no: true, issuedAt: true, subtotal: true, vatAmount: true, total: true, invoiceId: true, taxInvoice: { select: { serviceOrder: { select: { mode: true, customer: { select: { name: true } } } } } } } });
  const cnsAll = cns; void cnsAll;
  const months: MonthRow[] = monthsOf(range).map((month) => ({ month, revenue: 0, vatOut: 0, collected: 0, whtByCustomers: 0, purchases: 0, vatIn: 0, paidSuppliers: 0, expenses: 0, payroll: 0, result: 0, vatNet: 0 }));
  const at = (d: Date) => months.find((m) => m.month === mk(d));
  for (const x of tis) { const m = at(x.issuedAt); if (m) { m.revenue += Number(x.subtotal); m.vatOut += Number(x.vatAmount); } }
  for (const x of cns) { const m = at(x.issuedAt); if (m) { m.revenue -= Number(x.subtotal); m.vatOut -= Number(x.vatAmount); } } // 贷项单
  for (const x of rcs) { const m = at(x.receivedAt); if (m) { m.collected += Number(x.cashAmount); m.whtByCustomers += Number(x.whtAmount); } }
  // 暂估: a purchase, but no input VAT until the invoice is in
  for (const x of sis) { const m = at(x.invoiceDate); if (m) { m.purchases += Number(x.subtotal); if (!x.accrued) m.vatIn += Number(x.vatAmount); } }
  for (const x of sPaid) { const m = x.paidAt && at(x.paidAt); if (m) m.paidSuppliers += Number(x.amount); }
  for (const x of exps) { const m = months.find((y) => y.month === localIso(x.spentOn)!.slice(0, 7)); if (m) { m.expenses += Number(x.amount) - Number(x.vatAmount ?? 0); m.vatIn += Number(x.vatAmount ?? 0); } }
  for (const x of runs) { const m = months.find((y) => y.month === x.month); if (m) m.payroll += Number((x.totals as { employerCost?: number }).employerCost ?? 0); }
  for (const m of months) { for (const k of Object.keys(m) as (keyof MonthRow)[]) if (k !== "month") (m[k] as number) = r2(m[k] as number); m.result = r2(m.revenue - m.purchases - m.expenses - m.payroll); m.vatNet = r2(m.vatOut - m.vatIn); }
  const total = months.reduce((s, m) => { for (const k of Object.keys(m) as (keyof MonthRow)[]) if (k !== "month") (s[k] as number) = r2((s[k] as number) + (m[k] as number)); return s; }, { month: typeof period === "number" ? String(year) : `${range.from} → ${range.to}`, revenue: 0, vatOut: 0, collected: 0, whtByCustomers: 0, purchases: 0, vatIn: 0, paidSuppliers: 0, expenses: 0, payroll: 0, result: 0, vatNet: 0 } as MonthRow);

  const group = <T,>(rows: T[], key: (r: T) => string, val: (r: T) => number) => { const m = new Map<string, number>(); for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + val(r)); return [...m].map(([k, v]) => [k, r2(v)] as [string, number]).sort((a, b) => b[1] - a[1]); };
  const ar: Ageing = { notDue: 0, d30: 0, d60: 0, d90: 0, over: 0 }, ap: Ageing = { notDue: 0, d30: 0, d60: 0, d90: 0, over: 0 };
  // 账龄下钻: every open invoice with 原额 / 贷项 / 已收 / 未收 (the invoice's amountDue is already net of its credit notes)
  const credits = new Map<string, number>();
  for (const c of await prisma.creditNote.findMany({ where: { voidedAt: null, invoiceId: { in: openInv.map((i) => i.id) } }, select: { invoiceId: true, total: true } })) if (c.invoiceId) credits.set(c.invoiceId, (credits.get(c.invoiceId) ?? 0) + Number(c.total));
  const arRows = openInv.filter((i) => i.currency === "THB").map((i) => { const credit = r2(credits.get(i.id) ?? 0), got = r2(Number(i.paidAmount ?? 0) + Number(i.whtAmount ?? 0)); return { no: i.no, order: i.serviceOrder.no, customer: i.serviceOrder.customer.name, due: i.dueAt, original: r2(Number(i.amountDue) + credit), credit: -credit, received: got, open: r2(Number(i.amountDue) - got), bucket: bucket(i.dueAt, now) }; }).filter((i) => i.open > 0.005);
  for (const i of arRows) ar[bucket(i.due, now)] += i.open;
  const apRows = openAp.filter((i) => i.currency === "THB").map((i) => ({ no: i.invoiceNo, po: i.purchaseOrder.no, supplier: i.supplier.name, due: i.dueDate, original: Number(i.total), wht: -Number(i.whtAmount), paid: Number(i.paidAmount), open: r2(Number(i.payable) - Number(i.paidAmount)), bucket: bucket(i.dueDate, now) })).filter((i) => i.open > 0.005);
  for (const i of apRows) ap[bucket(i.due, now)] += i.open;
  for (const k of AGE_KEYS) { ar[k] = r2(ar[k]); ap[k] = r2(ap[k]); }
  return {
    range, months, total, ar, ap, arRows: [...arRows].sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0)), apRows: [...apRows].sort((a, b) => a.due.getTime() - b.due.getTime()),
    arTotal: r2(arRows.reduce((x, i) => x + i.open, 0)), apTotal: r2(apRows.reduce((x, i) => x + i.open, 0)),
    arOverdue: arRows.filter((i) => i.due && i.due < now).sort((a, b) => a.due!.getTime() - b.due!.getTime()).slice(0, 10),
    apOverdue: apRows.filter((i) => i.due < now).sort((a, b) => a.due.getTime() - b.due.getTime()).slice(0, 10),
    // net of 贷项单, so the two breakdowns add up to the revenue line above (需求清单 v3 P1-28)
    byMode: group([...tis.map((x) => ({ k: x.serviceOrder.mode as string, v: Number(x.subtotal) })), ...cns.map((x) => ({ k: x.taxInvoice.serviceOrder.mode as string, v: -Number(x.subtotal) }))], (x) => x.k, (x) => x.v),
    byCustomer: group([...tis.map((x) => ({ k: x.serviceOrder.customer.name, v: Number(x.subtotal) })), ...cns.map((x) => ({ k: x.taxInvoice.serviceOrder.customer.name, v: -Number(x.subtotal) }))], (x) => x.k, (x) => x.v).slice(0, 8),
    byExpense: group(exps, (x) => x.category, (x) => Number(x.amount) - Number(x.vatAmount ?? 0)),
    foreign: group(foreign, (x) => x.currency, (x) => Number(x.amountDue)),
    otherCurrencyOpen: openInv.filter((i) => i.currency !== "THB").length + openAp.filter((i) => i.currency !== "THB").length,
  };
}

/**
 * 现金银行日记账 (V4-P0-14): what came in and what went out, account by account — Kasikorn, Bank of China, cash, petty
 * cash, and what was entered without an account. From receipts, supplier payments, expense claims paid by finance and
 * payroll paid. The system holds no opening balances: the journal shows the movement of the period, not a bank balance.
 */
type CashRow = { date: Date; no: string; who: string; account: string; currency: string; inAmt: number; outAmt: number; ref: string; href: string; rcNo?: string; hint?: string };
/** Which of our accounts an old hand-written receipt account most likely means ("BOC 1234" → the BOC account in the receipt's currency). A suggestion only: finance confirms. */
export function guessAccount(text: string, currency: string, accounts: { id: string; label: string }[]): string {
  const t = text.toLowerCase(), has = (...w: string[]) => w.some((x) => t.includes(x));
  const pick = (re: RegExp) => accounts.find((a) => re.test(a.label) && a.label.includes(currency))?.id ?? accounts.find((a) => re.test(a.label))?.id ?? "";
  if (has("boc", "中行", "中国银行", "bank of china")) return pick(/BOC|中国银行|中行/i);
  if (has("kbank", "kasikorn", "开泰", "กสิกร")) return pick(/KBank|开泰/i);
  if (has("petty", "备用金")) return "PETTY_CASH";
  if (has("cash", "现金", "เงินสด")) return "CASH";
  return "";
}
async function cashMoves(entityId: string, from: Date, to: Date, opts: { withPayroll: boolean; includeTest?: boolean }, known: Set<string>): Promise<CashRow[]> {
  const [rcs, pays, exps, runs] = await Promise.all([
    prisma.receipt.findMany({ where: { voidedAt: null, receivedAt: { gte: from, lt: to }, invoice: { serviceOrder: { entityId } } }, select: { no: true, receivedAt: true, currency: true, cashAmount: true, account: true, bankRef: true, invoice: { select: { serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } } } }),
    prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { gte: from, lt: to } }, select: { no: true, paidAt: true, amount: true, account: true, paymentRef: true, supplierInvoice: { select: { currency: true, invoiceNo: true, supplier: { select: { name: true } } } } } }),
    prisma.expenseClaim.findMany({ where: { entityId, status: "PAID", paidAt: { gte: from, lt: to }, NOT: { paidRef: { startsWith: "PAYROLL" } } }, select: { no: true, paidAt: true, currency: true, amount: true, paidBy: true, paidRef: true, employee: { select: { name: true } } } }),
    opts.withPayroll ? prisma.payrollRun.findMany({ where: { entityId, status: "PAID", paidAt: { gte: from, lt: to } }, select: { month: true, paidAt: true, totals: true } }) : Promise.resolve([]),
  ]);
  const acc = (x: string | null) => (x && known.has(x) ? x : ""); // a hand-written account is not one of ours until finance says which
  return [
    ...rcs.filter((x) => opts.includeTest || !isTest(x.no)).map((x) => ({ date: x.receivedAt, no: x.no, who: x.invoice.serviceOrder.customer.name, account: acc(x.account), currency: x.currency, inAmt: Number(x.cashAmount), outAmt: 0, ref: x.bankRef ?? "", href: pdfOf(x.no), rcNo: acc(x.account) ? undefined : x.no, hint: acc(x.account) ? undefined : x.account ?? "" })),
    ...pays.filter((x) => opts.includeTest || !isTest(x.supplierInvoice.invoiceNo, x.supplierInvoice.supplier.name)).map((x) => ({ date: x.paidAt!, no: x.no, who: x.supplierInvoice.supplier.name, account: acc(x.account), currency: x.supplierInvoice.currency, inAmt: 0, outAmt: Number(x.amount), ref: x.paymentRef ?? "", href: pvOf(x.no) })),
    ...exps.map((x) => ({ date: x.paidAt!, no: x.no ?? "", who: x.employee.name, account: x.paidBy === "PETTY_CASH" ? "PETTY_CASH" : "", currency: x.currency, inAmt: 0, outAmt: Number(x.amount), ref: x.paidRef ?? "", href: exOf(x.no ?? "") })),
    ...runs.map((x) => ({ date: x.paidAt!, no: `PAYROLL ${x.month}`, who: "", account: "", currency: "THB", inAmt: 0, outAmt: Number((x.totals as { net?: number }).net ?? 0) + Number((x.totals as { reimbursement?: number }).reimbursement ?? 0), ref: "", href: `/people/payroll/${x.month}` })),
  ].filter((x) => x.inAmt > 0 || x.outAmt > 0).sort((a, b) => a.date.getTime() - b.date.getTime());
}
/**
 * 现金银行日记账 (V4-P0-14; 派修单 v5 P0-1): one group per account of the company — every account, also one nothing
 * moved through — with 期初 (everything the system holds before the first day), 收入, 支出, 期末. What has no account of
 * ours (an old receipt with a hand-written account, payroll, a claim paid by hand) stands in a group of its own.
 */
export async function cashJournal(entityId: string, range: Range, opts: { withPayroll: boolean; includeTest?: boolean }) {
  const { from, to } = bounds(range);
  const { payAccounts } = await import("@/server/pay");
  const list = await payAccounts(entityId), labels = new Map(list.map((a) => [a.id, a.label])), known = new Set(list.map((a) => a.id));
  const [rows, before] = await Promise.all([cashMoves(entityId, from, to, opts, known), cashMoves(entityId, new Date(0), from, opts, known)]);
  const ccyOf = (a: { id: string; label: string }) => /\b([A-Z]{3})\b/.exec(a.label.replace(/^[A-Za-z]+\s/, ""))?.[1] ?? "THB";
  const keys = [...new Set([...list.map((a) => `${a.id}|${ccyOf(a)}`), ...[...rows, ...before].map((x) => `${x.account}|${x.currency}`)])];
  const accounts = keys.map((k) => { const [account, currency] = k.split("|"); const mine = rows.filter((x) => x.account === account && x.currency === currency), old = before.filter((x) => x.account === account && x.currency === currency);
    const opening = r2(old.reduce((a, x) => a + x.inAmt - x.outAmt, 0)), inAmt = r2(mine.reduce((a, x) => a + x.inAmt, 0)), outAmt = r2(mine.reduce((a, x) => a + x.outAmt, 0));
    return { account, currency, label: account ? labels.get(account) ?? account : "", opening, inAmt, outAmt, closing: r2(opening + inAmt - outAmt), rows: mine, earlier: account ? [] : old.filter((x) => x.rcNo) }; })
    .filter((a) => a.account || a.rows.length || a.earlier.length || Math.abs(a.opening) > 0.005)
    .sort((a, b) => (a.account ? 0 : 1) - (b.account ? 0 : 1));
  return { range, accounts, rows, options: list, label: (id: string) => (id ? labels.get(id) ?? id : "") };
}

/**
 * 简易资产负债表 (V4-P0-14), THB, as the system knows it at the end of a day: what customers owe, the stock at its last
 * purchase cost, what we owe suppliers, VAT and withholding to remit, payroll approved and not yet paid — and the money
 * that moved through the system since it started (no opening balances are on file). Net = assets − liabilities. A
 * management view: the accountant's books remain the record.
 */
export async function simpleBalance(entityId: string, asOf: string, opts: { includeTest?: boolean }) {
  const end = bounds({ from: asOf, to: asOf }).to, yStart = bounds({ from: `${asOf.slice(0, 4)}-01-01`, to: asOf }).from, mStart = bounds({ from: `${asOf.slice(0, 7)}-01`, to: asOf }).from;
  const T = (no: string, ...more: (string | null | undefined)[]) => opts.includeTest || !isTest(no, ...more);
  const [invs, rcs, cns, sis, pays, moves, tisM, sisM, expM, whtM, runs, exps] = await Promise.all([
    prisma.invoice.findMany({ where: { cancelledAt: null, currency: "THB", issuedAt: { lt: end }, serviceOrder: { entityId } }, select: { id: true, no: true, amountDue: true } }),
    prisma.receipt.findMany({ where: { voidedAt: null, currency: "THB", receivedAt: { lt: end }, invoice: { serviceOrder: { entityId } } }, select: { no: true, invoiceId: true, cashAmount: true, settledAmount: true } }),
    prisma.creditNote.findMany({ where: { voidedAt: null, currency: "THB", issuedAt: { gte: end }, taxInvoice: { serviceOrder: { entityId } } }, select: { invoiceId: true, total: true } }), // credit notes written after the day are put back
    prisma.supplierInvoice.findMany({ where: { entityId, status: { not: "CANCELLED" }, currency: "THB", invoiceDate: { lt: end } }, select: { id: true, invoiceNo: true, total: true, supplier: { select: { name: true } } } }),
    prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { lt: end }, supplierInvoice: { currency: "THB" } }, select: { supplierInvoiceId: true, amount: true, whtAmount: true, paidAt: true, supplierInvoice: { select: { invoiceNo: true, supplier: { select: { name: true } } } } } }),
    prisma.stockMovement.findMany({ where: { kind: "PART", partId: { not: null }, movedAt: { lt: end } }, select: { direction: true, qty: true, part: { select: { lastCost: true, lastCostCurrency: true } } } }),
    prisma.taxInvoice.findMany({ where: { voidedAt: null, currency: "THB", issuedAt: { gte: mStart, lt: end }, serviceOrder: { entityId } }, select: { no: true, vatAmount: true } }),
    prisma.supplierInvoice.findMany({ where: { entityId, status: { not: "CANCELLED" }, accrued: false, currency: "THB", invoiceDate: { gte: mStart, lt: end } }, select: { invoiceNo: true, vatAmount: true, supplier: { select: { name: true } } } }),
    prisma.expenseClaim.findMany({ where: { entityId, status: { in: ["APPROVED", "PAID"] }, currency: "THB", spentOn: { gte: mStart, lt: end } }, select: { vatAmount: true } }),
    prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { gte: mStart, lt: end } }, select: { whtAmount: true } }),
    prisma.payrollRun.findMany({ where: { entityId, status: "APPROVED" }, select: { totals: true } }),
    prisma.expenseClaim.findMany({ where: { entityId, status: "PAID", currency: "THB", paidAt: { lt: end }, NOT: { paidRef: { startsWith: "PAYROLL" } } }, select: { amount: true } }),
  ]);
  void yStart;
  const got = new Map<string, number>(); for (const r of rcs) if (T(r.no)) got.set(r.invoiceId, (got.get(r.invoiceId) ?? 0) + Number(r.settledAmount));
  const back = new Map<string, number>(); for (const c of cns) if (c.invoiceId) back.set(c.invoiceId, (back.get(c.invoiceId) ?? 0) + Number(c.total));
  const receivable = r2(invs.filter((i) => T(i.no)).reduce((a, i) => a + Math.max(0, Number(i.amountDue) + (back.get(i.id) ?? 0) - (got.get(i.id) ?? 0)), 0));
  const paid = new Map<string, number>(); for (const p of pays) paid.set(p.supplierInvoiceId, (paid.get(p.supplierInvoiceId) ?? 0) + Number(p.amount) + Number(p.whtAmount));
  const payable = r2(sis.filter((i) => T(i.invoiceNo, i.supplier.name)).reduce((a, i) => a + Math.max(0, Number(i.total) - (paid.get(i.id) ?? 0)), 0));
  void moves;
  const stock = r2([...(await fifoOf(undefined, end)).values()].reduce((a, f) => a + f.value, 0)); // N-41: what is left in the batches, at their own costs (先进先出)
  const cashIn = r2(rcs.filter((r) => T(r.no)).reduce((a, r) => a + Number(r.cashAmount), 0));
  const cashOut = r2(pays.filter((p) => T(p.supplierInvoice.invoiceNo, p.supplierInvoice.supplier.name)).reduce((a, p) => a + Number(p.amount), 0) + exps.reduce((a, e) => a + Number(e.amount), 0));
  const vat = r2(tisM.filter((x) => T(x.no)).reduce((a, x) => a + Number(x.vatAmount), 0) - sisM.filter((x) => T(x.invoiceNo, x.supplier.name)).reduce((a, x) => a + Number(x.vatAmount), 0) - expM.reduce((a, x) => a + Number(x.vatAmount ?? 0), 0));
  const wht = r2(whtM.reduce((a, x) => a + Number(x.whtAmount), 0));
  const payroll = r2(runs.reduce((a, x) => a + Number((x.totals as { net?: number }).net ?? 0), 0));
  // 财神爷 2026-11-18: 现金 is two lines — 现金 / 备用金 (cash on hand, petty cash) and 银行存款 (every bank account, and what
  // has no account of ours yet). Same movements as the detail lists, so each line adds up to its list.
  const { payAccounts } = await import("@/server/pay");
  const accs = await payAccounts(entityId);
  const thb = (await cashMoves(entityId, new Date(0), end, { withPayroll: false, includeTest: opts.includeTest }, new Set(accs.map((x) => x.id)))).filter((x) => x.currency === "THB");
  const onHand = (x: { account: string }) => x.account === "CASH" || x.account === "PETTY_CASH";
  const cashHand = r2(thb.filter(onHand).reduce((a, x) => a + x.inAmt - x.outAmt, 0)), cashBank = r2(thb.filter((x) => !onHand(x)).reduce((a, x) => a + x.inAmt - x.outAmt, 0));
  void cashIn; void cashOut;
  const assets = { cashMoved: r2(cashHand + cashBank), cashHand, cashBank, receivable, stock }, liabilities = { payable, vat: Math.max(0, vat), wht, payroll };
  const totalAssets = r2(assets.cashMoved + receivable + stock), totalLiabilities = r2(payable + liabilities.vat + wht + payroll);
  return { asOf, assets, liabilities, totalAssets, totalLiabilities, net: r2(totalAssets - totalLiabilities), vatCredit: vat < 0 ? -vat : 0 };
}

/** 报表下钻 (测试 2026-11-18): a row opens its own document — the issued PDF for TI / IV / RC, the page row for the rest */
const pdfOf = (no: string) => `/api/documents/${encodeURIComponent(no)}/render?format=pdf&inline=1`;
const pvOf = (no: string) => `/finance/payables?pv=${encodeURIComponent(no)}#${no}`;
const siOf = (po: string, inv: string) => `/purchasing/orders/${po}#si-${encodeURIComponent(inv)}`;
const exOf = (no: string) => (no ? `/finance/expenses?no=${encodeURIComponent(no)}#${no}` : "/finance/expenses");
/**
 * 报表下钻 (派修单 v4 P0-1): the documents behind one number of the reports — the same filters as the number itself,
 * so the list adds up to it. Each row opens its document.
 */
export type DetailKind = "result" | "vatNet" | "revenue" | "vatOut" | "collected" | "whtByCustomers" | "purchases" | "vatIn" | "paidSuppliers" | "expenses" | "payroll" | "stock" | "vatDue" | "whtDue" | "payrollDue" | "bsCash" | "bsCashHand" | "bsCashBank" | "bsAr" | "bsAp";
export interface DetailRow { date: Date | null; no: string; who: string; note?: string; amount: number; href: string }
export async function reportDetail(entityId: string, range: Range, kind: DetailKind, opts: { withPayroll: boolean; includeTest?: boolean; mode?: string; customer?: string; category?: string }): Promise<{ rows: DetailRow[]; total: number }> {
  const { from, to } = bounds(range), T = (...x: (string | null | undefined)[]) => opts.includeTest || !isTest(...x);
  let rows: DetailRow[] = [];
  if (kind === "revenue" || kind === "vatOut") {
    const [tis, cns] = await Promise.all([
      prisma.taxInvoice.findMany({ where: { voidedAt: null, issuedAt: { gte: from, lt: to }, serviceOrder: { entityId, ...(opts.mode ? { mode: opts.mode as never } : {}), ...(opts.customer ? { customer: { name: opts.customer } } : {}) } }, select: { no: true, issuedAt: true, subtotal: true, vatAmount: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } }),
      prisma.creditNote.findMany({ where: { voidedAt: null, issuedAt: { gte: from, lt: to }, currency: "THB", taxInvoice: { serviceOrder: { entityId, ...(opts.mode ? { mode: opts.mode as never } : {}), ...(opts.customer ? { customer: { name: opts.customer } } : {}) } } }, select: { no: true, issuedAt: true, subtotal: true, vatAmount: true, taxInvoice: { select: { serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } } } }),
    ]);
    rows = [...tis.filter((x) => T(x.no)).map((x) => ({ date: x.issuedAt, no: x.no, who: x.serviceOrder.customer.name, note: x.serviceOrder.no, amount: Number(kind === "revenue" ? x.subtotal : x.vatAmount), href: pdfOf(x.no) })),
      ...cns.map((x) => ({ date: x.issuedAt, no: x.no, who: x.taxInvoice.serviceOrder.customer.name, note: x.taxInvoice.serviceOrder.no, amount: -Number(kind === "revenue" ? x.subtotal : x.vatAmount), href: `/service-orders/${x.taxInvoice.serviceOrder.no}/invoice` }))];
  } else if (kind === "collected" || kind === "whtByCustomers") {
    rows = (await prisma.receipt.findMany({ where: { voidedAt: null, receivedAt: { gte: from, lt: to }, currency: "THB", invoice: { serviceOrder: { entityId } } }, select: { no: true, receivedAt: true, cashAmount: true, whtAmount: true, bankRef: true, invoice: { select: { serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } } } }))
      .filter((x) => T(x.no)).map((x) => ({ date: x.receivedAt, no: x.no, who: x.invoice.serviceOrder.customer.name, note: x.bankRef ?? x.invoice.serviceOrder.no, amount: Number(kind === "collected" ? x.cashAmount : x.whtAmount), href: pdfOf(x.no) }));
  } else if (kind === "purchases" || kind === "vatIn") {
    const sis = await prisma.supplierInvoice.findMany({ where: { entityId, status: { not: "CANCELLED" }, currency: "THB", invoiceDate: { gte: from, lt: to }, ...(kind === "vatIn" ? { accrued: false } : {}) }, select: { id: true, invoiceNo: true, invoiceDate: true, subtotal: true, vatAmount: true, supplier: { select: { name: true } }, purchaseOrder: { select: { no: true } } } });
    rows = sis.filter((x) => T(x.invoiceNo, x.supplier.name)).map((x) => ({ date: x.invoiceDate, no: x.invoiceNo, who: x.supplier.name, note: x.purchaseOrder.no, amount: Number(kind === "purchases" ? x.subtotal : x.vatAmount), href: siOf(x.purchaseOrder.no, x.invoiceNo) }));
    if (kind === "vatIn") rows.push(...(await prisma.expenseClaim.findMany({ where: { entityId, status: { in: ["APPROVED", "PAID"] }, currency: "THB", spentOn: { gte: from, lt: to }, vatAmount: { gt: 0 } }, select: { no: true, spentOn: true, vatAmount: true, employee: { select: { name: true } } } })).map((x) => ({ date: x.spentOn, no: x.no ?? "", who: x.employee.name, amount: Number(x.vatAmount ?? 0), href: exOf(x.no ?? "") })));
  } else if (kind === "paidSuppliers") {
    rows = (await prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { gte: from, lt: to }, supplierInvoice: { currency: "THB" } }, select: { no: true, paidAt: true, amount: true, supplierInvoice: { select: { invoiceNo: true, supplier: { select: { name: true } } } } } }))
      .filter((x) => T(x.supplierInvoice.invoiceNo, x.supplierInvoice.supplier.name)).map((x) => ({ date: x.paidAt, no: x.no, who: x.supplierInvoice.supplier.name, note: x.supplierInvoice.invoiceNo, amount: Number(x.amount), href: pvOf(x.no) }));
  } else if (kind === "expenses") {
    rows = (await prisma.expenseClaim.findMany({ where: { entityId, status: { in: ["APPROVED", "PAID"] }, currency: "THB", spentOn: { gte: from, lt: to }, ...(opts.category ? { category: opts.category } : {}) }, select: { no: true, spentOn: true, amount: true, vatAmount: true, category: true, employee: { select: { name: true } } } }))
      .map((x) => ({ date: x.spentOn, no: x.no ?? "", who: x.employee.name, note: x.category, amount: Number(x.amount) - Number(x.vatAmount ?? 0), href: exOf(x.no ?? "") }));
  } else if (kind === "payroll" || kind === "payrollDue") {
    if (opts.withPayroll) rows = (await prisma.payrollRun.findMany({ where: { entityId, ...(kind === "payroll" ? { status: { not: "DRAFT" }, month: { gte: range.from.slice(0, 7), lte: range.to.slice(0, 7) } } : { status: "APPROVED" }) }, select: { month: true, totals: true, approvedAt: true } }))
      .map((x) => ({ date: x.approvedAt, no: x.month, who: "", amount: Number((x.totals as { employerCost?: number; net?: number })[kind === "payroll" ? "employerCost" : "net"] ?? 0), href: `/people/payroll/${x.month}` }));
  } else if (kind === "stock") { // N-41: one row per batch still in stock — it opens the receipt (IBTH) it came in on
    for (const f of (await fifoOf(undefined, to)).values()) for (const bt of f.batches) rows.push({ date: bt.date, no: bt.inNo, who: `${f.sku} ${f.name}`.trim(), note: `${bt.left} × ${bt.cost.toFixed(2)}`, amount: r2(bt.left * bt.cost), href: `/parts/movement/${bt.inNo}` });
  } else if (kind === "result" || kind === "vatNet") { // a figure made of others: its parts, signed, so the list adds up to it
    const parts: [DetailKind, number][] = kind === "result" ? [["revenue", 1], ["purchases", -1], ["expenses", -1], ["payroll", -1]] : [["vatOut", 1], ["vatIn", -1]];
    for (const [k, sign] of parts) rows.push(...(await reportDetail(entityId, range, k, opts)).rows.map((x) => ({ ...x, amount: sign * x.amount })));
  } else if (kind === "bsCash" || kind === "bsCashHand" || kind === "bsCashBank") { // 资产负债表 → 现金银行: every receipt and payment the system holds up to the day (派修单 v5 P0-1)
    const { payAccounts } = await import("@/server/pay");
    const list = await payAccounts(entityId), labels = new Map(list.map((x) => [x.id, x.label]));
    rows = (await cashMoves(entityId, new Date(0), to, { withPayroll: false, includeTest: opts.includeTest }, new Set(list.map((x) => x.id)))).filter((x) => x.currency === "THB" && !x.no.startsWith("PAYROLL"))
      .filter((x) => kind === "bsCash" || (kind === "bsCashHand") === (x.account === "CASH" || x.account === "PETTY_CASH"))
      .map((x) => ({ date: x.date, no: x.no, who: x.who, note: labels.get(x.account) ?? x.ref, amount: x.inAmt - x.outAmt, href: x.href }));
  } else if (kind === "bsAr") {
    const [invs, rcs, cns] = await Promise.all([
      prisma.invoice.findMany({ where: { cancelledAt: null, currency: "THB", issuedAt: { lt: to }, serviceOrder: { entityId } }, select: { id: true, no: true, issuedAt: true, amountDue: true, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } }),
      prisma.receipt.findMany({ where: { voidedAt: null, currency: "THB", receivedAt: { lt: to }, invoice: { serviceOrder: { entityId } } }, select: { no: true, invoiceId: true, settledAmount: true } }),
      prisma.creditNote.findMany({ where: { voidedAt: null, currency: "THB", issuedAt: { gte: to }, taxInvoice: { serviceOrder: { entityId } } }, select: { invoiceId: true, total: true } }),
    ]);
    const got = new Map<string, number>(); for (const r of rcs) if (T(r.no)) got.set(r.invoiceId, (got.get(r.invoiceId) ?? 0) + Number(r.settledAmount));
    const back = new Map<string, number>(); for (const c of cns) if (c.invoiceId) back.set(c.invoiceId, (back.get(c.invoiceId) ?? 0) + Number(c.total));
    rows = invs.filter((i) => T(i.no)).map((i) => ({ date: i.issuedAt, no: i.no, who: i.serviceOrder.customer.name, note: i.serviceOrder.no, amount: r2(Math.max(0, Number(i.amountDue) + (back.get(i.id) ?? 0) - (got.get(i.id) ?? 0))), href: pdfOf(i.no) })).filter((x) => x.amount > 0.005);
  } else if (kind === "bsAp") {
    const [sis, pays] = await Promise.all([
      prisma.supplierInvoice.findMany({ where: { entityId, status: { not: "CANCELLED" }, currency: "THB", invoiceDate: { lt: to } }, select: { id: true, invoiceNo: true, invoiceDate: true, total: true, supplier: { select: { name: true } }, purchaseOrder: { select: { no: true } } } }),
      prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { lt: to }, supplierInvoice: { currency: "THB" } }, select: { supplierInvoiceId: true, amount: true, whtAmount: true } }),
    ]);
    const paid = new Map<string, number>(); for (const p of pays) paid.set(p.supplierInvoiceId, (paid.get(p.supplierInvoiceId) ?? 0) + Number(p.amount) + Number(p.whtAmount));
    rows = sis.filter((i) => T(i.invoiceNo, i.supplier.name)).map((i) => ({ date: i.invoiceDate, no: i.invoiceNo, who: i.supplier.name, note: i.purchaseOrder.no, amount: r2(Math.max(0, Number(i.total) - (paid.get(i.id) ?? 0))), href: siOf(i.purchaseOrder.no, i.invoiceNo) })).filter((x) => x.amount > 0.005);
  } else if (kind === "vatDue") {
    const mr = { from: `${range.to.slice(0, 7)}-01`, to: range.to };
    const [o, i] = await Promise.all([reportDetail(entityId, mr, "vatOut", opts), reportDetail(entityId, mr, "vatIn", opts)]);
    rows = [...o.rows, ...i.rows.map((x) => ({ ...x, amount: -x.amount }))];
  } else if (kind === "whtDue") {
    const ms = bounds({ from: `${range.to.slice(0, 7)}-01`, to: range.to });
    rows = (await prisma.supplierPayment.findMany({ where: { entityId, status: "PAID", paidAt: { gte: ms.from, lt: ms.to }, whtAmount: { gt: 0 } }, select: { id: true, no: true, paidAt: true, whtAmount: true, whtCertNo: true, supplierInvoice: { select: { supplier: { select: { name: true } } } } } }))
      .map((x) => ({ date: x.paidAt, no: x.whtCertNo ?? x.no, who: x.supplierInvoice.supplier.name, note: x.no, amount: Number(x.whtAmount), href: `/finance/payables/wht/${x.id}` }));
  }
  rows.sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  return { rows, total: r2(rows.reduce((a, x) => a + x.amount, 0)) };
}
