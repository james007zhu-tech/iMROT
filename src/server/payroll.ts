import { OT_MULTIPLIER } from "@/lib/overtime";
/**
 * 月度工资: builds a month's payroll from what the system already knows — the salary in force, the closed overtime
 * month, the month's performance scores and approved expense claims — and keeps it editable until the MD approves.
 * MD only, except the performance scores (a manager scores the people who report to them) and one's own payslip.
 */
import { unpaidLeaveOfMonth } from "@/server/leave";
import { leaveDeduction } from "@/lib/leave";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { monthRange } from "@/lib/overtime";
import { previewOvertimeMonth, closeOvertimeMonth } from "@/server/overtime";
import type { Allowance } from "@/lib/payroll";
import { DEFAULT_BANDS, computeLine, isQuarterEnd, periodsInYear, quarterOf, type PerfBand, type TaxProfile } from "@/lib/payroll-run";
import { hasRole, isApprover } from "@/lib/caps";

const r2 = (n: number) => Math.round(n * 100) / 100;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
/** What stops approval: a missing score or sales target, or overtime not yet closed. */
export const BLOCKING = ["PERFORMANCE", "TARGET", "TARGET_Q", "OVERTIME_OPEN", "OVERTIME_LATE"];
/** What stops the finance review (需求清单 v3 P1-25): pay cannot go to an empty bank account, nor leave overtime out. The rest is listed and acknowledged. */
export const REVIEW_BLOCKING = ["BANK", "OVERTIME_OPEN", "OVERTIME_LATE"];
export const REVIEW_NOTED = ["TAX_ID", "SSO_NO", "JOINED"];

async function md(actorCode: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (!hasRole(a, "MD")) throw new Error("MD_ONLY");
  return a;
}

/** 内勤 computes, 财务 reviews and pays, the MD approves — three different people (朱总 2026-11-15). */
async function roleOf(actorCode: string, role: "HR" | "FINANCE", err: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (!hasRole(a, role)) throw new Error(err);
  return a;
}

export interface LineEdit { bonus?: number; otherDeduction?: number; whtManual?: number | null; note?: string }

