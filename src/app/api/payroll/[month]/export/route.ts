/** Payroll exports (MD only), CSV with a BOM so Excel opens Thai and Chinese correctly: bank list, SSO, ภ.ง.ด.1, full sheet. */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sessionEmployeeCode } from "@/server/auth";
import { payrollDetail } from "@/server/payroll";
import { audit } from "@/server/audit";
import { payslipNo } from "@/lib/numbering";

const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const f2 = (n: unknown) => Number(n).toFixed(2);

export async function GET(req: Request, { params }: { params: Promise<{ month: string }> }) {
  const code = await sessionEmployeeCode();
  const me = code ? await prisma.employee.findUnique({ where: { code } }) : null;
  if (!me || me.role !== "MD") return NextResponse.json({ error: "MD_ONLY" }, { status: 403 });
  const { month } = await params;
  const kind = new URL(req.url).searchParams.get("kind") ?? "full";
  const run = await payrollDetail(me.entityId, month);
  if (!run) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const L = run.lines;
  const rows: unknown[][] =
    kind === "bank" ? [["code", "name", "bank", "account", "net_thb"], ...L.map((l) => [l.employee.code, l.employee.name, l.employee.bankName, l.employee.bankAccount, f2(l.net)])]
    : kind === "sso" ? [["code", "name", "sso_no", "wage_base", "employee_5pct", "employer_5pct", "total"], ...L.filter((l) => Number(l.ssoBase) > 0).map((l) => [l.employee.code, l.employee.name, l.employee.ssoNo, f2(l.ssoBase), f2(l.ssoEmployee), f2(l.ssoEmployer), f2(Number(l.ssoEmployee) + Number(l.ssoEmployer))])]
    : kind === "pnd1" ? [["code", "name", "tax_id", "income_40_1", "tax_withheld"], ...L.map((l) => [l.employee.code, l.employee.name, l.employee.taxNo, f2(l.gross), f2(l.wht)])]
    : [["payslip_no", "code", "name", "base", "allowances", "overtime", "variable_pay", "score", "achievement", "factor", "incentive", "quarter_pay", "quarter_achievement", "quarter_factor", "quarter_incentive", "bonus", "gross", "sso_base", "sso_employee", "sso_employer", "pvd_employee", "wht", "wht_typed", "other_deduction", "reimbursement", "net", "employer_cost", "note"],
      ...L.map((l) => [payslipNo(month, l.employee.code), l.employee.code, l.employee.name, f2(l.baseSalary), f2(l.allowanceTotal), f2(l.overtime), f2(l.variablePay), l.perfScore == null ? "" : Number(l.perfScore), l.achievement == null ? "" : Number(l.achievement), Number(l.perfFactor), f2(l.incentive), f2(l.quarterlyPay), l.quarterAchieved == null ? "" : Number(l.quarterAchieved), Number(l.quarterFactor), f2(l.quarterIncentive), f2(l.bonus), f2(l.gross), f2(l.ssoBase), f2(l.ssoEmployee), f2(l.ssoEmployer), f2(l.pvdEmployee), f2(l.wht), l.whtManual ? "yes" : "", f2(l.otherDeduction), f2(l.reimbursement), f2(l.net), f2(l.employerCost), l.note])];
  await audit(me.id, "PAYROLL_EXPORT", month, { kind });
  return new NextResponse(`﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="payroll_${month}_${kind}${run.status === "DRAFT" ? "_DRAFT" : ""}.csv"` } });
}
