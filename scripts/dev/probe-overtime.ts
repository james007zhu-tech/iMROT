/**
 * 加班 against a real database (2026-11-09): request → manager approval (others refused) → overlap and 36 h/week refused →
 * actual hours above the approval go back to the manager → month-end close pays 1.5× / 1× / 3× of salary ÷ 30 ÷ 8 →
 * idempotent → a late approval is paid next month → missing salary flagged → automatic close → reopen rules.
 * Uses a past month chosen from the run stamp so runs do not collide.   npx tsx scripts/dev/probe-overtime.ts
 */
import { prisma } from "../../src/lib/db";
import { addSalaryRecord, createEmployee } from "../../src/server/opd";
import { autoCloseOvertime, cancelOvertime, closeOvertimeMonth, confirmActualHours, decideOvertime, overtimeMonthDetail, reopenOvertimeMonth, requestOvertime, draftOvertimeFromWork, previewOvertimeMonth, setHoliday } from "../../src/server/overtime";

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

  console.log(`1. request and approval (month ${M}) — the employee gives start and end only`);
  const r1 = await requestOvertime({ actorCode: w.code, workDate: day(0), startTime: "18:00", endTime: "21:00", reason: "VFD retest after hours" });
  assert(r1.status === "PENDING" && Number(r1.hours) === 3 && r1.kind === "WORKDAY_OT", "Monday 18:00–21:00: 3 h workday OT waits for the manager");
  await refused(() => requestOvertime({ actorCode: w.code, employeeCode: x.code, workDate: day(0), startTime: "18:00", endTime: "19:00", reason: "x" }), /OT_OWN_ONLY/, "nobody but the MD files for someone else");
  await refused(() => decideOvertime({ id: r1.id, actorCode: x.code, decision: "APPROVED" }), /OT_NOT_APPROVER/, "a colleague cannot approve");
  await refused(() => decideOvertime({ id: r1.id, actorCode: w.code, decision: "APPROVED" }), /OT_NOT_APPROVER/, "nobody approves their own");
  await refused(() => decideOvertime({ id: r1.id, actorCode: mgr.code, decision: "REJECTED" }), /OT_REJECT_NOTE_REQUIRED/, "a rejection needs a reason");
  await decideOvertime({ id: r1.id, actorCode: mgr.code, decision: "APPROVED" });
  await refused(() => requestOvertime({ actorCode: w.code, workDate: day(0), startTime: "20:00", endTime: "22:00", reason: "x" }), /OT_OVERLAP/, "overlapping overtime refused");
  const approve = async (r: { id: string; all?: { id: string }[] }) => { for (const q of r.all ?? [r]) await decideOvertime({ id: q.id, actorCode: mgr.code, decision: "APPROVED" }); };
  await refused(() => confirmActualHours({ id: r1.id, actorCode: w.code, actualStart: "09:00", actualEnd: "12:00" }), /OT_IN_SHIFT/, "actual hours inside the shift are not overtime");
  const up = await confirmActualHours({ id: r1.id, actorCode: w.code, actualStart: "18:00", actualEnd: "21:30" });
  assert(up.status === "PENDING" && Number(up.hours) === 3.5, "3.5 h actual > 3 h approved → back to the manager");
  await approve(r1);

  console.log("2. the shift 08:30–17:30 and the calendar decide (H-R66)");
  await refused(() => requestOvertime({ actorCode: w.code, workDate: day(1), startTime: "09:00", endTime: "11:00", kind: "WORKDAY_OT", reason: "inside the shift" }), /OT_IN_SHIFT:08:30–17:30/, "time inside the shift cannot be claimed");
  const tue = await requestOvertime({ actorCode: w.code, workDate: day(1), startTime: "08:30", endTime: "20:00", kind: "HOLIDAY_OT", reason: "shutdown job" });
  assert(tue.all.length === 1 && tue.kind === "WORKDAY_OT" && tue.startTime === "17:30" && tue.endTime === "20:00" && Number(tue.hours) === 2.5, "Tuesday 08:30–20:00: only 17:30–20:00 = 2.5 h ×1.5 (not 11.5 h), whatever kind was sent");
  await approve(tue);
  await refused(() => setHoliday({ actorCode: w.code, date: new Date(`${day(2)}T00:00:00Z`), name: "TEST holiday" }), /NO_PERMISSION/, "an engineer cannot set a holiday");
  await setHoliday({ actorCode: md.code, date: new Date(`${day(2)}T00:00:00Z`), name: "TEST holiday" });
  const hol = await requestOvertime({ actorCode: w.code, workDate: day(2), startTime: "18:00", endTime: "20:00", reason: "holiday call-out" });
  assert(hol.kind === "HOLIDAY_OT" && Number(hol.hours) === 2, "a company holiday, 18:00–20:00 only: 2 h holiday overtime ×3 (H-R69)");
  await approve(hol);
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(3), startTime: "18:00", endTime: "02:00", reason: "night commissioning" }));
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(4), startTime: "17:30", endTime: "03:30", reason: "night commissioning" }));
  const sun = await requestOvertime({ actorCode: w.code, workDate: day(6), startTime: "08:30", endTime: "20:00", kind: "WORKDAY_OT", reason: "Sunday site" });
  assert(sun.all.length === 2 && sun.all[0].kind === "HOLIDAY_WORK" && Number(sun.all[0].hours) === 8 && sun.all[1].kind === "HOLIDAY_OT" && Number(sun.all[1].hours) === 2.5 && sun.all[1].startTime === "17:30", "Sunday 08:30–20:00: 8 h holiday work ×1 + 2.5 h holiday OT ×3, by itself");
  await approve(sun);
  await approve(await requestOvertime({ actorCode: w.code, workDate: day(5), startTime: "17:30", endTime: "01:00", reason: "Saturday night" }));
  await refused(() => requestOvertime({ actorCode: w.code, workDate: day(5), startTime: "06:00", endTime: "08:00", reason: "x" }), /OT_WEEKLY_CAP:36\+2>36/, "36 h used this week: 2 more refused (holiday work in normal hours does not count)");

  console.log("3. site hours draft the overtime (N-03)");
  const at = (d: string, t: string) => new Date(`${d}T${t}:00`);
  const s1 = await draftOvertimeFromWork({ employeeId: w.id, start: at(day(8), "08:30"), end: at(day(8), "20:00"), sourceNo: `RPTH-TEST-${stamp}` });
  assert(s1.length === 1 && s1[0].status === "PENDING" && s1[0].origin === "SITE" && s1[0].startTime === "17:30" && Number(s1[0].hours) === 2.5 && s1[0].kind === "WORKDAY_OT", "a report 08:30–20:00 drafts only 17:30–20:00 (2.5 h) for the approver");
  const d2 = await draftOvertimeFromWork({ employeeId: w.id, start: at(day(8), "08:30"), end: at(day(8), "21:00"), sourceNo: `RPTH-TEST-${stamp}` });
  assert(d2.length === 1 && Number(d2[0].hours) === 3.5 && (await prisma.overtimeRequest.count({ where: { sourceNo: `RPTH-TEST-${stamp}` } })) === 1, "the report corrected to 21:00: the draft follows (3.5 h), not a second one");
  assert((await draftOvertimeFromWork({ employeeId: w.id, start: at(day(9), "09:00"), end: at(day(9), "17:00"), sourceNo: `RPTH-TEST2-${stamp}` })).length === 0, "a report inside the shift drafts nothing");
  assert((await draftOvertimeFromWork({ employeeId: w.id, start: at(day(0), "08:30"), end: at(day(0), "21:00"), sourceNo: `RPTH-TEST3-${stamp}` })).length === 0, "hours the person already asked for are not drafted twice");
  assert((await draftOvertimeFromWork({ employeeId: w.id, start: at(day(9), "19:00"), end: new Date(at(day(9), "19:00").getTime() + 20000), sourceNo: `RPTH-TEST5-${stamp}` })).length === 0, "a report opened and finished within the same minute drafts nothing");
  assert((await draftOvertimeFromWork({ employeeId: w.id, start: at(day(9), "08:30"), end: at(day(11), "20:00"), sourceNo: `RPTH-TEST4-${stamp}` })).length === 0, "a report running over several days is left alone");
  assert(!(await previewOvertimeMonth(entity.id, M)).find((l) => l.employeeId === w.id)?.requests.some((q) => q.origin === "SITE"), "a draft nobody approved is not in the pay");
  await decideOvertime({ id: d2[0].id, actorCode: mgr.code, decision: "REJECTED", note: "probe: not agreed" });

  const late = await requestOvertime({ actorCode: w.code, workDate: day(7), startTime: "18:00", endTime: "20:00", reason: "late paperwork" });
  const xr = await requestOvertime({ actorCode: x.code, workDate: day(4), startTime: "18:00", endTime: "19:00", reason: "customer visit" });
  await decideOvertime({ id: xr.id, actorCode: md.code, decision: "APPROVED", note: "ok" });
  const sunEve = await requestOvertime({ actorCode: x.code, workDate: day(6), startTime: "18:00", endTime: "20:00", reason: "Sunday evening only" });
  assert(sunEve.all.length === 1 && sunEve.kind === "HOLIDAY_OT" && Number(sunEve.hours) === 2, "Sunday 18:00–20:00 only: 2 h ×3, not ×1 (H-R69)");
  await cancelOvertime({ id: sunEve.id, actorCode: x.code });
  const mdOwn = await requestOvertime({ actorCode: md.code, workDate: day(6), startTime: "13:00", endTime: "14:00", reason: "MD own" });
  assert(mdOwn.status === "APPROVED" && mdOwn.kind === "HOLIDAY_WORK", "the MD's own request is approved at once");

  console.log("4. month end");
  await refused(() => closeOvertimeMonth({ entityId: entity.id, month: new Date().toISOString().slice(0, 7), closedBy: md.code }), /OT_MONTH_NOT_ENDED/, "the running month cannot be closed");
  const m = await closeOvertimeMonth({ entityId: entity.id, month: M, closedBy: md.code });
  const again = await closeOvertimeMonth({ entityId: entity.id, month: M, closedBy: "SYSTEM" });
  assert(again.id === m.id, "closing twice returns the same close");
  const det = await overtimeMonthDetail(entity.id, M);
  const lw = det!.lines.find((l) => l.employeeId === w.id)!;
  const h = lw.hours as Record<string, number>, a = lw.amounts as Record<string, number>;
  assert(Number(lw.hourlyRate) === 50 && h.WORKDAY_OT === 31.5 && h.HOLIDAY_OT === 4.5 && h.HOLIDAY_WORK === 8, `12 000 ÷ 30 ÷ 8 = 50/h; 31.5 h OT, 4.5 h holiday OT, 8 h holiday work (${JSON.stringify(h)})`);
  assert(a.WORKDAY_OT === 2362.5 && a.HOLIDAY_OT === 675 && a.HOLIDAY_WORK === 400 && Number(lw.total) === 3437.5, "1.5× 2 362.50 + 3× 675 + 1× 400 = 3 437.50");
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
  assert(l1.lateFrom.includes(M) && Number(l1.total) === 150, `late approval paid in ${M1} (2 h × 50 × 1.5 = 150, from ${M})`);
  const auto = await autoCloseOvertime(new Date(Date.UTC(year, mon + 2, 1, 3))); // the 1st of M+3, 10:00 Bangkok
  assert(auto.includes(`${entity.id}:${M2}`) && !!(await prisma.overtimeMonth.findUnique({ where: { entityId_month: { entityId: entity.id, month: M2 } } })), `automatic close on the 1st closed ${M2}`);
  assert((await autoCloseOvertime(new Date(Date.UTC(year, mon + 2, 1, 4)))).length === 0, "the hourly run after it does nothing");
  await refused(() => reopenOvertimeMonth({ entityId: entity.id, month: M, actorCode: mgr.code }), /MD_ONLY/, "only the MD reopens");
  await refused(() => reopenOvertimeMonth({ entityId: entity.id, month: M, actorCode: md.code }), /OT_LATER_MONTH_CLOSED/, "a month with a later close cannot be reopened");
  void m1;
  await prisma.holiday.deleteMany({ where: { name: "TEST holiday" } });
  console.log(`\nOVERTIME PASSED — ${w.code} ${M}: ${Number(lw.total)} THB`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
