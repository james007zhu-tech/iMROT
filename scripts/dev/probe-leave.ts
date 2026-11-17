/**
 * 请假 against a real database (需求清单 v4 V4-P0-12): ask → the approver's bell → approve → balance → an unpaid day is
 * taken off the month's payroll draft (20,000 ÷ 30 = 666.67) without anyone touching the payroll.
 *   npx tsx scripts/dev/probe-leave.ts
 */
import { prisma } from "../../src/lib/db";
import { addSalaryRecord, createEmployee } from "../../src/server/opd";
import { cancelLeave, decideLeave, leaveBalances, leaveSheet, requestLeave } from "../../src/server/leave";
import { computePayroll } from "../../src/server/payroll";
import { noticesFor } from "../../src/server/notify";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => String((e as Error).message));

(async () => {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const stamp = Date.now().toString().slice(-6), year = 2016 + (Number(stamp) % 3), M = `${year}-0${1 + (Number(stamp) % 8)}`;
  const mk = (name: string, role: "ENGINEER" | "HR", managerCode?: string) => createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `TEST ${name} ${stamp}`, role, email: `${name.toLowerCase()}${stamp}@dcit.test`, password: "probe123", managerCode });
  const boss = await mk("LeaveBoss", "ENGINEER"), hr = await mk("LeaveHr", "HR"), w = await mk("LeaveWorker", "ENGINEER", boss.code);
  await prisma.employee.update({ where: { id: boss.id }, data: { approver: true } }); // 主管 = ENG + 本组审批人
  const bossNow = () => prisma.employee.findUniqueOrThrow({ where: { id: boss.id } });
  await prisma.employee.update({ where: { id: w.id }, data: { joinedAt: new Date(`${year - 3}-01-01`) } });
  await addSalaryRecord(md.code, w.code, { effectiveFrom: `${year - 1}-01-01`, baseSalary: 20000, reason: "probe" } as never);
  const d = (n: number) => { const x = new Date(Date.UTC(year, Number(M.slice(5)) - 1, 9)); const off = (x.getUTCDay() + 6) % 7; return new Date(x.getTime() + (n - off) * 86_400_000).toISOString().slice(0, 10); }; // d(0) Monday … d(6) Sunday
  try {
    const before = (await noticesFor((await bossNow()) as never)).filter((n) => n.kind === "leaveApprove").length;
    const sick = await requestLeave({ actorCode: w.code, type: "SICK", from: d(0), reason: "TEST fever" });
    check("one day of sick leave waits for the approver", sick.status === "PENDING" && Number(sick.days) === 1);
    check("the approver's bell counts it", (await noticesFor((await bossNow()) as never)).filter((n) => n.kind === "leaveApprove").length === before + 1);
    check("the person cannot approve their own, a colleague cannot either", /LEAVE_NOT_APPROVER/.test(await msg(decideLeave({ id: sick.id, actorCode: w.code, approve: true }))) && /LEAVE_NOT_APPROVER/.test(await msg(decideLeave({ id: sick.id, actorCode: hr.code, approve: true }))));
    check("a refusal needs a reason", /REASON_REQUIRED/.test(await msg(decideLeave({ id: sick.id, actorCode: boss.code, approve: false }))));
    await decideLeave({ id: sick.id, actorCode: boss.code, approve: true });
    let b = (await leaveBalances([w.id], year)).get(w.id)!;
    check("approved: sick leave left 29 of 30", b.left.SICK === 29 && b.quota.SICK === 30, `${b.left.SICK}`);
    check("the same days cannot be asked twice", /LEAVE_OVERLAP/.test(await msg(requestLeave({ actorCode: w.code, type: "PERSONAL", from: d(0), reason: "x" }))));
    check("a Sunday alone is no leave day", /LEAVE_NO_WORKDAY/.test(await msg(requestLeave({ actorCode: w.code, type: "PERSONAL", from: d(6), reason: "x" }))));
    check("three sick days without the certificate are refused", /LEAVE_CERT_REQUIRED/.test(await msg(requestLeave({ actorCode: w.code, type: "SICK", from: d(1), to: d(3), reason: "x" }))));
    check("half a day is for a single day", /LEAVE_HALF_ONE_DAY/.test(await msg(requestLeave({ actorCode: w.code, type: "PERSONAL", from: d(1), to: d(2), half: "AM", reason: "x" }))));
    const half = await requestLeave({ actorCode: w.code, type: "ANNUAL", from: d(1), half: "PM", reason: "TEST half day" });
    check("half a day counts 0.5", Number(half.days) === 0.5);
    await cancelLeave({ id: half.id, actorCode: w.code });
    const week = await requestLeave({ actorCode: w.code, type: "ANNUAL", from: d(4), to: d(7), reason: "TEST long weekend" });
    check("Friday to Monday is 3 working days (the Sunday is not counted)", Number(week.days) === 3, String(week.days));
    await cancelLeave({ id: week.id, actorCode: w.code });
    check("someone else's leave: only HR or the MD file it", /LEAVE_OWN_ONLY/.test(await msg(requestLeave({ actorCode: boss.code, employeeCode: w.code, type: "UNPAID", from: d(2), reason: "x" }))));
    const unpaid = await requestLeave({ actorCode: hr.code, employeeCode: w.code, type: "UNPAID", from: d(2), reason: "TEST unpaid business leave" });
    check("HR files it for the person — it still waits for the approver", unpaid.status === "PENDING");
    // payroll: nothing is taken off while it waits
    const line = async () => { const run = await computePayroll({ entityId: md.entityId, month: M, actorCode: hr.code }); return prisma.payrollLine.findFirstOrThrow({ where: { runId: run.id, employeeId: w.id } }); };
    const l0 = await line();
    check("waiting leave takes nothing off the pay; paid sick leave neither", Number(l0.leaveDeduction) === 0 && Number(l0.unpaidLeaveDays) === 0);
    await decideLeave({ id: unpaid.id, actorCode: boss.code, approve: true });
    const l1 = await line();
    check("one unpaid day approved: 20,000 ÷ 30 = 666.67 off the month's draft, by itself", Number(l1.leaveDeduction) === 666.67 && Number(l1.unpaidLeaveDays) === 1 && Math.abs(Number(l0.gross) - Number(l1.gross) - 666.67) < 0.005, `${l1.leaveDeduction} gross ${l0.gross}→${l1.gross}`);
    for (const day of [d(8), d(9), d(10)]) await decideLeave({ id: (await requestLeave({ actorCode: w.code, type: "PERSONAL", from: day, reason: "TEST" })).id, actorCode: boss.code, approve: true });
    const over = await requestLeave({ actorCode: w.code, type: "PERSONAL", from: d(11), reason: "TEST fourth day" });
    await decideLeave({ id: over.id, actorCode: md.code, approve: true });
    b = (await leaveBalances([w.id], year)).get(w.id)!;
    const l2 = await line();
    check("the fourth day of business leave in the year is unpaid too: 2 days, 1,333.33", b.left.PERSONAL === 0 && Number(l2.unpaidLeaveDays) === 2 && Number(l2.leaveDeduction) === 1333.33, `${l2.unpaidLeaveDays} ${l2.leaveDeduction}`);
    const row = (await leaveSheet(md.entityId, M)).find((r) => r.id === w.id)!;
    check("HR's sheet: 1 sick, 4 business, 1 unpaid leave, 2 unpaid days, balance shown", row.taken.SICK === 1 && row.taken.PERSONAL === 4 && row.taken.UNPAID === 1 && row.unpaid === 2 && row.left.SICK === 29, JSON.stringify(row.taken));
  } finally {
    const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId: md.entityId, month: M } } });
    if (run) { await prisma.expenseClaim.updateMany({ where: { payrollRunId: run.id }, data: { payrollRunId: null } }); await prisma.payrollRun.delete({ where: { id: run.id } }).catch(() => null); }
    await prisma.leaveRequest.deleteMany({ where: { employeeId: w.id } });
    for (const e of [w, hr, boss]) await prisma.employee.update({ where: { id: e.id }, data: { active: false } });
  }
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