/** Create or refresh the DRAFT run of a month. Typed figures (bonus, other deduction, typed withholding, note) survive a refresh. */
export async function computePayroll(input: { entityId: string; month: string; actorCode: string; edits?: Record<string, LineEdit> }, internal = false) {
  if (!MONTH.test(input.month)) throw new Error(`BAD_MONTH:${input.month}`);
  // `internal`: the MD's own steps (bands, approval) re-run the sums without becoming the preparer
  const actor = internal ? await md(input.actorCode) : await roleOf(input.actorCode, "HR", "PAYROLL_PREPARER_ONLY");
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
  // 加班费未月结 is said only of people who have overtime waiting (需求清单 v3 P1-16) — not of the whole company
  // (需求清单 v3 P0-10 第 7 轮) Approved overtime is in the draft at once — no waiting for the month-end close, which now
  // happens when the MD approves the payroll. What still stops the month is overtime nobody has decided yet.
  const otWaiting = new Set((await prisma.overtimeRequest.findMany({ where: { entityId: input.entityId, status: "PENDING", workDate: { lt: to } }, select: { employeeId: true } })).map((r) => r.employeeId));
  const otPreview = otMonth ? null : await previewOvertimeMonth(input.entityId, input.month);
  const unpaidLeave = await unpaidLeaveOfMonth(ids, input.month); // 请假 (v4 V4-P0-12): 无薪假 and leave beyond the paid days of the year

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
    const overtime = otMonth ? Number(otMonth.lines.find((l) => l.employeeId === e.id)?.total ?? 0) : r2(otPreview?.find((l) => l.employeeId === e.id)?.pay.total ?? 0);
    const otLateFrom = (otMonth ? (otMonth.lines.find((l) => l.employeeId === e.id)?.lateFrom ?? []) : (otPreview?.find((l) => l.employeeId === e.id)?.lateFrom ?? [])) as string[]; // 补发 ×月加班
    const unpaidLeaveDays = unpaidLeave.get(e.id) ?? 0, leaveCut = leaveDeduction(Number(salary.baseSalary), unpaidLeaveDays); // 月薪 ÷ 30 × days, off the base before tax and SSO
    const variablePay = Number(salary?.variablePay ?? 0);
    const missing: string[] = [];
    // sales are paid on targets (朱总 2026-11-11), everyone else on the manager's monthly score
    const sales = hasRole(e, "SALES");
    const mt = targets.find((t) => t.employeeId === e.id && t.period === input.month), qt = targets.find((t) => t.employeeId === e.id && t.period === quarter);
    const quarterlyPay = qEnd ? r2(Number(salary.quarterlyPay ?? 0) * 3) : 0;
    if (sales ? variablePay > 0 && !mt : variablePay > 0 && !review) missing.push(sales ? "TARGET" : "PERFORMANCE");
    if (quarterlyPay > 0 && !qt) missing.push("TARGET_Q");
    if (otWaiting.has(e.id)) missing.push("OVERTIME_OPEN");
    if (!e.taxNo) missing.push("TAX_ID");
    if (!e.ssoNo) missing.push("SSO_NO");
    if (!e.bankAccount) missing.push("BANK");
    if (!e.joinedAt) missing.push("JOINED"); // 个税按全年估算 without it (P2-12)
    const allowances = ((salary?.allowances as Allowance[] | null) ?? []);
    const num = (d: unknown) => (d == null ? null : Number(d));
    const c = computeLine({
      baseSalary: Math.max(0, Number(salary?.baseSalary ?? 0) - leaveCut), allowances, overtime, variablePay, perfScore: num(review?.score), bands, bonus,
      ...(sales ? { achievement: mt?.achievement ?? null } : {}), quarterlyPay, quarterAchieved: qt?.achievement ?? null,
      ssoWageBase: num(salary?.ssoWageBase), ssoEmployeeRate: num(salary?.ssoEmployeeRate), ssoEmployerRate: num(salary?.ssoEmployerRate), pvdEmployeeRate: num(salary?.pvdEmployeeRate), pvdEmployerRate: num(salary?.pvdEmployerRate),
      profile: salary?.taxDeductions as TaxProfile | null, periods: periodsInYear(input.month, e.joinedAt),
      irregularBefore: r2(earlier.filter((l) => l.employeeId === e.id).reduce((s, l) => s + Number(l.overtime) + Number(l.incentive) + Number(l.quarterIncentive) + Number(l.bonus), 0)),
      whtManual, otherDeduction, reimbursement,
    });
    lines.push({
      employeeId: e.id, salaryRecordId: salary?.id ?? null, baseSalary: Number(salary?.baseSalary ?? 0), allowances: allowances as unknown as Prisma.InputJsonValue, allowanceTotal: c.allowanceTotal,
      unpaidLeaveDays, leaveDeduction: leaveCut, otLateFrom, overtime, variablePay, perfScore: sales ? null : num(review?.score), perfFactor: c.perfFactor, incentive: c.incentive, bonus, gross: c.gross,
      perfBasis: sales ? "TARGET" : "SCORE", achievement: sales ? mt?.achievement ?? null : null, quarterlyPay, quarterAchieved: qt?.achievement ?? null, quarterFactor: c.quarterFactor, quarterIncentive: c.quarterIncentive,
      ssoBase: c.ssoBase, ssoEmployee: c.ssoEmployee, ssoEmployer: c.ssoEmployer, pvdEmployee: c.pvdEmployee, pvdEmployer: c.pvdEmployer,
      wht: c.wht, whtManual: whtManual != null, whtDetail: c.whtDetail as unknown as Prisma.InputJsonValue, otherDeduction, reimbursement, net: c.net, employerCost: c.employerCost, missing, note,
      claimIds: mine.map((x) => x.id),
    });
  }
  const sum = (k: "quarterIncentive" | "gross" | "ssoEmployee" | "ssoEmployer" | "wht" | "net" | "employerCost" | "reimbursement" | "overtime" | "incentive" | "bonus") => r2(lines.reduce((s, l) => s + Number(l[k] ?? 0), 0));
  const totals = { skipped, people: lines.length, gross: sum("gross"), overtime: sum("overtime"), incentive: r2(sum("incentive") + sum("quarterIncentive")), bonus: sum("bonus"), sso: sum("ssoEmployee"), ssoEmployer: sum("ssoEmployer"), wht: sum("wht"), reimbursement: sum("reimbursement"), net: sum("net"), employerCost: sum("employerCost") };

  return prisma.$transaction(async (tx) => {
    // figures that moved after the finance review are no longer reviewed
    const flat = (o: unknown) => JSON.stringify(Object.entries(o as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))); // jsonb does not keep key order
    const moved = !!existing && flat(existing.totals) !== flat(totals);
    const who = internal ? {} : { preparedBy: actor.code };
    const run = existing
      ? await tx.payrollRun.update({ where: { id: existing.id }, data: { totals, computedAt: new Date(), policy: { bands } as unknown as Prisma.InputJsonValue, ...who, ...(moved ? { taxConfirmedBy: null, taxConfirmedAt: null } : {}) } })
      : await tx.payrollRun.create({ data: { entityId: input.entityId, month: input.month, createdBy: actor.code, totals, policy: { bands } as unknown as Prisma.InputJsonValue, ...who } });
    // 留痕 (派修单 v4): a recompute that moves the figures after the finance review sends the month back to finance — say who, when, why
    if (moved) await audit(actor.id, existing!.taxConfirmedAt ? "PAYROLL_REVIEW_RESET" : "PAYROLL_RECOMPUTED", input.month, { via: internal ? "approve" : "compute", netBefore: (existing!.totals as { net?: number }).net, netAfter: totals.net, overtimeBefore: (existing!.totals as { overtime?: number }).overtime, overtimeAfter: totals.overtime, reviewedBy: existing!.taxConfirmedBy }, tx);
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
  return computePayroll(input, true);
}

