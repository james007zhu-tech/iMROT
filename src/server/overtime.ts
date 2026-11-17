/**
 * OPD · 加班 (2026-11-09): request → manager/MD decision → actual hours → automatic month-end pay calculation.
 * Rules in src/lib/overtime.ts (LPA s.61–63, 36 h/week, hourly wage = base ÷ 30 ÷ 8).
 * Amounts are salary data: only the MD sees them; employees see their own hours and statuses.
 */
import { localIso } from "@/lib/dates";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { capHours, localToday, monthKeyOf, monthRange, OT_KINDS, OT_MULTIPLIER, overtimeHours, overtimePay, weekRange, WEEKLY_OT_CAP_HOURS, type OvertimeKind } from "@/lib/overtime";
import type { Prisma } from "@prisma/client";
import { hasRole } from "@/lib/caps";
import { DEFAULT_SHIFT, dayKindOf, splitWork, type DayKind } from "@/lib/shift";

const day = z.preprocess((v) => (v instanceof Date ? v : typeof v === "string" && v ? new Date(`${v.slice(0, 10)}T00:00:00Z`) : v), z.date());
const hhmm = z.string().regex(/^\d{1,2}:\d{2}$/, "BAD_TIME");

export const OvertimeInput = z.object({
  actorCode: z.string(),
  employeeCode: z.string().optional(), /// the MD may file for someone else; everyone else files for themselves
  workDate: day, startTime: hhmm, endTime: hhmm, breakMinutes: z.coerce.number().int().min(0).max(240).default(0),
  kind: z.enum(["WORKDAY_OT", "HOLIDAY_WORK", "HOLIDAY_OT"]).optional(), /// ignored: the day and the shift say what it is (H-R66)
  reason: z.string().trim().min(1, "OT_REASON_REQUIRED"),
  serviceOrderNo: z.string().trim().optional(),
});

type Interval = { from: number; to: number };
/** Minutes since 2000-01-01 for the whole span of one request (breaks inside it still block an overlap); handles midnight. */
function interval(workDate: Date, start: string, end: string): Interval {
  const base = Math.round((workDate.getTime() - Date.UTC(2000, 0, 1)) / 60000);
  const [h, m] = start.split(":").map(Number);
  const from = base + h * 60 + m;
  return { from, to: from + Math.round(overtimeHours(start, end, 0) * 60) };
}

async function checkRequest(employeeId: string, workDate: Date, start: string, end: string, kind: OvertimeKind, hours: number, ignoreId?: string) {
  // overlap with the person's other live requests (same day ± 1 for midnight crossings)
  const near = await prisma.overtimeRequest.findMany({ where: { employeeId, id: ignoreId ? { not: ignoreId } : undefined, status: { in: ["PENDING", "APPROVED"] }, workDate: { gte: new Date(workDate.getTime() - 86_400_000), lte: new Date(workDate.getTime() + 86_400_000) } } });
  const me = interval(workDate, start, end);
  const clash = near.find((r) => { const o = interval(r.workDate, r.actualStart ?? r.startTime, r.actualEnd ?? r.endTime); return o.from < me.to && me.from < o.to; });
  if (clash) throw new Error(`OT_OVERLAP:${localIso(clash.workDate)!.slice(0, 10)} ${clash.startTime}–${clash.endTime}`);
  // 36 h a week of overtime + holiday overtime (Mon–Sun)
  const w = weekRange(workDate);
  const week = await prisma.overtimeRequest.findMany({ where: { employeeId, id: ignoreId ? { not: ignoreId } : undefined, status: { in: ["PENDING", "APPROVED"] }, workDate: { gte: w.from, lt: w.to } } });
  const used = week.reduce((s, r) => s + capHours(r.kind, Number(r.actualHours ?? r.hours)), 0);
  if (used + capHours(kind, hours) > WEEKLY_OT_CAP_HOURS) throw new Error(`OT_WEEKLY_CAP:${used}+${capHours(kind, hours)}>${WEEKLY_OT_CAP_HOURS}`);
}

/** What a day is for this company: a holiday on the list, the weekly rest day (Sunday), or a working day. */
export async function dayKindFor(entityId: string, workDate: Date): Promise<DayKind> {
  const h = await prisma.holiday.findUnique({ where: { entityId_date: { entityId, date: workDate } } });
  return h ? "HOLIDAY" : dayKindOf(workDate.toISOString().slice(0, 10), []);
}

