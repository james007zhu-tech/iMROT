/**
 * 月度工资: builds a month's payroll from what the system already knows — the salary in force, the closed overtime
 * month, the month's performance scores and approved expense claims — and keeps it editable until the MD approves.
 * MD only, except the performance scores (a manager scores the people who report to them) and one's own payslip.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { monthRange } from "@/lib/overtime";
import type { Allowance } from "@/lib/payroll";
import { DEFAULT_BANDS, computeLine, isQuarterEnd, periodsInYear, quarterOf, type PerfBand, type TaxProfile } from "@/lib/payroll-run";

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** What stops approval: a missing score or sales target, or overtime not yet closed. */
export const BLOCKING = ["PERFORMANCE", "TARGET", "TARGET_Q", "OVERTIME_OPEN"];

async function md(actorCode: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (a.role !== "MD") throw new Error("MD_ONLY");
  return a;
}

export interface LineEdit { bonus?: number; otherDeduction?: number; whtManual?: number | null; note?: string }

/** Create or refresh the DRAFT run of a month. Typed figures (bonus, other deduction, typed withholding, note) survive a refresh. */
export async function computePayroll(input: { entityId: string; month: string; actorCode: string; edits?: Record<string, LineEdit> }) {
  if (!MONTH.test(input.month)) throw new Error(`BAD_MONTH:${input.month}`);
  const actor = await md(input.actorCode);
  const { from, to } = monthRange(input.month);
  const lastDay = new Date(to.getTime() - 1);
  const existing = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId: input.entityId, month: input.month } }, include: { lines: true } });
  if (existing && existing.status !== "DRAFT") throw new Error(`PAYROLL_LOCKED:${input.month}`);
  const bands = ((existing?.policy as { bands?: PerfBand[] } | null)?.bands) ?? DEFAULT_BANDS;

  const staff = await prisma.employee.findMany({
    where: { entityId: input.entityId, OR: [{ joinedAt: null }, { joinedAt: { lt: to } }], AND: [{ OR: [{ leftAt: null, active: true }, { leftAt: { gte: from } }] }] },
    orderBy: { code: "asc" },
  });
  const ids = staff.map((e) => e.id);
  const yearStart = `${input.month.slice(0, 4)}-01`;
  const [otMonth, reviews, earlier, claims] = await Promise.all([
    prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId: input.entityId, month: input.month } }, include: { lines: true } }),
    prisma.performanceReview.findMany({ where: { employeeId: { in: ids }, kind: "MONTHLY", period: input.month } }),
    prisma.payrollLine.findMany({ where: { employeeId: { in: ids }, run: { entityId: input.entityId, month: { gte: yearStart, lt: input.month }, status: { not: "DRAFT" } } }, select: { employeeId: true, overtime: true, incentive: true, bonus: true, quarterIncentive: true } }),
    prisma.expenseClaim.findMany({ where: { employeeId: { in: ids }, status: "APPROVED", paidBy: "SELF", spentOn: { lt: to }, OR: [{ payrollRunId: null }, ...(existing ? [{ payrollRunId: existing.id }] : [])] } }),
  ]);
  const quarter = quarterOf(input.month), qEnd = isQuarterEnd(input.month);
  const targets = await salesProgress(input.entityId, [input.month, ...(qEnd ? [quarter] : [])], ids);
  const otOpen = !otMonth && (await prisma.overtimeRequest.count({ where: { entityId: input.entityId, status: "APPROVED", payMonthId: null, workDate: { lt: to } } })) > 0;

  const lines: (Prisma.PayrollLineUncheckedCreateWithoutRunInput & { claimIds: string[] })[] = [];
  const skipped: string[] = [];
  for (const e of staff) {
    const salary = await prisma.salaryRecord.findFirst({ where: { employeeId: e.id, effectiveFrom: { lte: lastDay } }, orderBy: { effectiveFrom: "desc" } });
    // no salary record = not on this payroll (paid elsewhere, or the file is not complete yet): named on the page, never a zero line
    if (!salary) { skipped.push(`${e.code} ${e.name}`); continue; }
    const old = existing?.lines.find((l) => l.employeeId === e.id);
    const edit = input.edits?.[e.code];
    const bonus = edit?.bonus ?? Number(old?.bonus ?? 0);
    const otherDeduction = edit?.otherDeduction ?? Number(old?.otherDeduction ?? 0);
    const whtManual = edit && "whtManual" in edit ? edit.whtManual : old?.whtManual ? Number(old.wht) : null;
    const note = edit?.note ?? old?.note ?? null;
    const review = reviews.find((r) => r.employeeId === e.id);
    const mine = claims.filter((c) => c.employeeId === e.id);
    const reimbursement = r2(mine.reduce((s, c) => s + Number(c.amount), 0));
    const overtime = Number(otMonth?.lines.find((l) => l.employeeId === e.id)?.total ?? 0);
    const variablePay = Number(salary?.variablePay ?? 0);
    const missing: string[] = [];
    // sales are paid on targets (朱总 2026-11-11), everyone else on the manager's monthly score
    const sales = e.role === "SALES";
    const mt = targets.find((t) => t.employeeId === e.id && t.period === input.month), qt = targets.find((t) => t.employeeId === e.id && t.period === quarter);
    const quarterlyPay = qEnd ? r2(Number(salary.quarterlyPay ?? 0) * 3) : 0;
    if (sales ? variablePay > 0 && !mt : variablePay > 0 && !review) missing.push(sales ? "TARGET" : "PERFORMANCE");
    if (quarterlyPay > 0 && !qt) missing.push("TARGET_Q");
    if (otOpen) missing.push("OVERTIME_OPEN");
    if (!e.taxNo) missing.push("TAX_ID");
    if (!e.ssoNo) missing.push("SSO_NO");
    if (!e.bankAccount) missing.push("BANK");
    const allowances = ((salary?.allowances as Allowance[] | null) ?? []);
    const num = (d: unknown) => (d == null ? null : Number(d));
    const c = computeLine({
      baseSalary: Number(salary?.baseSalary ?? 0), allowances, overtime, variablePay, perfScore: num(review?.score), bands, bonus,
      ...(sales ? { achievement: mt?.achievement ?? null } : {}), quarterlyPay, quarterAchieved: qt?.achievement ?? null,
      ssoWageBase: num(salary?.ssoWageBase), ssoEmployeeRate: num(salary?.ssoEmployeeRate), ssoEmployerRate: num(salary?.ssoEmployerRate), pvdEmployeeRate: num(salary?.pvdEmployeeRate), pvdEmployerRate: num(salary?.pvdEmployerRate),
      profile: salary?.taxDeductions as TaxProfile | null, periods: periodsInYear(input.month, e.joinedAt),
      irregularBefore: r2(earlier.filter((l) => l.employeeId === e.id).reduce((s, l) => s + Number(l.overtime) + Number(l.incentive) + Number(l.quarterIncentive) + Number(l.bonus), 0)),
      whtManual, otherDeduction, reimbursement,
    });
    lines.push({
      employeeId: e.id, salaryRecordId: salary?.id ?? null, baseSalary: Number(salary?.baseSalary ?? 0), allowances: allowances as unknown as Prisma.InputJsonValue, allowanceTotal: c.allowanceTotal,
      overtime, variablePay, perfScore: sales ? null : num(review?.score), perfFactor: c.perfFactor, incentive: c.incentive, bonus, gross: c.gross,
      perfBasis: sales ? "TARGET" : "SCORE", achievement: sales ? mt?.achievement ?? null : null, quarterlyPay, quarterAchieved: qt?.achievement ?? null, quarterFactor: c.quarterFactor, quarterIncentive: c.quarterIncentive,
      ssoBase: c.ssoBase, ssoEmployee: c.ssoEmployee, ssoEmployer: c.ssoEmployer, pvdEmployee: c.pvdEmployee, pvdEmployer: c.pvdEmployer,
      wht: c.wht, whtManual: whtManual != null, whtDetail: c.whtDetail as unknown as Prisma.InputJsonValue, otherDeduction, reimbursement, net: c.net, employerCost: c.employerCost, missing, note,
      claimIds: mine.map((x) => x.id),
    });
  }
  const sum = (k: "quarterIncentive" | "gross" | "ssoEmployee" | "ssoEmployer" | "wht" | "net" | "employerCost" | "reimbursement" | "overtime" | "incentive" | "bonus") => r2(lines.reduce((s, l) => s + Number(l[k] ?? 0), 0));
  const totals = { skipped, people: lines.length, gross: sum("gross"), overtime: sum("overtime"), incentive: r2(sum("incentive") + sum("quarterIncentive")), bonus: sum("bonus"), sso: sum("ssoEmployee"), ssoEmployer: sum("ssoEmployer"), wht: sum("wht"), reimbursement: sum("reimbursement"), net: sum("net"), employerCost: sum("employerCost") };

  return prisma.$transaction(async (tx) => {
    const run = existing
      ? await tx.payrollRun.update({ where: { id: existing.id }, data: { totals, computedAt: new Date(), policy: { bands } as unknown as Prisma.InputJsonValue } })
      : await tx.payrollRun.create({ data: { entityId: input.entityId, month: input.month, createdBy: actor.code, totals, policy: { bands } as unknown as Prisma.InputJsonValue } });
    await tx.payrollLine.deleteMany({ where: { runId: run.id } });
    for (const { claimIds, ...l } of lines) { await tx.payrollLine.create({ data: { ...l, runId: run.id } }); void claimIds; }
    await tx.expenseClaim.updateMany({ where: { payrollRunId: run.id }, data: { payrollRunId: null } });
    await tx.expenseClaim.updateMany({ where: { id: { in: lines.flatMap((l) => l.claimIds) } }, data: { payrollRunId: run.id } });
    if (!existing) await audit(actor.id, "PAYROLL_CREATE", input.month, { people: lines.length }, tx);
    return run;
  });
}

