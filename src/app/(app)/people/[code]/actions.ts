"use server";
/** Server actions of the ETH file page. Kept in their own module so nothing but `code` is bound (rule: actions never close over translators or helpers). */
import { currentEmployee, grantReveal } from "@/server/auth";
import { addCredential, addQuickCredentials, addReview, addSalaryRecord, auditSalaryView, authorizeEmployeeReveal, removeCredential, setCareers, updateEmployee, updateOwnContacts } from "@/server/opd";
import { guarded } from "@/lib/action-result";
import { ALLOWANCE_ROWS, DEDUCTION_ROWS, readContacts, readEmployeeForm } from "@/components/EmployeeFormFields";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const num = (f: FormData, k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };
const back = (code: string) => `/people/${code}`;

export async function save(code: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const { profile, careers, quick, attachments } = readEmployeeForm(f);
    await updateEmployee({ ...profile, actorCode: me.code, code, role: f.get("role") as "ENGINEER", active: f.get("active") === "on", locale: str(f, "locale"), password: str(f, "password"), attachments });
    await setCareers(me.code, code, careers);
    await addQuickCredentials(me.code, code, quick);
    return "saved";
  }, back(code));
}
export async function saveOwn(code: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await updateOwnContacts(me.code, readContacts(f)); return "saved"; }, back(code));
}
export async function reveal(code: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    await authorizeEmployeeReveal(me.code, String(f.get("password") ?? ""), code);
    await grantReveal(me.code, code);
    if (me.role === "MD") await auditSalaryView(me.code, code);
    return "revealed";
  }, back(code));
}
export async function credential(code: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await addCredential(me.code, code, { kind: f.get("kind") as "PASSPORT", title: str(f, "title"), number: str(f, "number"), issuedAt: str(f, "issuedAt"), expiresAt: str(f, "expiresAt"), remindDays: num(f, "remindDays") ?? 90, note: str(f, "note") }); return "saved"; }, `${back(code)}#credentials`);
}
export async function dropCredential(code: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await removeCredential(me.code, String(f.get("id"))); return "saved"; }, `${back(code)}#credentials`);
}
export async function salary(code: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const allowances = Array.from({ length: ALLOWANCE_ROWS }, (_, i) => ({ name: str(f, `an${i}`) ?? "", amount: num(f, `aa${i}`) ?? 0 })).filter((a) => a.name && a.amount > 0);
    const otherDeductions = Array.from({ length: DEDUCTION_ROWS }, (_, i) => ({ name: str(f, `dn${i}`) ?? "", amount: num(f, `da${i}`) ?? 0 })).filter((a) => a.name && a.amount > 0);
    const taxDeductions: Record<string, string | number> = {};
    for (const k of ["maritalStatus", "children", "parentsSupported", "lifeInsurance", "homeLoanInterest", "pvdDeclared", "otherDeductionsNote"]) { const v = str(f, `tx_${k}`); if (v !== undefined) taxDeductions[k] = ["children", "parentsSupported", "lifeInsurance", "homeLoanInterest", "pvdDeclared"].includes(k) ? Number(v) : v; }
    await addSalaryRecord(me.code, code, { effectiveFrom: String(f.get("effectiveFrom")), currency: str(f, "currency") ?? "THB", baseSalary: num(f, "baseSalary") ?? 0, allowances, ssoWageBase: num(f, "ssoWageBase"), ssoEmployeeRate: num(f, "ssoEmployeeRate"), ssoEmployerRate: num(f, "ssoEmployerRate"), pvdEmployeeRate: num(f, "pvdEmployeeRate"), pvdEmployerRate: num(f, "pvdEmployerRate"), taxDeductions, whtMonthly: num(f, "whtMonthly"), otherDeductions, reason: str(f, "reason") ?? "", note: str(f, "note"), approvedByCode: str(f, "approvedByCode"), approvedAt: str(f, "approvedAt") });
    return "saved";
  }, `${back(code)}#salary`);
}
export async function review(code: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await addReview(me.code, code, { period: str(f, "period") ?? "", kind: f.get("kind") as "QUARTERLY", score: num(f, "score"), grade: str(f, "grade"), reviewedAt: String(f.get("reviewedAt")), conclusion: str(f, "conclusion"), improvements: str(f, "improvements"), visibleToEmployee: f.get("visibleToEmployee") === "on", confirmProbation: f.get("confirmProbation") === "on" }); return "saved"; }, `${back(code)}#reviews`);
}

