/**
 * 请假 (需求清单 v4 V4-P0-12): the employee asks on the phone — kind, days (half a day possible), reason; sick leave of
 * three days or more with the medical certificate. The approver (the person's manager, or the MD) decides with one tap.
 * HR and the MD see everyone's balance and the month's sheet. The payroll takes unpaid days off by itself.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { hasRole } from "@/lib/caps";
import { LEAVE_TYPES, SICK_CERT_FROM_DAYS, isoDay, leaveDays, quotaOf, settleLeave, type LeaveRow, type LeaveType } from "@/lib/leave";

const day = (d: Date | string) => new Date(`${(typeof d === "string" ? d : isoDay(d)).slice(0, 10)}T00:00:00Z`);
type Att = { name: string; url: string };

export async function requestLeave(input: { actorCode: string; employeeCode?: string; type: string; from: string; to?: string; half?: string | null; reason: string; attachments?: Att[] }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const forCode = input.employeeCode && input.employeeCode !== actor.code ? input.employeeCode : actor.code;
  if (forCode !== actor.code && !hasRole(actor, "MD", "HR")) throw new Error("LEAVE_OWN_ONLY"); // HR enters a leave phoned in by someone off sick; it still goes to the approver
  const emp = await prisma.employee.findUniqueOrThrow({ where: { code: forCode } });
  if (!emp.active) throw new Error(`EMPLOYEE_INACTIVE:${emp.code}`);
  if (!(LEAVE_TYPES as readonly string[]).includes(input.type)) throw new Error("LEAVE_TYPE");
  const type = input.type as LeaveType;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.from)) throw new Error("LEAVE_DATE");
  const to = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : input.from;
  if (to < input.from) throw new Error("LEAVE_DATE");
  if (day(to).getTime() - day(input.from).getTime() > 120 * 86_400_000) throw new Error("LEAVE_TOO_LONG");
  if (!input.reason?.trim()) throw new Error("REASON_REQUIRED");
  const half = input.half === "AM" || input.half === "PM" ? input.half : null;
  if (half && to !== input.from) throw new Error("LEAVE_HALF_ONE_DAY");
  const holidays = (await prisma.holiday.findMany({ where: { entityId: emp.entityId, date: { gte: day(input.from), lte: day(to) } } })).map((h) => isoDay(h.date));
  const list = leaveDays(input.from, to, holidays, { half: !!half, calendar: type === "MATERNITY" });
  const days = list.reduce((a, d) => a + d.part, 0);
  if (!(days > 0)) throw new Error("LEAVE_NO_WORKDAY");
  if (type === "SICK" && days >= SICK_CERT_FROM_DAYS && !input.attachments?.length) throw new Error("LEAVE_CERT_REQUIRED");
  const clash = await prisma.leaveRequest.findFirst({ where: { employeeId: emp.id, status: { in: ["PENDING", "APPROVED"] }, fromDate: { lte: day(to) }, toDate: { gte: day(input.from) } } });
  if (clash) throw new Error(`LEAVE_OVERLAP:${isoDay(clash.fromDate)}`);
  const auto = hasRole(emp, "MD") && actor.id === emp.id; // the MD has nobody above him
  const r = await prisma.leaveRequest.create({ data: { entityId: emp.entityId, employeeId: emp.id, type, fromDate: day(input.from), toDate: day(to), half, days, dayList: list as unknown as Prisma.InputJsonValue, reason: input.reason.trim(), attachments: (input.attachments ?? []) as unknown as Prisma.InputJsonValue, createdById: actor.id, ...(auto ? { status: "APPROVED", approverId: actor.id, decidedAt: new Date() } : {}) } });
  await audit(actor.id, "LEAVE_REQUEST", r.id, { employee: emp.code, type, from: input.from, to, days });
  return r;
}

/** The person's manager or the MD decides; nobody decides their own. A refusal needs a reason. */
export async function decideLeave(input: { id: string; actorCode: string; approve: boolean; note?: string }) {
  const [r, actor] = await Promise.all([prisma.leaveRequest.findUniqueOrThrow({ where: { id: input.id }, include: { employee: true } }), prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } })]);
  if (r.status !== "PENDING") throw new Error(`LEAVE_NOT_PENDING:${r.status}`);
  if (!hasRole(actor, "MD") && (r.employee.managerId !== actor.id || r.employeeId === actor.id)) throw new Error("LEAVE_NOT_APPROVER");
  if (!input.approve && !input.note?.trim()) throw new Error("REASON_REQUIRED");
  await audit(actor.id, input.approve ? "LEAVE_APPROVE" : "LEAVE_REJECT", r.id, { employee: r.employee.code, type: r.type, days: Number(r.days), note: input.note });
  return prisma.leaveRequest.update({ where: { id: r.id }, data: { status: input.approve ? "APPROVED" : "REJECTED", approverId: actor.id, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
}

/** Withdrawn by the person (or HR / the MD) — while it waits, or approved and not yet begun. */
export async function cancelLeave(input: { id: string; actorCode: string }) {
  const [r, actor] = await Promise.all([prisma.leaveRequest.findUniqueOrThrow({ where: { id: input.id } }), prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } })]);
  if (r.employeeId !== actor.id && !hasRole(actor, "MD", "HR")) throw new Error("NO_PERMISSION");
  if (!["PENDING", "APPROVED"].includes(r.status)) throw new Error(`LEAVE_NOT_PENDING:${r.status}`);
  if (r.status === "APPROVED" && r.fromDate.getTime() <= Date.now() && !hasRole(actor, "MD", "HR")) throw new Error("LEAVE_STARTED");
  await audit(actor.id, "LEAVE_CANCEL", r.id, { was: r.status });
  return prisma.leaveRequest.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
}