/** Approval locks the month. It refuses while a line lacks its performance score or overtime is still open, and when nobody is on it. */
export async function approvePayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await md(input.actorCode);
  const before = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (!before?.preparedBy) throw new Error(`PAYROLL_NOT_PREPARED:${input.month}`);
  const run = await computePayroll(input, true); // approve what is true now, not what was true at the last refresh
  if (before.taxConfirmedAt && !run.taxConfirmedAt) throw new Error(`PAYROLL_CHANGED:${input.month}`);
  const lines = await prisma.payrollLine.findMany({ where: { runId: run.id }, include: { employee: { select: { code: true } } } });
  const blocked = lines.filter((l) => l.missing.some((m) => BLOCKING.includes(m)));
  if (!lines.length) throw new Error(`PAYROLL_EMPTY:${input.month}`);
  if (blocked.length) throw new Error(`PAYROLL_INCOMPLETE:${blocked.map((l) => l.employee.code).join(", ")}`);
  // 朱总 2026-11-11 "按照会计的来": the withholding figures must have been checked against the accountant's before the month locks
  if (!run.taxConfirmedAt) throw new Error(`PAYROLL_TAX_UNCONFIRMED:${input.month}`);
  if (new Set([run.preparedBy, run.taxConfirmedBy, actor.code]).size < 3) throw new Error("PAYROLL_SAME_PERSON");
  await closeOvertimeMonth({ entityId: input.entityId, month: input.month, closedBy: actor.code, early: true }); // the overtime in this pay is frozen with it
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "APPROVED", approvedBy: actor.code, approvedAt: new Date() } });
  await audit(actor.id, "PAYROLL_APPROVE", input.month, { net: (run.totals as { net: number }).net });
}

export async function reopenPayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await md(input.actorCode);
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (run.status === "PAID") throw new Error(`PAYROLL_PAID:${input.month}`);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { status: "DRAFT", approvedBy: null, approvedAt: null, taxConfirmedBy: null, taxConfirmedAt: null } }); // back to finance: the review is done again, HR need not resubmit
  await audit(actor.id, "PAYROLL_REOPEN", input.month);
}

/** Paid: the month is final and the expense claims it carried are settled. */
export async function markPayrollPaid(input: { entityId: string; month: string; actorCode: string; paidAt?: Date }) {
  const actor = await roleOf(input.actorCode, "FINANCE", "FINANCE_PAYS");
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
  return prisma.employee.findMany({ where: { active: true, entityId: a.entityId, id: { not: a.id }, ...(hasRole(a, "MD") ? {} : { managerId: a.id }) }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, position: true, managerId: true } });
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