/** 绩效系数表: the MD changes the bands of a DRAFT month; the month is recomputed with them. */
export async function setBands(input: { entityId: string; month: string; actorCode: string; bands: PerfBand[] }) {
  await md(input.actorCode);
  const bands = input.bands.filter((b) => Number.isFinite(b.min) && Number.isFinite(b.factor) && b.factor >= 0 && b.factor <= 3).sort((a, b) => b.min - a.min);
  if (!bands.length || bands.at(-1)!.min !== 0) throw new Error("BANDS_NEED_ZERO");
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (run.status !== "DRAFT") throw new Error(`PAYROLL_LOCKED:${input.month}`);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { policy: { bands } as unknown as Prisma.InputJsonValue } });
  return computePayroll(input);
}

/** Approval locks the month. It refuses while a line lacks its performance score or overtime is still open, and when nobody is on it. */
export async function approvePayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await md(input.actorCode);
  const run = await computePayroll(input); // approve what is true now, not what was true at the last refresh
  const lines = await prisma.payrollLine.findMany({ where: { runId: run.id }, include: { employee: { select: { code: true } } } });
  const blocked = lines.filter((l) => l.missing.some((m) => BLOCKING.includes(m)));
  if (!lines.length) throw new Error(`PAYROLL_EMPTY:${input.month}`);
  if (blocked.length) throw new Error(`PAYROLL_INCOMPLETE:${blocked.map((l) => l.employee.code).join(", ")}`);
  // 朱总 2026-11-11 "按照会计的来": the withholding figures must have been checked against the accountant's before the month locks
  if (!run.taxConfirmedAt) throw new Error(`PAYROLL_TAX_UNCONFIRMED:${input.month}`);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedBy: actor.code, approvedAt: new Date() } });
  await audit(actor.id, "PAYROLL_APPROVE", input.month, { net: (run.totals as { net: number }).net });
}