const rowsOf = (list: { type: string; dayList: unknown }[]): LeaveRow[] => list.map((l) => ({ type: l.type as LeaveType, days: (l.dayList as { day: string; part: number }[]) ?? [] }));

/** Balance of the year for some people: paid days of each kind, used, left; and the unpaid days by month. Approved leave only. */
export async function leaveBalances(employeeIds: string[], year: number) {
  const [emps, rows] = await Promise.all([
    prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, joinedAt: true } }),
    prisma.leaveRequest.findMany({ where: { employeeId: { in: employeeIds }, status: "APPROVED", fromDate: { lte: new Date(Date.UTC(year, 11, 31)) }, toDate: { gte: new Date(Date.UTC(year, 0, 1)) } }, select: { employeeId: true, type: true, dayList: true } }),
  ]);
  return new Map(emps.map((e) => { const s = settleLeave(rowsOf(rows.filter((r) => r.employeeId === e.id)), year, e.joinedAt); return [e.id, { ...s, quota: Object.fromEntries(LEAVE_TYPES.map((t) => [t, quotaOf(t, year, e.joinedAt)])) as Record<LeaveType, number> }]; }));
}
/** Unpaid days of a month per person — what the payroll takes off (月薪 ÷ 30 each). */
export async function unpaidLeaveOfMonth(employeeIds: string[], month: string): Promise<Map<string, number>> {
  const b = await leaveBalances(employeeIds, Number(month.slice(0, 4)));
  return new Map([...b].map(([id, s]) => [id, s.unpaidByMonth[month] ?? 0]));
}

export async function myLeave(employeeId: string) { return prisma.leaveRequest.findMany({ where: { employeeId }, orderBy: { fromDate: "desc" }, take: 60, include: { approver: { select: { name: true } } } }); }
export async function leaveToApprove(actorId: string, isMd: boolean) {
  return prisma.leaveRequest.findMany({ where: { status: "PENDING", ...(isMd ? {} : { employee: { managerId: actorId }, NOT: { employeeId: actorId } }) }, orderBy: { fromDate: "asc" }, include: { employee: { select: { code: true, name: true } } } });
}
/** 月考勤表 for HR and the MD: every active person, the leave days of the month by kind, unpaid days, what still waits. */
export async function leaveSheet(entityId: string, month: string) {
  const year = Number(month.slice(0, 4));
  const staff = await prisma.employee.findMany({ where: { entityId, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, joinedAt: true } });
  const ids = staff.map((e) => e.id);
  const [bal, rows] = await Promise.all([leaveBalances(ids, year), prisma.leaveRequest.findMany({ where: { employeeId: { in: ids }, status: { in: ["APPROVED", "PENDING"] }, fromDate: { lte: new Date(Date.UTC(year, Number(month.slice(5)), 0)) }, toDate: { gte: new Date(`${month}-01T00:00:00Z`) } } })]);
  return staff.map((e) => {
    const mine = rows.filter((r) => r.employeeId === e.id);
    const inMonth = (st: string) => Object.fromEntries(LEAVE_TYPES.map((t) => [t, mine.filter((r) => r.status === st && r.type === t).flatMap((r) => (r.dayList as { day: string; part: number }[]).filter((d) => d.day.startsWith(month))).reduce((a, d) => a + d.part, 0)])) as Record<LeaveType, number>;
    const b = bal.get(e.id)!;
    return { ...e, taken: inMonth("APPROVED"), waiting: Object.values(inMonth("PENDING")).reduce((a, n) => a + n, 0), unpaid: b.unpaidByMonth[month] ?? 0, left: b.left, quota: b.quota, used: b.used };
  });
}