/**
 * 加班申请 (H-R66, MD 2026-11-16: 标准班次 08:30–17:30，午休 1 小时). The employee gives the day and when they started
 * and stopped — nothing else. The shift and the calendar say what it is: on a working day only the time outside the
 * shift is overtime (×1.5), a stretch wholly inside the shift is refused; on a Sunday or a holiday the first 8 hours are
 * holiday work and the rest holiday overtime. Nobody picks a kind or a multiplier. A stretch that falls into two kinds
 * becomes two requests. The MD's own request is approved at once; everyone else waits for the approver.
 */
export async function requestOvertime(input: z.input<typeof OvertimeInput>) {
  const d = OvertimeInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const forCode = d.employeeCode && d.employeeCode !== actor.code ? d.employeeCode : actor.code;
  if (forCode !== actor.code && !hasRole(actor, "MD")) throw new Error("OT_OWN_ONLY");
  const emp = await prisma.employee.findUniqueOrThrow({ where: { code: forCode } });
  if (!emp.active) throw new Error(`EMPLOYEE_INACTIVE:${emp.code}`);
  if (d.serviceOrderNo && !(await prisma.serviceOrder.findUnique({ where: { no: d.serviceOrderNo } }))) throw new Error(`ORDER_NOT_FOUND:${d.serviceOrderNo}`);
  const split = splitWork({ dayKind: await dayKindFor(emp.entityId, d.workDate), start: d.startTime, end: d.endTime, otBreakMinutes: d.breakMinutes });
  if (!split.segments.length) throw new Error(`OT_IN_SHIFT:${DEFAULT_SHIFT.start}–${DEFAULT_SHIFT.end}`);
  for (const g of split.segments) await checkRequest(emp.id, d.workDate, g.start, g.end, g.kind, g.hours);
  const auto = hasRole(actor, "MD"); // the MD files for himself or on someone's behalf after agreeing it with them
  const made = [];
  for (const g of split.segments) {
    const r = await prisma.overtimeRequest.create({ data: { entityId: emp.entityId, employeeId: emp.id, workDate: d.workDate, startTime: g.start, endTime: g.end, breakMinutes: g.breakMinutes, hours: g.hours, kind: g.kind, reason: d.reason, serviceOrderNo: d.serviceOrderNo || null, createdById: actor.id, ...(auto ? { status: "APPROVED" as const, approverId: actor.id, decidedAt: new Date() } : {}) } });
    await audit(actor.id, "OT_REQUEST", r.id, { employee: emp.code, date: localIso(d.workDate)!.slice(0, 10), hours: g.hours, kind: g.kind, asked: `${d.startTime}–${d.endTime}` });
    made.push(r);
  }
  return Object.assign(made[0], { all: made });
}

/**
 * 现场超时自动生成加班草稿 (N-03, MD 2026-11-15). The hours on a finished RPTH / PMTH are split by the same shift rule;
 * what lies outside the shift becomes a request waiting for the approver — marked 自动, with the report it came from.
 * Nothing is paid before the approver says yes. A stretch the person already asked for is not drafted twice; a draft
 * not yet decided follows the report when its times are corrected. A report that runs over more than one day is left
 * alone (its start is the day the job was opened, not the hours of one day).
 */
export async function draftOvertimeFromWork(input: { employeeId: string; start: Date; end: Date; sourceNo: string; serviceOrderNo?: string | null }) {
  const span = input.end.getTime() - input.start.getTime();
  if (!(span > 0) || span > 16 * 3600000) return [];
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: input.employeeId } });
  const iso = localIso(input.start)!, st = iso.slice(11, 16), en = localIso(input.end)!.slice(11, 16);
  const workDate = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  await prisma.overtimeRequest.deleteMany({ where: { employeeId: emp.id, origin: "SITE", sourceNo: input.sourceNo, status: "PENDING" } }); // the report was corrected: draft again
  const split = splitWork({ dayKind: await dayKindFor(emp.entityId, workDate), start: st, end: en });
  const near = await prisma.overtimeRequest.findMany({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, workDate: { gte: new Date(workDate.getTime() - 86_400_000), lte: new Date(workDate.getTime() + 86_400_000) } } });
  const made = [];
  for (const g of split.segments) {
    const me = interval(workDate, g.start, g.end);
    if (near.some((r) => { const o = interval(r.workDate, r.actualStart ?? r.startTime, r.actualEnd ?? r.endTime); return o.from < me.to && me.from < o.to; })) continue; // already asked for
    const r = await prisma.overtimeRequest.create({ data: { entityId: emp.entityId, employeeId: emp.id, workDate, startTime: g.start, endTime: g.end, breakMinutes: g.breakMinutes, hours: g.hours, kind: g.kind, origin: "SITE", sourceNo: input.sourceNo, serviceOrderNo: input.serviceOrderNo ?? null, reason: `${input.sourceNo} ${st}–${en}`, createdById: emp.id } });
    await audit(emp.id, "OT_DRAFT_FROM_SITE", r.id, { source: input.sourceNo, date: iso.slice(0, 10), worked: `${st}–${en}`, hours: g.hours, kind: g.kind });
    made.push(r);
  }
  return made;
}

