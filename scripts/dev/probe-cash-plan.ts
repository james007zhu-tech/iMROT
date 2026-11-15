/**
 * 现金计划, pinned: fixed payments land on their day, payroll and its taxes on the 5th / 7th / 15th, the plan of a
 * month is kept as it began while the page moves on. Uses a far month so real data does not interfere much.
 *   npx tsx scripts/dev/probe-cash-plan.ts
 */
import { prisma } from "../../src/lib/db";
import { buildCashPlan, ensureCashPlan, saveRecurring, stopRecurring } from "../../src/server/cash-plan";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return ""; } catch (e) { return (e as Error).message.split("\n")[0]; } };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: process.env.PROBE_ACTOR ?? "ETH2611001" } });
  const eng = await prisma.employee.findFirst({ where: { role: "ENGINEER" } });
  const stamp = Date.now().toString().slice(-6), month = "2031-02", payee = `Probe Landlord ${stamp}`;
  await prisma.cashPlan.deleteMany({ where: { entityId: md.entityId, month } });

  const rent = await saveRecurring(md.entityId, md, null, { payee, purpose: "Office rent", amount: 35000, dayOfMonth: 31, startMonth: "2031-01", endMonth: "2031-03" });
  const feb = await buildCashPlan(md.entityId, month);
  const line = feb.lines.find((l) => l.party === payee);
  check("a fixed payment is in the plan on its day — the last day when the month is shorter", line?.date === "2031-02-28" && line.amount === 35000 && line.kind === "FIXED" && !!line.fixed, line?.date);
  check("… and counts in what is certain", feb.totals.fixedOut >= 35000 && feb.totals.out >= feb.totals.fixedOut);
  check("it is not paid after its last month", !(await buildCashPlan(md.entityId, "2031-04")).lines.some((l) => l.party === payee));
  check("it is not paid before its first month", !(await buildCashPlan(md.entityId, "2030-12")).lines.some((l) => l.party === payee));

  const first = await ensureCashPlan(md.entityId, month);
  await saveRecurring(md.entityId, md, null, { payee: `${payee} B`, purpose: "Accounting fee", amount: 8000, dayOfMonth: 10, startMonth: "2031-02" });
  const again = await ensureCashPlan(md.entityId, month);
  const now = await buildCashPlan(md.entityId, month);
  check("the plan of the month is kept as it began; the page moves on", first.created && !again.created && !(again.plan.lines as { party: string }[]).some((l) => l.party === `${payee} B`) && now.lines.some((l) => l.party === `${payee} B` && l.date === "2031-02-10"));

  check("a fixed payment needs a payee, an amount and a day", (await refused(() => saveRecurring(md.entityId, md, null, { payee: "", purpose: "x", amount: 1, dayOfMonth: 1, startMonth: "2031-01" }))) === "INVALID_INPUT" && (await refused(() => saveRecurring(md.entityId, md, null, { payee: "x", purpose: "x", amount: 0, dayOfMonth: 1, startMonth: "2031-01" }))) === "INVALID_INPUT" && (await refused(() => saveRecurring(md.entityId, md, null, { payee: "x", purpose: "x", amount: 5, dayOfMonth: 40, startMonth: "2031-01" }))) === "INVALID_INPUT");
  if (eng) check("only the MD and finance keep the fixed payments", (await refused(() => saveRecurring(md.entityId, eng, null, { payee: "x", purpose: "x", amount: 5, dayOfMonth: 1, startMonth: "2031-01" }))) === "FORBIDDEN");

  // payroll of the month before: a run in January is paid in February
  const run = await prisma.payrollRun.findUnique({ where: { entityId_month: { entityId: md.entityId, month: "2031-01" } } });
  if (!run) {
    const made = await prisma.payrollRun.create({ data: { entityId: md.entityId, month: "2031-01", status: "APPROVED", policy: {}, totals: {}, createdBy: md.code, lines: { create: [{ employeeId: md.id, baseSalary: 50000, allowances: [], allowanceTotal: 0, gross: 50000, ssoBase: 17500, ssoEmployee: 875, ssoEmployer: 875, wht: 1200, net: 47925, employerCost: 50875 }] } } });
    const p = await buildCashPlan(md.entityId, month);
    const pay = p.lines.find((l) => l.kind === "PAYROLL"), pnd = p.lines.find((l) => l.kind === "PND1"), sso = p.lines.find((l) => l.kind === "SSO");
    check("last month's payroll: pay on the 5th, ภ.ง.ด.1 on the 7th, social security (both halves) on the 15th", pay?.date === "2031-02-05" && pay.amount === 47925 && pnd?.date === "2031-02-07" && pnd.amount === 1200 && sso?.date === "2031-02-15" && sso.amount === 1750, `${pay?.amount} / ${pnd?.amount} / ${sso?.amount}`);
    await prisma.payrollRun.update({ where: { id: made.id }, data: { status: "PAID", paidAt: new Date() } });
    const paid = await buildCashPlan(md.entityId, month);
    check("once paid, the pay leaves the plan; the tax and social security stay until their day", !paid.lines.some((l) => l.kind === "PAYROLL") && paid.lines.some((l) => l.kind === "PND1") && paid.lines.some((l) => l.kind === "SSO"));
    await prisma.payrollRun.delete({ where: { id: made.id } });
  }
  await stopRecurring(md, rent.id);
  check("a stopped payment leaves the plan", !(await buildCashPlan(md.entityId, month)).lines.some((l) => l.party === payee));
  await prisma.recurringPayment.updateMany({ where: { payee: { startsWith: payee } }, data: { active: false } });
  await prisma.cashPlan.deleteMany({ where: { entityId: md.entityId, month } });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