export async function reopenPayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await md(input.actorCode);
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (run.status === "PAID") throw new Error(`PAYROLL_PAID:${input.month}`);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "DRAFT", approvedBy: null, approvedAt: null, taxConfirmedBy: null, taxConfirmedAt: null } });
  await audit(actor.id, "PAYROLL_REOPEN", input.month);
}

/** Paid: the month is final and the expense claims it carried are settled. */
export async function markPayrollPaid(input: { entityId: string; month: string; actorCode: string; paidAt?: Date }) {
  const actor = await md(input.actorCode);
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (run.status !== "APPROVED") throw new Error(`PAYROLL_NOT_APPROVED:${input.month}`);
  const paidAt = input.paidAt ?? new Date();
  await prisma.$transaction([
    prisma.payrollRun.update({ where: { id: run.id }, data: { status: "PAID", paidAt } }),
    prisma.expenseClaim.updateMany({ where: { payrollRunId: run.id, status: "APPROVED" }, data: { status: "PAID", paidAt, paidRef: `PAYROLL ${input.month}` } }),
  ]);
  await audit(actor.id, "PAYROLL_PAID", input.month);
}

/** 月度绩效: who may score whom — the MD everyone, a manager the people who report to them; nobody scores themselves. */
export async function scorable(actorCode: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  return prisma.employee.findMany({ where: { active: true, entityId: a.entityId, id: { not: a.id }, ...(a.role === "MD" ? {} : { managerId: a.id }) }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, position: true, managerId: true } });
}

