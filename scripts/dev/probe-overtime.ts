/**
 * 加班 against a real database (2026-11-09): request → manager approval (others refused) → overlap and 36 h/week refused →
 * actual hours above the approval go back to the manager → month-end close pays 1.5× / 1× / 3× of salary ÷ 30 ÷ 8 →
 * idempotent → a late approval is paid next month → missing salary flagged → automatic close → reopen rules.
 * Uses a past month chosen from the run stamp so runs do not collide.   npx tsx scripts/dev/probe-overtime.ts
 */
import { prisma } from "../../src/lib/db";
import { addSalaryRecord, createEmployee } from "../../src/server/opd";
import { autoCloseOvertime, cancelOvertime, closeOvertimeMonth, confirmActualHours, decideOvertime, overtimeMonthDetail, reopenOvertimeMonth, requestOvertime } from "../../src/server/overtime";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`OVERTIME FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (fn: () => Promise<unknown>, re: RegExp, m: string) => { try { await fn(); assert(false, m); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.split("\n")[0]})`); } };
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const n = Number(stamp);
  const year = 2015 + (n % 9), mon = 1 + (Math.floor(n / 9) % 10); // Jan–Oct, so M+1 and M+2 stay in the year
  const M = `${year}-${String(mon).padStart(2, "0")}`, M1 = `${year}-${String(mon + 1).padStart(2, "0")}`, M2 = `${year}-${String(mon + 2).padStart(2, "0")}`;
  for (const m of [M, M1, M2]) if (await prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId: entity.id, month: m } } })) { console.log(`month ${m} already used — run again`); return; }
  const mk = (name: string, role: "ENGINEER" | "SALES", managerCode?: string) => createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `${name} ${stamp}`, role, email: `${name.toLowerCase()}${stamp}@dcit.test`, password: "probe123", managerCode });
  const mgr = await mk("OtManager", "ENGINEER");
  const w = await mk("OtWorker", "ENGINEER", mgr.code);
  const x = await mk("OtOther", "SALES");
  await addSalaryRecord(md.code, w.code, { effectiveFrom: `${year - 1}-01-01`, baseSalary: 12000, reason: "hire" });
  // a Mon–Sun week inside month M
  const d8 = new Date(Date.UTC(year, mon - 1, 8)), mondayOffset = (d8.getUTCDay() + 6) % 7;
  const day = (k: number) => iso(new Date(Date.UTC(year, mon - 1, 8 - mondayOffset + k))); // k = 0 Mon … 6 Sun

  console.log(`1. request and approval (month ${M})`);
  const r1 = await requestOvertime({ actorCode: w.code, workDate: day(0), startTime: "18:00", endTime: "21:00", kind: "WORKDAY_OT", reason: "VFD retest after hours" });
  assert(r1.status === "PENDING" && Number(r1.hours) === 3, "3 h workday OT waits for the manager");
  await refused(() => requestOvertime({ actorCode: w.code, employeeCode: x.code, workDate: day(0), startTime: "18:00", endTime: "19:00", kind: "WORKDAY_OT", reason: "x" }), /OT_OWN_ONLY/, "nobody but the MD files for someone else");
  await refused(() => decideOvertime({ id: r1.id, actorCode: x.code, decision: "APPROVED" }), /OT_NOT_APPROVER/, "a colleague cannot approve");
  await refused(() => decideOvertime({ id: r1.id, actorCode: w.code, decision: "APPROVED" }), /OT_NOT_APPROVER/, "nobody approves their own");
  await refused(() => decideOvertime({ id: r1.id, actorCode: mgr.code, decision: "REJECTED" }), /OT_REJECT_NOTE_REQUIRED/, "a rejection needs a reason");
  await decideOvertime({ id: r1.id, actorCode: mgr.code, decision: "APPROVED" });
  await refused(() => requestOvertime({ actorCode: w.code, workDate: day(0), startTime: "20:00", endTime: "22:00", kind: "WORKDAY_OT", reason: "x" }), /OT_OVERLAP/, "overlapping overtime refused");

  console.log("2. 36 h a week");
  const approve = async (r: { id: string }) => decideOvertime({ id: r.id, actorCode: mgr.code, decision: "APPROVED" });
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(1), startTime: "08:00", endTime: "20:00", kind: "HOLIDAY_OT", reason: "shutdown job" }));
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(2), startTime: "08:00", endTime: "20:00", kind: "HOLIDAY_OT", reason: "shutdown job" }));
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(3), startTime: "18:00", endTime: "02:00", kind: "WORKDAY_OT", reason: "night commissioning" }));
  await refused(() => requestOvertime({ actorCode: w.code, workDate: day(4), startTime: "18:00", endTime: "20:00", kind: "WORKDAY_OT", reason: "x" }), /OT_WEEKLY_CAP:35\+2>36/, "35 h used: 2 more refused (cap 36)");
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(5), startTime: "08:00", endTime: "17:00", breakMinutes: 60, kind: "HOLIDAY_WORK", reason: "Saturday site" }));
  console.log("  ok  8 h holiday work in normal hours does not count against the cap");

  console.log("3. actual hours");
  const up = await confirmActualHours({ id: r1.id, actorCode: w.code, actualStart: "18:00", actualEnd: "21:30" });
  assert(up.status === "PENDING" && Number(up.hours) === 3.5, "3.5 h actual > 3 h approved → back to the manager");
  await approve(r1);
  const late = await requestOvertime({ actorCode: w.code, workDate: day(7), startTime: "09:00", endTime: "11:00", kind: "HOLIDAY_OT", reason: "late paperwork" });
  const xr = await requestOvertime({ actorCode: x.code, workDate: day(6), startTime: "09:00", endTime: "10:00", kind: "WORKDAY_OT", reason: "customer visit" });
  await decideOvertime({ id: xr.id, actorCode: md.code, decision: "APPROVED", note: "ok" });
  const mdOwn = await requestOvertime({ actorCode: md.code, workDate: day(6), startTime: "13:00", endTime: "14:00", kind: "HOLIDAY_OT", reason: "MD own" });
  assert(mdOwn.status === "APPROVED", "the MD's own request is approved at once");

  console.log("4. month end");
  await refused(() => closeOvertimeMonth({ entityId: entity.id, month: new Date().toISOString().slice(0, 7), closedBy: md.code }), /OT_MONTH_NOT_ENDED/, "the running month cannot be closed");
  const m = await closeOvertimeMonth({ entityId: entity.id, month: M, closedBy: md.code });
  const again = await closeOvertimeMonth({ entityId: entity.id, month: M, closedBy: "SYSTEM" });
  assert(again.id === m.id, "closing twice returns the same close");
  const det = await overtimeMonthDetail(entity.id, M);
  const lw = det!.lines.find((l) => l.employeeId === w.id)!;
  const h = lw.hours as Record<string, number>, a = lw.amounts as Record<string, number>;
  assert(Number(lw.hourlyRate) === 50 && h.WORKDAY_OT === 11.5 && h.HOLIDAY_OT === 24 && h.HOLIDAY_WORK === 8, "12 000 ÷ 30 ÷ 8 = 50/h; 11.5 h OT, 24 h holiday OT, 8 h holiday work");
  assert(a.WORKDAY_OT === 862.5 && a.HOLIDAY_OT === 3600 && a.HOLIDAY_WORK === 400 && Number(lw.total) === 4862.5, "1.5× 862.50 + 3× 3 600 + 1× 400 = 4 862.50");
  const lx = det!.lines.find((l) => l.employeeId === x.id)!;
  assert(lx.missingSalary && Number(lx.total) === 0 && Number(lx.totalHours) === 1, "no salary on file: hours counted, amount 0, flagged");
  assert((await prisma.overtimeRequest.findUniqueOrThrow({ where: { id: late.id } })).payMonthId === null, "a request still pending at close is not paid");
  await refused(() => cancelOvertime({ id: r1.id, actorCode: w.code }), /OT_ALREADY_PAID/, "a paid request cannot be withdrawn");
  await refused(() => confirmActualHours({ id: r1.id, actorCode: w.code, actualStart: "18:00", actualEnd: "22:00" }), /OT_ALREADY_PAID/, "nor its hours changed");

  console.log("5. late approval, automatic close, reopen");
  await approve(late);
  const m1 = await closeOvertimeMonth({ entityId: entity.id, month: M1, closedBy: "SYSTEM" });
  const d1 = await overtimeMonthDetail(entity.id, M1);
  const l1 = d1!.lines.find((l) => l.employeeId === w.id)!;
  assert(l1.lateFrom.includes(M) && Number(l1.total) === 300, `late approval paid in ${M1} (2 h × 50 × 3 = 300, from ${M})`);
  const auto = await autoCloseOvertime(new Date(Date.UTC(year, mon + 2, 1, 3))); // the 1st of M+3, 10:00 Bangkok
  assert(auto.includes(`${entity.id}:${M2}`) && !!(await prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId: entity.id, month: M2 } } })), `automatic close on the 1st closed ${M2}`);
  assert((await autoCloseOvertime(new Date(Date.UTC(year, mon + 2, 1, 4)))).length === 0, "the hourly run after it does nothing");
  await refused(() => reopenOvertimeMonth({ entityId: entity.id, month: M, actorCode: mgr.code }), /MD_ONLY/, "only the MD reopens");
  await refused(() => reopenOvertimeMonth({ entityId: entity.id, month: M, actorCode: md.code }), /OT_LATER_MONTH_CLOSED/, "a month with a later close cannot be reopened");
  void m1;
  console.log(`\nOVERTIME PASSED — ${w.code} ${M}: ${Number(lw.total)} THB`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