/** 财务复核: the finance person ticks that the month is right and every withholding figure matches the accountant's. Not the person who computed it. */
/**
 * 锁定后新批准的加班不能漏 (H-R67). Overtime approved (or its actual hours confirmed) after the month's payroll was
 * last computed is not in its lines. While the month has left HR this is said on the payroll page — "有 N 条新批准加班
 * 未计入" — with two ways on: 补算 (the month is computed again and goes through finance and the MD again) or 挂到下月
 * (paid with next month, shown there as 补发 ×月加班). Once the month is approved, late overtime goes to the next month
 * by itself, and the page says so.
 */
export async function lateOvertime(entityId: string, month: string) {
  const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId, month } } });
  if (!run) return { run: null, rows: [], hours: 0, locked: false };
  const { to } = monthRange(month);
  // locked: the month is approved, or its overtime was already closed (the automatic close on the 1st) — late overtime then goes to the next month by itself
  const locked = run.status !== "DRAFT" || !!(await prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId, month } }, select: { id: true } }));
  const rows = await prisma.overtimeRequest.findMany({
    where: { entityId, status: "APPROVED", payMonthId: null, workDate: { lt: to }, ...(locked ? {} : { AND: [{ OR: [{ payNotBefore: null }, { payNotBefore: { lte: month } }] }, { OR: [{ decidedAt: { gt: run.computedAt } }, { confirmedAt: { gt: run.computedAt } }] }] }) },
    include: { employee: { select: { code: true, name: true } } }, orderBy: { workDate: "asc" } });
  return { run, rows, hours: r2(rows.reduce((a, r) => a + Number(r.actualHours ?? r.hours), 0)), locked };
}
/**
 * 派修单 v5 P1-6 (H-R72): what stops the review is judged now, not from what was stored when the month was computed.
 *   OVERTIME_OPEN — the person has overtime still waiting for the supervisor *at this moment*;
 *   OVERTIME_LATE — overtime approved after the month was computed and HR has not yet chosen 补算 or 挂到下月.
 * The rule itself is not loosened: either one still stops the review.
 */
export async function liveMissing<T extends { employeeId: string; missing: string[] }>(entityId: string, month: string, lines: T[]): Promise<T[]> {
  const { to } = monthRange(month);
  const [waiting, late] = await Promise.all([
    prisma.overtimeRequest.findMany({ where: { entityId, status: "PENDING", workDate: { lt: to } }, select: { employeeId: true } }),
    lateOvertime(entityId, month),
  ]);
  const open = new Set(waiting.map((r) => r.employeeId)), lateOf = new Set(late.locked ? [] : late.rows.map((r) => r.employeeId));
  return lines.map((l) => ({ ...l, missing: [...l.missing.filter((m) => m !== "OVERTIME_OPEN" && m !== "OVERTIME_LATE"), ...(open.has(l.employeeId) ? ["OVERTIME_OPEN"] : []), ...(lateOf.has(l.employeeId) ? ["OVERTIME_LATE"] : [])] }));
}
const grossOf = (run: { totals: unknown } | null) => Number((run?.totals as { gross?: number } | null)?.gross ?? 0);
/**
 * 派修单 v5 P1-8 (MD Q4): what 补算 or 挂到下月 would do, shown before it is done — which overtime (who, day, hours,
 * money), where it goes, and this month's 应发 before and after. 挂到下月 moves overtime that is not in this month's
 * figure, so the figure stays and so does the state; 补算 puts it in, the figure moves and the month goes back to
 * finance. "Changed" is judged on the month's actual total, never on the number of requests.
 */