export async function saveScores(input: { actorCode: string; month: string; scores: { code: string; score: number; conclusion?: string }[] }) {
  if (!MONTH.test(input.month)) throw new Error(`BAD_MONTH:${input.month}`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const allowed = new Map((await scorable(input.actorCode)).map((e) => [e.code, e.id]));
  const locked = await prisma.payrollRun.findFirst({ where: { entityId: actor.entityId, month: input.month, status: { not: "DRAFT" } } });
  if (locked) throw new Error(`PAYROLL_LOCKED:${input.month}`);
  let n = 0;
  for (const s of input.scores) {
    const employeeId = allowed.get(s.code);
    if (!employeeId) throw new Error(`NOT_YOUR_REPORT:${s.code}`);
    if (!(s.score >= 0 && s.score <= 100)) throw new Error(`BAD_SCORE:${s.code}`);
    const old = await prisma.performanceReview.findFirst({ where: { employeeId, kind: "MONTHLY", period: input.month } });
    const data = { score: s.score, conclusion: s.conclusion || null, reviewerId: actor.id, reviewedAt: new Date() };
    if (old) await prisma.performanceReview.update({ where: { id: old.id }, data });
    else await prisma.performanceReview.create({ data: { ...data, employeeId, kind: "MONTHLY", period: input.month } });
    n++;
  }
  await audit(actor.id, "PERFORMANCE_SCORE", input.month, { people: n });
  return n;
}

export async function payrollRuns(entityId: string) {
  return prisma.payrollRun.findMany({ where: { entityId }, orderBy: { month: "desc" }, take: 24 });
}
export async function payrollDetail(entityId: string, month: string) {
  return prisma.payrollRun.findUnique({ where: { entityId_month: { entityId, month } }, include: { lines: { include: { employee: true }, orderBy: { employee: { code: "asc" } } } } });
}
/** A person's own payslips: approved or paid months only. */
export async function mySlips(employeeId: string) {
  return prisma.payrollLine.findMany({ where: { employeeId, run: { status: { not: "DRAFT" } } }, include: { run: { select: { month: true, status: true, paidAt: true } } }, orderBy: { run: { month: "desc" } }, take: 24 });
}

/** 个税按会计的来: the MD ticks that every withholding figure matches the accountant's (typed where it differed). */
export async function confirmTax(input: { entityId: string; month: string; actorCode: string; confirmed: boolean }) {
  const actor = await md(input.actorCode);
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (run.status !== "DRAFT") throw new Error(`PAYROLL_LOCKED:${input.month}`);
  await prisma.payrollRun.update({ where: { id: run.id }, data: input.confirmed ? { taxConfirmedBy: actor.code, taxConfirmedAt: new Date() } : { taxConfirmedBy: null, taxConfirmedAt: null } });
  if (input.confirmed) await audit(actor.id, "PAYROLL_TAX_CONFIRMED", input.month);
}

// ───────── 销售目标 ─────────
export const METRICS = ["COLLECTED", "INVOICED"] as const;
const periodRange = (period: string) => {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return { from: monthRange(`${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}`).from, to: monthRange(`${q[1]}-${String(Number(q[2]) * 3).padStart(2, "0")}`).to };
  if (!MONTH.test(period)) throw new Error(`BAD_MONTH:${period}`);
  return monthRange(period);
};

/**
 * What a salesperson brought in during a period, from the orders they opened. COLLECTED = payments received (the
 * user's own definition of a sales result runs to the money in the bank); INVOICED = tax invoices issued, before VAT.
 */
async function systemActual(employeeId: string, metric: string, period: string): Promise<number> {
  const { from, to } = periodRange(period);
  if (metric === "INVOICED") {
    const x = await prisma.taxInvoice.aggregate({ _sum: { subtotal: true }, where: { voidedAt: null, issuedAt: { gte: from, lt: to }, serviceOrder: { createdById: employeeId } } });
    return Number(x._sum.subtotal ?? 0);
  }
  const x = await prisma.receipt.aggregate({ _sum: { cashAmount: true, whtAmount: true }, where: { receivedAt: { gte: from, lt: to }, currency: "THB", invoice: { serviceOrder: { createdById: employeeId } } } });
  return Number(x._sum.cashAmount ?? 0) + Number(x._sum.whtAmount ?? 0);
}

export async function salesProgress(entityId: string, periods: string[], employeeIds?: string[]) {
  const rows = await prisma.salesTarget.findMany({ where: { entityId, period: { in: periods }, ...(employeeIds ? { employeeId: { in: employeeIds } } : {}) } });
  return Promise.all(rows.map(async (t) => {
    const system = r2(await systemActual(t.employeeId, t.metric, t.period));
    const actual = t.actualManual != null ? Number(t.actualManual) : system;
    const target = Number(t.target);
    return { ...t, system, actual, achievement: target > 0 ? Math.round((actual / target) * 10000) / 10000 : null };
  }));
}

export async function setSalesTarget(input: { actorCode: string; employeeCode: string; period: string; target: number; metric?: string; actualManual?: number | null; note?: string }) {
  const actor = await md(input.actorCode);
  periodRange(input.period);
  if (!(input.target > 0)) throw new Error("TARGET_MUST_BE_POSITIVE");
  const e = await prisma.employee.findUniqueOrThrow({ where: { code: input.employeeCode } });
  // the payroll that pays this target: the month itself, or the quarter's last month
  const q = /^(\d{4})-Q([1-4])$/.exec(input.period);
  const payMonth = q ? `${q[1]}-${String(Number(q[2]) * 3).padStart(2, "0")}` : input.period;
  const locked = await prisma.payrollRun.findFirst({ where: { entityId: e.entityId, month: payMonth, status: { not: "DRAFT" } } });
  if (locked) throw new Error(`PAYROLL_LOCKED:${payMonth}`);
  const metric = (METRICS as readonly string[]).includes(input.metric ?? "") ? input.metric! : "COLLECTED";
  const data = { target: input.target, metric, actualManual: input.actualManual ?? null, note: input.note?.trim() || null, setById: actor.id };
  await prisma.salesTarget.upsert({ where: { employeeId_period: { employeeId: e.id, period: input.period } }, create: { ...data, entityId: e.entityId, employeeId: e.id, period: input.period }, update: data });
  await audit(actor.id, "SALES_TARGET", `${e.code} ${input.period}`, { target: input.target, metric });
}