/** 公司假日: HR or the MD keeps the list. */
export async function setHoliday(input: { actorCode: string; date: Date; name?: string; remove?: boolean }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!hasRole(actor, "MD", "HR")) throw new Error("NO_PERMISSION");
  const date = new Date(`${input.date.toISOString().slice(0, 10)}T00:00:00Z`);
  if (input.remove) { await prisma.holiday.deleteMany({ where: { entityId: actor.entityId, date } }); await audit(actor.id, "HOLIDAY_REMOVE", date.toISOString().slice(0, 10)); return null; }
  if (!input.name?.trim()) throw new Error("HOLIDAY_NAME_REQUIRED");
  const h = await prisma.holiday.upsert({ where: { entityId_date: { entityId: actor.entityId, date } }, update: { name: input.name.trim() }, create: { entityId: actor.entityId, date, name: input.name.trim(), createdBy: actor.code } });
  await audit(actor.id, "HOLIDAY_SET", date.toISOString().slice(0, 10), { name: h.name });
  return h;
}
export async function holidaysOf(entityId: string, from: Date) { return prisma.holiday.findMany({ where: { entityId, date: { gte: from } }, orderBy: { date: "asc" }, take: 60 }); }

/** The person's manager or the MD decides; nobody decides their own request (except the MD). A rejection needs a note. */
export async function decideOvertime(input: { id: string; actorCode: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  const [r, actor] = await Promise.all([prisma.overtimeRequest.findUniqueOrThrow({ where: { id: input.id }, include: { employee: true } }), prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } })]);
  if (r.status !== "PENDING") throw new Error(`OT_NOT_PENDING:${r.status}`);
  const isManager = r.employee.managerId === actor.id;
  if (!hasRole(actor, "MD") && !isManager) throw new Error("OT_NOT_APPROVER");
  if (r.employeeId === actor.id && !hasRole(actor, "MD")) throw new Error("OT_NOT_APPROVER");
  if (input.decision === "REJECTED" && !input.note?.trim()) throw new Error("OT_REJECT_NOTE_REQUIRED");
  const u = await prisma.overtimeRequest.update({ where: { id: r.id }, data: { status: input.decision, approverId: actor.id, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
  await audit(actor.id, input.decision === "APPROVED" ? "OT_APPROVE" : "OT_REJECT", r.id, { employee: r.employee.code, hours: Number(r.hours), note: input.note });
  return u;
}

/** After the work: the actual times. More hours than approved go back to the approver; fewer or equal stay approved. */
export async function confirmActualHours(input: { id: string; actorCode: string; actualStart: string; actualEnd: string; breakMinutes?: number }) {
  const [r, actor] = await Promise.all([prisma.overtimeRequest.findUniqueOrThrow({ where: { id: input.id } }), prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } })]);
  if (r.employeeId !== actor.id && !hasRole(actor, "MD")) throw new Error("OT_OWN_ONLY");
  if (r.status !== "APPROVED") throw new Error(`OT_NOT_APPROVED:${r.status}`);
  if (r.payMonthId) throw new Error("OT_ALREADY_PAID");
  const brk = input.breakMinutes ?? r.breakMinutes;
  // the same shift rule as the request: only what lies outside the shift (or, on a holiday, in this request's part of the day) counts
  const parts = splitWork({ dayKind: await dayKindFor(r.entityId, r.workDate), start: input.actualStart, end: input.actualEnd, otBreakMinutes: brk }).segments.filter((g) => g.kind === r.kind);
  const actual = parts.reduce((a, g) => a + g.hours, 0);
  if (!(actual > 0)) throw new Error(`OT_IN_SHIFT:${DEFAULT_SHIFT.start}–${DEFAULT_SHIFT.end}`);
  await checkRequest(r.employeeId, r.workDate, input.actualStart, input.actualEnd, r.kind, actual, r.id);
  const more = actual > Number(r.hours) + 0.001 && !hasRole(actor, "MD");
  const u = await prisma.overtimeRequest.update({ where: { id: r.id }, data: { actualStart: input.actualStart, actualEnd: input.actualEnd, breakMinutes: brk, actualHours: actual, confirmedAt: new Date(),
    ...(more ? { status: "PENDING", hours: actual, approverId: null, decidedAt: null, decisionNote: `actual ${actual} h > approved ${Number(r.hours)} h` } : {}) } });
  await audit(actor.id, "OT_ACTUAL", r.id, { actual, approved: Number(r.hours), backToApprover: more });
  return u;
}