export async function lateOvertimePreview(entityId: string, month: string, action: "carry" | "recount") {
  const late = await lateOvertime(entityId, month);
  const lines = late.run ? await prisma.payrollLine.findMany({ where: { runId: late.run.id }, select: { employeeId: true, baseSalary: true } }) : [];
  const rows = late.rows.map((r) => { const base = Number(lines.find((l) => l.employeeId === r.employeeId)?.baseSalary ?? 0), h = Number(r.actualHours ?? r.hours), x = OT_MULTIPLIER[r.kind];
    return { code: r.employee.code, name: r.employee.name, date: r.workDate.toISOString().slice(0, 10), time: `${r.actualStart ?? r.startTime}–${r.actualEnd ?? r.endTime}`, hours: h, x, amount: r2(h * (base / 30 / 8) * x) }; });
  const before = grossOf(late.run), after = action === "recount" ? r2(before + rows.reduce((a, r) => a + r.amount, 0)) : before;
  const [y, m] = month.split("-").map(Number), next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { rows, before, after, changed: Math.abs(after - before) > 0.005, next, stage: late.run ? payrollStage(late.run) : null, locked: late.locked };
}
const listOf = (rows: Awaited<ReturnType<typeof lateOvertime>>["rows"]) => rows.map((r) => `${r.employee.code} ${r.employee.name} ${r.workDate.toISOString().slice(0, 10)} ${r.actualStart ?? r.startTime}–${r.actualEnd ?? r.endTime} ${Number(r.actualHours ?? r.hours)}h×${OT_MULTIPLIER[r.kind]}`);
/** 补算: HR computes the month again with the overtime approved since; finance reviews again, then the MD. */
export async function recountPayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await roleOf(input.actorCode, "HR", "PAYROLL_PREPARER_ONLY");
  const late = await lateOvertime(input.entityId, input.month);
  if (late.locked) throw new Error(`PAYROLL_LOCKED:${input.month}`);
  const stageBefore = late.run ? payrollStage(late.run) : null, grossBefore = grossOf(late.run);
  const run = await computePayroll(input);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { taxConfirmedBy: null, taxConfirmedAt: null } });
  const stageAfter = payrollStage({ ...run, taxConfirmedAt: null });
  await audit(actor.id, "PAYROLL_RECOUNT", input.month, { overtime: late.rows.length, hours: late.hours, list: listOf(late.rows), grossBefore, grossAfter: grossOf(run), stateBefore: stageBefore, stateAfter: stageAfter });
  if (stageBefore && stageBefore !== stageAfter) await audit(actor.id, "PAYROLL_STATE", input.month, { from: stageBefore, to: stageAfter, reason: "RECOUNT", by: "SYSTEM", trigger: `${actor.code} 补算` });
}
/**
 * 挂到下月: the late overtime is paid with next month's pay (补发). HR or the MD. The month is computed again right
 * here; only when its 应发 really moved does it go back to finance (MD Q4) — and either way the log says which
 * overtime, the figure before and after, the state before and after.
 */
export async function carryOvertime(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!hasRole(actor, "HR", "MD")) throw new Error("NO_PERMISSION");
  const late = await lateOvertime(input.entityId, input.month);
  if (late.locked || !late.rows.length) return 0;
  const [y, m] = input.month.split("-").map(Number), next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  const stageBefore = late.run ? payrollStage(late.run) : null, grossBefore = grossOf(late.run);
  await prisma.overtimeRequest.updateMany({ where: { id: { in: late.rows.map((r) => r.id) } }, data: { payNotBefore: next } });
  const run = late.run?.status === "DRAFT" ? await computePayroll(input, !hasRole(actor, "HR")) : late.run; // resets the review by itself only when the totals moved
  const stageAfter = run ? payrollStage(run) : null, grossAfter = grossOf(run), changed = Math.abs(grossAfter - grossBefore) > 0.005;
  await audit(actor.id, "OT_CARRIED", input.month, { to: next, requests: late.rows.length, hours: late.hours, list: listOf(late.rows), grossBefore, grossAfter, changed, stateBefore: stageBefore, stateAfter: stageAfter });
  if (stageBefore && stageBefore !== stageAfter) await audit(actor.id, "PAYROLL_STATE", input.month, { from: stageBefore, to: stageAfter, reason: "CARRY_CHANGED_AMOUNT", by: "SYSTEM", trigger: `${actor.code} 挂到下月` });
  return late.rows.length;
}

