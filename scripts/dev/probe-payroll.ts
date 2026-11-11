/**
 * Payroll end to end on real tables: a salary with performance pay, an expense claim approved by the MD, a monthly
 * score, the run computed, blocked while a score is missing, approved, paid — and the claim settled with it.
 * Uses a month long before any real data and removes what it made.  npx tsx scripts/dev/probe-payroll.ts
 */
import { prisma } from "@/lib/db";
import { addSalaryRecord } from "@/server/opd";
import { decideExpense, fileExpense } from "@/server/expense";
import { approvePayroll, computePayroll, markPayrollPaid, payrollDetail, reopenPayroll, saveScores } from "@/server/payroll";
import { runAction } from "@/server/ai-actions";
import { hiddenFor, menuKeyOf, setRoleMenu } from "@/server/perm";
import { financeReport } from "@/server/fin-report";

const MD = process.env.PROBE_ACTOR ?? "ETH2611001";
const MONTH = "2019-03";
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: MD } });
  const tag = Date.now().toString(36);
  const eng = await prisma.employee.create({ data: { code: `ETHPROBE${tag}`.toUpperCase().slice(0, 14), entityId: md.entityId, name: `Probe Engineer ${tag}`, role: "ENGINEER", managerId: md.id, joinedAt: new Date("2018-01-01"), taxNo: "1100000000001", ssoNo: "1100000000001", bankAccount: "123-4-56789-0", bankName: "KBANK" } });
  const made: { claim?: string } = {};
  try {
    await addSalaryRecord(MD, eng.code, { effectiveFrom: "2019-01-01", baseSalary: 30000, variablePay: 5000, allowances: [{ name: "Transport", amount: 2000 }], reason: "probe" } as never);
    const claim = await runAction("file_expense", { spentOn: "2019-03-10", category: "fuel", description: "Fuel to site", amount: 640, receiptNo: `R-${tag}`, vendor: "PTT" }, { employeeCode: eng.code });
    check("the assistant files an expense claim", !!claim.ok, claim.summary);
    const c = await prisma.expenseClaim.findFirstOrThrow({ where: { employeeId: eng.id } }); made.claim = c.id;
    const twice = await runAction("file_expense", { spentOn: "2019-03-10", category: "FUEL", description: "again", amount: 640, receiptNo: `R-${tag}`, vendor: "PTT" }, { employeeCode: eng.code }).catch((e) => String(e.message));
    check("the same receipt twice is refused", /EXPENSE_DUPLICATE/.test(String(twice)), String(twice).slice(0, 50));
    const self = await decideExpense({ id: c.id, actorCode: eng.code, decision: "APPROVED" }).catch((e) => String(e.message));
    check("nobody approves their own claim", self === "EXPENSE_NOT_APPROVER");
    await decideExpense({ id: c.id, actorCode: MD, decision: "APPROVED" });

    await computePayroll({ entityId: md.entityId, month: MONTH, actorCode: MD });
    let run = await payrollDetail(md.entityId, MONTH);
    let line = run!.lines.find((l) => l.employeeId === eng.id)!;
    check("the run includes the engineer and flags the missing score", line.missing.includes("PERFORMANCE"), line.missing.join(","));
    check("the claim rides on the line as a reimbursement, not income", Number(line.reimbursement) === 640 && Number(line.gross) === 37000, `gross ${line.gross} reimb ${line.reimbursement}`);
    const early = await approvePayroll({ entityId: md.entityId, month: MONTH, actorCode: MD }).catch((e) => String(e.message));
    check("approval waits for the performance score", /PAYROLL_INCOMPLETE/.test(String(early)), String(early).slice(0, 60));
    const own = await saveScores({ actorCode: eng.code, month: MONTH, scores: [{ code: eng.code, score: 100 }] }).catch((e) => String(e.message));
    check("nobody scores themselves", /NOT_YOUR_REPORT/.test(String(own)));
    // every other person with performance pay and no score would block the probe month: score them all as the MD
    const others = run!.lines.filter((l) => l.missing.includes("PERFORMANCE")).map((l) => ({ code: l.employee.code, score: l.employeeId === eng.id ? 92 : 80 }));
    await saveScores({ actorCode: MD, month: MONTH, scores: others });
    await computePayroll({ entityId: md.entityId, month: MONTH, actorCode: MD, edits: { [eng.code]: { bonus: 1000, otherDeduction: 200 } } });
    run = await payrollDetail(md.entityId, MONTH); line = run!.lines.find((l) => l.employeeId === eng.id)!;
    // 30,000 + 2,000 + 5,000 × 1.2 + 1,000 = 39,000; SSO 875; tax: regular year 384,000 → 3,175/12 = 264.58, irregular 7,000 × 5 % = 350
    check("score 92 → ×1.2, bonus and deduction typed by the MD", Number(line.incentive) === 6000 && Number(line.gross) === 39000 && Number(line.ssoEmployee) === 875, `incentive ${line.incentive} gross ${line.gross}`);
    check("withholding = regular share + this month's irregular pay", Number(line.wht) === 614.58, String(line.wht));
    check("net = gross − SSO − tax − deduction + reimbursement", Number(line.net) === 39000 - 875 - 614.58 - 200 + 640, String(line.net));
    const blockers = run!.lines.filter((l) => l.missing.includes("OVERTIME_OPEN"));
    check("people without a salary record are named, not paid zero", Array.isArray((run!.totals as { skipped?: string[] }).skipped));
    if (blockers.length) console.log(`  (other staff block approval in this database: ${blockers.map((l) => `${l.employee.code} ${l.missing.join("/")}`).join("; ")} — approval steps skipped)`);
    else {
      await approvePayroll({ entityId: md.entityId, month: MONTH, actorCode: MD });
      const locked = await computePayroll({ entityId: md.entityId, month: MONTH, actorCode: MD }).catch((e) => String(e.message));
      check("an approved month cannot be recomputed", /PAYROLL_LOCKED/.test(String(locked)));
      await reopenPayroll({ entityId: md.entityId, month: MONTH, actorCode: MD });
      await approvePayroll({ entityId: md.entityId, month: MONTH, actorCode: MD });
      await markPayrollPaid({ entityId: md.entityId, month: MONTH, actorCode: MD });
      const paid = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: c.id } });
      check("paying the month settles the claim it carried", paid.status === "PAID" && paid.paidRef === `PAYROLL ${MONTH}`, `${paid.status} ${paid.paidRef}`);
    }
    const rep = await financeReport(md.entityId, 2019, { withPayroll: true });
    check("the finance report counts the claim under its month", rep.months[2].expenses === 640, String(rep.months[2].expenses));

    await setRoleMenu(MD, "ENGINEER", ["assets", "knowledge", "series", "receiving", "inspectionReports", "repairReports", "maintenanceReports", "deliveryNotes", "acceptance", "projects", "stock", "stockIn", "stockOut", "opportunities", "customers"]);
    const hid = await hiddenFor("ENGINEER");
    check("a switched-off entry is hidden for the role, fixed ones stay", hid.has("ledger") && hid.has("permissions") && !hid.has("expenses") && !hid.has("assets"), [...hid].join(","));
    check("a path maps to its menu entry", menuKeyOf("/finance/payables") === "ledger" && menuKeyOf("/documents?type=DN") === "deliveryNotes" && menuKeyOf("/admin/permissions") === "permissions", `${menuKeyOf("/finance/payables")} ${menuKeyOf("/documents?type=DN")}`);
    await prisma.roleMenu.deleteMany({ where: { role: "ENGINEER" } });
  } finally {
    const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId: md.entityId, month: MONTH } } });
    if (run) { await prisma.expenseClaim.updateMany({ where: { payrollRunId: run.id }, data: { payrollRunId: null } }); await prisma.payrollRun.delete({ where: { id: run.id } }); }
    await prisma.performanceReview.deleteMany({ where: { kind: "MONTHLY", period: MONTH } });
    await prisma.expenseClaim.deleteMany({ where: { employeeId: eng.id } });
    await prisma.salaryRecord.deleteMany({ where: { employeeId: eng.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: eng.id }, { target: eng.code }] } });
    await prisma.aiAction.deleteMany({ where: { employeeId: eng.id } });
    await prisma.employee.delete({ where: { id: eng.id } });
  }
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