/** Withdraw a request that has not been paid yet: the person themself, or the MD. */
export async function cancelOvertime(input: { id: string; actorCode: string }) {
  const [r, actor] = await Promise.all([prisma.overtimeRequest.findUniqueOrThrow({ where: { id: input.id } }), prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } })]);
  if (r.employeeId !== actor.id && !hasRole(actor, "MD")) throw new Error("OT_OWN_ONLY");
  if (r.payMonthId) throw new Error("OT_ALREADY_PAID");
  if (!["PENDING", "APPROVED"].includes(r.status)) throw new Error(`OT_NOT_OPEN:${r.status}`);
  await audit(actor.id, "OT_CANCEL", r.id);
  return prisma.overtimeRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
}

// ───────────── month end ─────────────

type Payable = Prisma.OvertimeRequestGetPayload<{ include: { employee: true } }>;

/** What a close of `month` would pay now: every APPROVED request not yet paid, worked before the month's end (late ones included). */
async function payableFor(entityId: string, month: string): Promise<Payable[]> {
  const { to } = monthRange(month);
  return prisma.overtimeRequest.findMany({ where: { entityId, status: "APPROVED", payMonthId: null, workDate: { lt: to }, OR: [{ payNotBefore: null }, { payNotBefore: { lte: month } }] }, include: { employee: true }, orderBy: { workDate: "asc" } });
}

async function linesFor(rows: Payable[], month: string) {
  const { to } = monthRange(month);
  const lastDay = new Date(to.getTime() - 1);
  const byEmp = new Map<string, Payable[]>();
  for (const r of rows) byEmp.set(r.employeeId, [...(byEmp.get(r.employeeId) ?? []), r]);
  const lines = [];
  for (const [employeeId, list] of byEmp) {
    const salary = await prisma.salaryRecord.findFirst({ where: { employeeId, effectiveFrom: { lte: lastDay } }, orderBy: { effectiveFrom: "desc" } });
    const hours: Partial<Record<OvertimeKind, number>> = {};
    for (const r of list) hours[r.kind] = (hours[r.kind] ?? 0) + Number(r.actualHours ?? r.hours);
    const pay = overtimePay({ baseSalary: Number(salary?.baseSalary ?? 0), hours });
    lines.push({ employee: list[0].employee, employeeId, salaryRecordId: salary?.id ?? null, baseSalary: Number(salary?.baseSalary ?? 0), pay, missingSalary: !salary,
      lateFrom: [...new Set(list.map((r) => monthKeyOf(r.workDate)).filter((m) => m !== month))].sort(), unconfirmed: list.filter((r) => !r.confirmedAt).length, requests: list });
  }
  return lines.sort((a, b) => a.employee.code.localeCompare(b.employee.code));
}

/** Live view of a month that is not closed yet (MD). */
export async function previewOvertimeMonth(entityId: string, month: string) {
  return linesFor(await payableFor(entityId, month), month);
}

/**
 * 月结: freeze the month's overtime pay per employee and mark the requests paid. Only after the month has ended (Bangkok).
 * Idempotent — a second close returns the first one. `closedBy` is an employee code or "SYSTEM".
 */