/** HR hands the computed month to finance (需求清单 v3 P2-21): one clear step, one clear state, and finance is told. */
export async function submitPayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await roleOf(input.actorCode, "HR", "PAYROLL_PREPARER_ONLY");
  const run = await computePayroll(input);
  if (run.status !== "DRAFT") throw new Error(`PAYROLL_LOCKED:${input.month}`);
  await prisma.payrollRun.update({ where: { id: run.id }, data: { submittedAt: new Date() } });
  await audit(actor.id, "PAYROLL_SUBMITTED", input.month);
}
/** Where a month stands, in the words of the people who wait for it. */
export function payrollStage(run: { status: string; submittedAt: Date | null; taxConfirmedAt: Date | null }): "COMPUTING" | "REVIEW" | "APPROVE" | "APPROVED" | "PAID" {
  return run.status === "PAID" ? "PAID" : run.status === "APPROVED" ? "APPROVED" : run.taxConfirmedAt ? "APPROVE" : run.submittedAt ? "REVIEW" : "COMPUTING";
}

export async function confirmTax(input: { entityId: string; month: string; actorCode: string; confirmed: boolean; acknowledged?: boolean }) {
  const actor = await roleOf(input.actorCode, "FINANCE", "PAYROLL_REVIEWER_ONLY");
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } }, include: { lines: { select: { missing: true, employeeId: true, employee: { select: { code: true } } } } } });
  run.lines = await liveMissing(input.entityId, input.month, run.lines);
  if (input.confirmed) {
    // 复核须拦住缺失项: no review while anyone lacks a bank account or has overtime not yet settled; other gaps are acknowledged
    const stop = run.lines.filter((l) => l.missing.some((m) => REVIEW_BLOCKING.includes(m)));
    if (stop.length) throw new Error(`PAYROLL_REVIEW_BLOCKED:${stop.map((l) => l.employee.code).join("、")}`);
    if (run.lines.some((l) => l.missing.some((m) => REVIEW_NOTED.includes(m))) && !input.acknowledged) throw new Error("PAYROLL_REVIEW_ACK");
  }
  if (run.status !== "DRAFT") throw new Error(`PAYROLL_LOCKED:${input.month}`);
  if (input.confirmed && !run.submittedAt) throw new Error(`PAYROLL_NOT_SUBMITTED:${input.month}`);
  if (run.preparedBy === actor.code) throw new Error("PAYROLL_SAME_PERSON");
  await prisma.payrollRun.update({ where: { id: run.id }, data: input.confirmed ? { taxConfirmedBy: actor.code, taxConfirmedAt: new Date() } : { taxConfirmedBy: null, taxConfirmedAt: null } });
  await audit(actor.id, input.confirmed ? "PAYROLL_TAX_CONFIRMED" : "PAYROLL_TAX_UNCONFIRMED", input.month);
}

// ───────── 销售目标 ─────────
export const METRICS = ["COLLECTED", "INVOICED"] as const;
/** 朱总 2026-11-11 "季度看开票": a quarter is measured by what was invoiced, a month by the payments received. */
export const defaultMetric = (period: string) => (/-Q[1-4]$/.test(period) ? "INVOICED" : "COLLECTED");
const periodRange = (period: string) => {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return { from: monthRange(`${q[1]}-${String((Number(q[2]) - 1) * 3 + 1).padStart(2, "0")}`).from, to: monthRange(`${q[1]}-${String(Number(q[2]) * 3).padStart(2, "0")}`).to };
  if (!MONTH.test(period)) throw new Error(`BAD_MONTH:${period}`);
  return monthRange(period);
};

/**
 * What a salesperson brought in during a period, from the orders they are the 销售负责人 of. COLLECTED = payments received (the
 * user's own definition of a sales result runs to the money in the bank); INVOICED = tax invoices issued, before VAT.
 */
