/**
 * ETH employee file against a real database: MD creates a file with contacts, careers and quick credentials →
 * expiry alerts → salary record with Thai SSO defaults (MD only, audited) → probation review confirms the person →
 * the person reads their own file (no salary), edits their own contacts, and is refused everything else.
 *   npx tsx scripts/dev/probe-employee.ts
 */
import { prisma } from "../../src/lib/db";
import { addCredential, addQuickCredentials, addReview, addSalaryRecord, authorizeEmployeeReveal, createEmployee, credentialAlerts, currentSalary, getEmployeeFile, mayViewEmployee, probationDue, salaryHistory, setCareers, updateEmployee, updateOwnContacts } from "../../src/server/opd";
import { parseNumber } from "../../src/lib/numbering";
import { STATUTORY } from "../../src/lib/payroll";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`EMPLOYEE FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (fn: () => Promise<unknown>, re: RegExp, m: string) => { try { await fn(); assert(false, m); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.split("\n")[0]})`); } };
const plus = (days: number) => new Date(Date.now() + days * 86_400_000);

async function main() {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const stamp = Date.now().toString().slice(-6);

  console.log("1. MD creates the file in one save");
  const e = await createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `Probe Engineer ${stamp}`, nameLocal: "探针工程师", role: "ENGINEER", email: `probe${stamp}@dcit.test`, password: "probe123",
    nationality: "Thai", birthDate: "1995-04-02", gender: "M", position: "Field service engineer", managerCode: md.code, joinedAt: "2026-10-01", probationEndsAt: plus(5).toISOString().slice(0, 10), contractType: "PROBATION", workLocation: "Rayong",
    phone: "+66 81 234 5678", lineId: "probe_line", wechatId: "probe_wx", emergencyName: "Somchai", emergencyRelation: "father", emergencyPhone: "+66 89 999 0000", bankName: "KBANK", bankAccount: "1234567890", ssoNo: "1234567890123" });
  assert(parseNumber(e.code)?.prefix === "E", `employee ${e.code}`);
  assert(e.managerId === md.id && e.contractType === "PROBATION", "manager and contract type stored");
  await setCareers(md.code, e.code, [{ fromYm: "2018-07", toYm: "2026-09", company: "Some Automation Co.", title: "Service engineer", summary: "VFD and servo commissioning", source: "AI" }, { fromYm: "2015-09", toYm: "2018-06", company: "Motor plant", title: "Technician" }]);
  const n = await addQuickCredentials(md.code, e.code, [{ kind: "PASSPORT", number: "AA1234567", expiresAt: "2032-02-28" }, { kind: "WORK_PERMIT", number: "WP-99-1234", expiresAt: plus(40).toISOString().slice(0, 10) }, { kind: "DEGREE", title: "B.Eng Electrical" }]);
  assert(n === 3, "three credentials from the upload box");
  assert((await addQuickCredentials(md.code, e.code, [{ kind: "PASSPORT", number: "AA1234567", expiresAt: "2032-02-28" }])) === 0, "the same passport is not added twice");
  await addCredential(md.code, e.code, { kind: "REPORT_90", expiresAt: plus(10).toISOString().slice(0, 10), remindDays: 14 });

  console.log("2. alerts");
  const file = (await getEmployeeFile(md, e.code))!;
  assert(file.careers.length === 2 && file.careers[0].source === "AI", "careers kept in order with their source");
  const alerts = credentialAlerts(file.credentials);
  assert(alerts.length === 2 && alerts[0].kind === "REPORT_90" && alerts[1].kind === "WORK_PERMIT", `two alerts, soonest first: ${alerts.map((a) => `${a.kind} ${a.days}d`).join(", ")}`);
  assert(probationDue(file, file.reviews), "probation ending in 5 days with no review → due");

  console.log("3. salary (MD only, Thai SSO defaults)");
  const s1 = await addSalaryRecord(md.code, e.code, { effectiveFrom: "2026-10-01", baseSalary: 28000, allowances: [{ name: "transport", amount: 2000 }], reason: "hire", taxDeductions: { maritalStatus: "single", children: 0 } });
  assert(Number(s1.grossMonthly) === 30000 && Number(s1.ssoWageBase) === STATUTORY.TH.ssoWageCeiling && Number(s1.ssoEmployee) === STATUTORY.TH.ssoWageCeiling * 0.05, `gross 30000, SSO base capped at ${STATUTORY.TH.ssoWageCeiling}, employee contribution ${s1.ssoEmployee}`);
  assert(Number(s1.netEstimate) === 30000 - Number(s1.ssoEmployee), "net estimate = gross − employee SSO");
  const s2 = await addSalaryRecord(md.code, e.code, { effectiveFrom: "2027-01-01", baseSalary: 32000, reason: "confirmation", whtMonthly: 500, pvdEmployeeRate: 0.03, pvdEmployerRate: 0.03 });
  assert(Number(s2.netEstimate) === 32000 - Number(s2.ssoEmployee) - 960 - 500, "net estimate deducts SSO, PVD 3 % and WHT");
  const cur = await currentSalary(e.id, new Date("2026-11-15"));
  assert(cur?.id === s1.id, "current salary on 2026-11-15 is the hire row; the 2027 row is not yet effective");
  assert((await salaryHistory(md, e.id)).length === 2 && (await salaryHistory({ role: "ENGINEER" }, e.id)).length === 0, "salary history: MD sees two rows, an engineer none");
  assert((await prisma.auditLog.count({ where: { target: e.code, action: "SALARY_ADD" } })) === 2, "each salary row is audited");

  console.log("4. probation review confirms the person");
  await addReview(md.code, e.code, { period: "2026-12 probation", kind: "PROBATION", grade: "PASS", reviewedAt: "2026-12-30", conclusion: "confirmed", confirmProbation: true, visibleToEmployee: true });
  await addReview(md.code, e.code, { period: "2026 Q4", kind: "QUARTERLY", score: 88, grade: "B+", reviewedAt: "2027-01-05", conclusion: "fast on site", improvements: "records late", visibleToEmployee: false });
  const after = await prisma.employee.findUniqueOrThrow({ where: { code: e.code } });
  assert(after.confirmedAt !== null && after.contractType === "PERMANENT", "confirmation date set and contract becomes permanent");
  assert(!probationDue(after, [{ kind: "PROBATION" }]), "no longer due");

  console.log("5. the person's own view");
  const me = { role: "ENGINEER", code: e.code };
  assert(mayViewEmployee(me, e.code) && !mayViewEmployee(me, md.code), "may view own file, not the MD's");
  const own = (await getEmployeeFile(me, e.code))!;
  assert(!("salaries" in own), "own file carries no salary rows");
  assert(own.reviews.length === 1 && own.reviews[0].kind === "PROBATION", "only reviews marked visible are shown to the person");
  await updateOwnContacts(e.code, { phone: "+66 81 000 1111", lineId: "probe_new" });
  const c2 = await prisma.employee.findUniqueOrThrow({ where: { code: e.code } });
  assert(c2.phone === "+66 81 000 1111" && c2.lineId === "probe_new" && c2.bankAccount === "1234567890", "own contacts changed, payroll fields untouched");
  await refused(() => addSalaryRecord(e.code, e.code, { effectiveFrom: "2027-02-01", baseSalary: 99999, reason: "self" }), /MD_ONLY/, "an engineer cannot add a salary record");
  await refused(() => updateEmployee({ actorCode: e.code, code: e.code, role: "MD" }), /MD_ONLY/, "an engineer cannot change the file");
  await refused(() => getEmployeeFile(me, md.code), /FORBIDDEN/, "an engineer cannot open another file");
  await refused(() => authorizeEmployeeReveal(e.code, "wrong", e.code), /WRONG_PASSWORD/, "reveal needs the right password");
  await authorizeEmployeeReveal(e.code, "probe123", e.code);
  assert((await prisma.auditLog.count({ where: { target: e.code, action: "CONTACT_REVEAL" } })) === 1, "a reveal is audited");
  await refused(() => updateEmployee({ actorCode: md.code, code: md.code, role: "ENGINEER" }), /MD_SELF_DEMOTE/, "the MD cannot demote themselves");

  console.log("6. leaving");
  await updateEmployee({ actorCode: md.code, code: e.code, active: false, leftAt: "2027-03-31", leftReason: "resigned" });
  const left = await prisma.employee.findUniqueOrThrow({ where: { code: e.code } });
  assert(!left.active && left.leftAt && left.leftReason === "resigned", "left: inactive with date and reason");

  console.log(`\nEMPLOYEE PASSED — ${e.code}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