export async function closeOvertimeMonth(input: { entityId: string; month: string; closedBy: string; now?: Date; early?: boolean }) {
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new Error(`BAD_MONTH:${input.month}`);
  // `early`: the payroll of this month is being approved before the month is over — what is approved by now is frozen
  // with it; overtime approved later is paid with the next month (需求清单 v3 P0-10, 第 7 轮).
  if (!input.early && input.month >= localToday(input.now).month) throw new Error(`OT_MONTH_NOT_ENDED:${input.month}`);
  const existing = await prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  if (existing) return existing;
  const lines = await linesFor(await payableFor(input.entityId, input.month), input.month);
  try {
    return await prisma.$transaction(async (tx) => {
      const m = await tx.overtimeMonth.create({ data: { entityId: input.entityId, month: input.month, closedBy: input.closedBy, totalHours: lines.reduce((s, l) => s + l.pay.totalHours, 0), totalAmount: Math.round(lines.reduce((s, l) => s + l.pay.total, 0) * 100) / 100 } });
      for (const l of lines) {
        await tx.overtimePayLine.create({ data: { monthId: m.id, employeeId: l.employeeId, salaryRecordId: l.salaryRecordId, baseSalary: l.baseSalary, hourlyRate: l.pay.hourlyRate, hours: l.pay.hours, multipliers: OT_MULTIPLIER, amounts: l.pay.amounts, totalHours: l.pay.totalHours, total: l.pay.total, lateFrom: l.lateFrom, missingSalary: l.missingSalary } });
        await tx.overtimeRequest.updateMany({ where: { id: { in: l.requests.map((r) => r.id) } }, data: { payMonthId: m.id } });
      }
      const actor = input.closedBy === "SYSTEM" ? null : await tx.employee.findUnique({ where: { code: input.closedBy } });
      if (actor) await audit(actor.id, "OT_MONTH_CLOSE", `${input.month}`, { entityId: input.entityId, lines: lines.length }, tx);
      return m;
    });
  } catch (e) {
    if ((e as { code?: string }).code === "P2002") return prisma.overtimeMonth.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } }); // closed in parallel
    throw e;
  }
}

/** MD: reopen the latest closed month (e.g. a salary was missing), so it can be closed again. */
export async function reopenOvertimeMonth(input: { entityId: string; month: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!hasRole(actor, "MD")) throw new Error("MD_ONLY");
  const m = await prisma.overtimeMonth.findUniqueOrThrow({ where: { entityId_month: { entityId: input.entityId, month: input.month } } });
  const later = await prisma.overtimeMonth.findFirst({ where: { entityId: input.entityId, month: { gt: input.month } } });
  if (later) throw new Error(`OT_LATER_MONTH_CLOSED:${later.month}`);
  await prisma.$transaction(async (tx) => {
    await tx.overtimeRequest.updateMany({ where: { payMonthId: m.id }, data: { payMonthId: null } });
    await tx.overtimeMonth.delete({ where: { id: m.id } });
    await audit(actor.id, "OT_MONTH_REOPEN", input.month, { entityId: input.entityId }, tx);
  });
}

/**
 * The automatic close: on or after the 1st (Bangkok), close last month for every legal entity. Called hourly by
 * src/instrumentation.ts and whenever the overtime pages load, so a server that was down at midnight still closes.
 */
export async function autoCloseOvertime(now = new Date()) {
  const { previousMonth } = localToday(now);
  const entities = await prisma.legalEntity.findMany({ select: { id: true } });
  const closed: string[] = [];
  for (const e of entities) {
    const had = await prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId: e.id, month: previousMonth } } });
    if (!had) { await closeOvertimeMonth({ entityId: e.id, month: previousMonth, closedBy: "SYSTEM", now }); closed.push(`${e.id}:${previousMonth}`); }
  }
  return closed;
}

// ───────────── reads ─────────────

export async function myOvertime(employeeId: string) {
  return prisma.overtimeRequest.findMany({ where: { employeeId }, orderBy: [{ workDate: "desc" }, { startTime: "desc" }], take: 60, include: { approver: { select: { name: true } }, payMonth: { select: { month: true } } } });
}

/** Requests waiting for this person: their direct reports' (managers) or everyone's (MD). */
export async function overtimeToApprove(actorId: string, isMd: boolean) {
  return prisma.overtimeRequest.findMany({ where: { status: "PENDING", ...(isMd ? {} : { employee: { managerId: actorId } }) }, orderBy: { workDate: "asc" }, include: { employee: { select: { code: true, name: true } } } });
}

export async function overtimeMonths(entityId: string) {
  return prisma.overtimeMonth.findMany({ where: { entityId }, orderBy: { month: "desc" }, take: 24 });
}

export async function overtimeMonthDetail(entityId: string, month: string) {
  return prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId, month } }, include: { lines: { include: { employee: { select: { code: true, name: true } } }, orderBy: { employee: { code: "asc" } } }, requests: { orderBy: { workDate: "asc" }, include: { employee: { select: { code: true } } } } } });
}

/** Closed months of one employee (their file, MD only). */
export async function overtimeLinesOf(employeeId: string) {
  return prisma.overtimePayLine.findMany({ where: { employeeId }, include: { month: { select: { month: true, closedAt: true } } }, orderBy: { month: { month: "desc" } }, take: 12 });
}

export { OT_KINDS };
