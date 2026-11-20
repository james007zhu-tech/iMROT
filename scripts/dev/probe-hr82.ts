/**
 * H-R82 (P0, third round 2026-11-20): one overtime is in one month's pay only — whatever order the months are
 * computed in, and whatever HR does with it afterwards. Months long before any real data; removes what it made.
 */
import { prisma } from "@/lib/db";
import { addSalaryRecord } from "@/server/opd";
import { computePayroll, lateOvertime, carryOvertime, recountPayroll, submitPayroll } from "@/server/payroll";

const MD = "ETH2611001", M1 = "2012-05", M2 = "2012-06";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: MD } });
  const tag = Date.now().toString(36);
  const eng = await prisma.employee.create({ data: { code: `ETH15${String(Date.now() % 100000).padStart(5, "0")}`, entityId: md.entityId, name: `Probe HR82 ${tag}`, role: "ENGINEER", managerId: md.id, joinedAt: new Date("2011-01-01"), bankAccount: "TEST-PROBE-000" } });
  const hr = await prisma.employee.create({ data: { code: `ETH14${String((Date.now() + 3) % 100000).padStart(5, "0")}`, entityId: md.entityId, name: `Probe HR ${tag}`, role: "HR", managerId: md.id, joinedAt: new Date("2030-01-01") } });
  const ot = (day: string, hours: number, start: string, end: string) => prisma.overtimeRequest.create({ data: { entityId: md.entityId, employeeId: eng.id, workDate: new Date(`${day}T00:00:00Z`), startTime: start, endTime: end, hours, kind: "WORKDAY_OT", reason: "probe H-R82", status: "APPROVED", approverId: md.id, decidedAt: new Date(), createdById: md.id } });
  const line = async (m: string) => Number((await prisma.payrollLine.findFirst({ where: { employeeId: eng.id, run: { entityId: md.entityId, month: m } } }))?.overtime ?? 0);
  const both = async () => `${M1}=${await line(M1)} ${M2}=${await line(M2)}`;
  const compute = (m: string) => computePayroll({ entityId: md.entityId, month: m, actorCode: hr.code });
  try {
    await addSalaryRecord(MD, eng.code, { effectiveFrom: "2012-01-01", baseSalary: 30000, variablePay: 0, allowances: [], reason: "probe" } as never);
    // 30,000 ÷ 30 ÷ 8 × 1.5 = 187.5 per hour
    const A = await ot(`${M1}-13`, 2, "18:00", "20:00"); // 375
    // 1. the later month is computed first, then the earlier one
    await compute(M2);
    check("June computed first takes May's overtime (May has no sheet yet)", (await line(M2)) === 375, await both());
    await compute(M1);
    check("May computed afterwards does not take it a second time", (await line(M1)) === 0 && (await line(M2)) === 375, await both());
    await compute(M2);
    check("June computed again lets go of it — and May says it is 未计入, nothing is lost", (await line(M2)) === 0 && (await lateOvertime(md.entityId, M1)).rows.some((r) => r.id === A.id), await both());
    await recountPayroll({ entityId: md.entityId, month: M1, actorCode: hr.code });
    check("补算 May: in May once", (await line(M1)) === 375 && (await line(M2)) === 0 && (await lateOvertime(md.entityId, M1)).rows.length === 0, await both());
    await compute(M2);
    check("…and June stays without it however often it is computed", (await line(M2)) === 0, await both());
    // 2. overtime already in May's figure whose hours are confirmed afterwards: 挂到下月 must not move it
    await prisma.overtimeRequest.update({ where: { id: A.id }, data: { actualHours: 3, confirmedAt: new Date() } });
    const late = await lateOvertime(md.entityId, M1);
    check("hours changed after the sheet: listed as 未计入 (the figure is stale)", late.rows.some((r) => r.id === A.id) && late.standing.has(A.id));
    const c = await carryOvertime({ entityId: md.entityId, month: M1, actorCode: hr.code }).catch((e) => String(e.message));
    check("挂到下月 is refused for overtime that stands in this month's figure", c === "OT_IN_FIGURE" && (await prisma.overtimeRequest.findUniqueOrThrow({ where: { id: A.id } })).payNotBefore === null, String(c));
    await compute(M2);
    check("June still 0", (await line(M2)) === 0, await both());
    await recountPayroll({ entityId: md.entityId, month: M1, actorCode: hr.code });
    check("补算 May: 3 h = 562.5, once", (await line(M1)) === 562.5 && (await line(M2)) === 0, await both());
    // 3. overtime approved after May left HR, carried to June: in June once, never in May
    await submitPayroll({ entityId: md.entityId, month: M1, actorCode: hr.code });
    const B = await ot(`${M1}-29`, 2, "18:00", "20:00");
    await compute(M2);
    check("approved after May was computed: waits for HR's choice, June does not pick it up by itself", (await line(M2)) === 0 && (await lateOvertime(md.entityId, M1)).rows.some((r) => r.id === B.id), await both());
    check("挂到下月 carries exactly that one", (await carryOvertime({ entityId: md.entityId, month: M1, actorCode: hr.code })) === 1);
    await compute(M2);
    check("June has it (375), May keeps 562.5", (await line(M2)) === 375 && (await line(M1)) === 562.5, await both());
    await compute(M1).catch(() => undefined); await compute(M2);
    check("computing both again changes nothing: 562.5 + 375, each overtime once", (await line(M1)) === 562.5 && (await line(M2)) === 375, await both());
  } finally {
    await prisma.payrollRun.deleteMany({ where: { entityId: md.entityId, month: { in: [M1, M2] } } });
    await prisma.overtimeRequest.deleteMany({ where: { employeeId: eng.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: [eng.id, hr.id] } }, { target: { in: [M1, M2, eng.code] } }] } });
    await prisma.salaryRecord.deleteMany({ where: { employeeId: eng.id } });
    await prisma.employee.deleteMany({ where: { id: { in: [eng.id, hr.id] } } });
  }
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