/** An order counts for its 销售负责人; with none named, for the person who opened it. */
const soldBy = (employeeId: string) => ({ OR: [{ salesId: employeeId }, { salesId: null, createdById: employeeId }] });
async function systemActual(employeeId: string, metric: string, period: string): Promise<number> {
  const { from, to } = periodRange(period);
  if (metric === "INVOICED") {
    const x = await prisma.taxInvoice.aggregate({ _sum: { subtotal: true }, where: { voidedAt: null, issuedAt: { gte: from, lt: to }, serviceOrder: soldBy(employeeId) } });
    return Number(x._sum.subtotal ?? 0);
  }
  const x = await prisma.receipt.aggregate({ _sum: { cashAmount: true, whtAmount: true }, where: { voidedAt: null, receivedAt: { gte: from, lt: to }, currency: "THB", invoice: { serviceOrder: soldBy(employeeId) } } });
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
  const metric = (METRICS as readonly string[]).includes(input.metric ?? "") ? input.metric! : defaultMetric(input.period);
  const data = { target: input.target, metric, actualManual: input.actualManual ?? null, note: input.note?.trim() || null, setById: actor.id };
  await prisma.salesTarget.upsert({ where: { employeeId_period: { employeeId: e.id, period: input.period } }, create: { ...data, entityId: e.entityId, employeeId: e.id, period: input.period }, update: data });
  await audit(actor.id, "SALES_TARGET", `${e.code} ${input.period}`, { target: input.target, metric });
}

/** 销售负责人 of an order: set by the MD, a manager, the administrator, or a salesperson (taking or handing over an order). */
export async function setOrderSales(input: { no: string; actorCode: string; salesCode: string | null }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!(hasRole(actor, "MD", "SALES") || isApprover(actor))) throw new Error("SALES_OWNER_NOT_ALLOWED");
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, select: { id: true, salesId: true } });
  const to = input.salesCode ? await prisma.employee.findUniqueOrThrow({ where: { code: input.salesCode } }) : null;
  await prisma.serviceOrder.update({ where: { id: order.id }, data: { salesId: to?.id ?? null } });
  await audit(actor.id, "ORDER_SALES", input.no, { to: to?.code ?? null });
  return to;
}

/** 操作记录 of a month's payroll and its overtime (派修单 v4 D): who, when, what — newest first. Finance, HR and the MD. */
export async function payrollTrail(entityId: string, month: string) {
  const rows = await prisma.auditLog.findMany({ where: { target: month, OR: [{ action: { startsWith: "PAYROLL" } }, { action: { in: ["OT_CARRIED", "OT_MONTH_CLOSE", "OT_MONTH_REOPEN"] } }], actor: { entityId } }, orderBy: { at: "desc" }, take: 80, include: { actor: { select: { code: true, name: true, role: true } } } });
  return rows.filter((r) => r.action !== "PAYROLL_EXPORT");
}
/** Overtime carried out of this month: which requests, and from the log who did it and when. */
export async function carriedOvertime(entityId: string, month: string) {
  const { from, to } = monthRange(month);
  const rows = await prisma.overtimeRequest.findMany({ where: { entityId, status: "APPROVED", workDate: { gte: from, lt: to }, payNotBefore: { gt: month } }, include: { employee: { select: { code: true, name: true } } }, orderBy: { workDate: "asc" } });
  const log = rows.length ? await prisma.auditLog.findFirst({ where: { action: "OT_CARRIED", target: month }, orderBy: { at: "desc" }, include: { actor: { select: { code: true, name: true } } } }) : null;
  return { rows, by: log?.actor ?? null, at: log?.at ?? null };
}

/**
 * 派修单 v5 P1-5 (H-R70 / H-R73): overtime approved after its month's pay was computed, where HR has not yet chosen
 * 补算 or 挂到下月. Everywhere it is shown — the person's page, the everyone list, the export, the pay month — it reads
 * the same: 待 HR 选. id → the pay month it waits on.
 */
export async function overtimeAwaitingHr(entityId: string, months: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const month of [...new Set(months)]) { const late = await lateOvertime(entityId, month); if (late.run && !late.locked) for (const r of late.rows) out.set(r.id, month); }
  return out;
}

/** 派修单 v5 P1-7: HR removes a pay sheet that has nobody on it (a month before the system held any pay). Logged. */
export async function dropEmptyPayroll(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await roleOf(input.actorCode, "HR", "PAYROLL_PREPARER_ONLY");
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } }, select: { id: true, status: true, _count: { select: { lines: true } } } });
  if (run.status !== "DRAFT" || run._count.lines > 0) throw new Error(`PAYROLL_NOT_EMPTY:${input.month}`);
  await prisma.payrollRun.delete({ where: { id: run.id } });
  await audit(actor.id, "PAYROLL_EMPTY_DROPPED", input.month);
}
