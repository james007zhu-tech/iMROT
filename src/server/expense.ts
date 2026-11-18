/**
 * 费用报销: the person files a claim per receipt; their manager or the MD decides; an approved out-of-pocket claim is
 * reimbursed with the month's payroll, or earlier by finance. People see their own claims; managers their reports';
 * the MD and finance see all.
 */
import { assertNotSettled } from "./job-cost";
import { localIso } from "@/lib/dates";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { overLimit } from "@/lib/pay-rules";
import { audit } from "@/server/audit";
import { allocateNumber } from "@/lib/numbering-db";
import { hasRole, isApprover } from "@/lib/caps";

const SEE_ALL = ["MD", "FINANCE"];
type Actor = { id: string; role: string; extraRoles?: string[] | null; approver?: boolean | null };
export const PAID_BY = ["SELF", "PETTY_CASH", "COMPANY"] as const;

export const ExpenseInput = z.object({
  actorCode: z.string(), employeeCode: z.string().optional(),
  spentOn: z.coerce.date(), category: z.string().min(1), description: z.string().min(1),
  vendor: z.string().optional(), vendorTaxId: z.string().optional(), receiptNo: z.string().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("THB"), amount: z.coerce.number().positive(), vatAmount: z.coerce.number().min(0).optional(),
  paidBy: z.enum(PAID_BY).default("SELF"), serviceOrderNo: z.string().optional(),
  receipts: z.array(z.object({ name: z.string(), url: z.string() })).default([]),
});

export async function fileExpense(input: z.input<typeof ExpenseInput>) {
  const d = ExpenseInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  // filing for someone else is for the MD and finance (a driver's fuel receipts handed in on paper)
  const forCode = d.employeeCode && d.employeeCode !== actor.code ? d.employeeCode : actor.code;
  if (forCode !== actor.code && !hasRole(actor, ...SEE_ALL)) throw new Error("EXPENSE_NOT_YOURS");
  const who = forCode === actor.code ? actor : await prisma.employee.findUniqueOrThrow({ where: { code: forCode } });
  if (d.vatAmount != null && d.vatAmount >= d.amount) throw new Error("EXPENSE_VAT_TOO_HIGH");
  if (d.spentOn.getTime() > Date.now() + 86_400_000) throw new Error("EXPENSE_FUTURE_DATE");
  if (d.serviceOrderNo && !(await prisma.serviceOrder.findUnique({ where: { no: d.serviceOrderNo }, select: { id: true } }))) throw new Error(`NO_ORDER:${d.serviceOrderNo}`);
  if (d.serviceOrderNo) await assertNotSettled(await prisma.serviceOrder.findUnique({ where: { no: d.serviceOrderNo }, select: { id: true, no: true } })); // 开票即结算
  // the same receipt twice is the usual mistake
  if (d.receiptNo) {
    const dup = await prisma.expenseClaim.findFirst({ where: { receiptNo: d.receiptNo, vendor: d.vendor ?? undefined, status: { notIn: ["REJECTED", "CANCELLED"] } }, include: { employee: { select: { code: true } } } });
    if (dup) throw new Error(`EXPENSE_DUPLICATE:${d.receiptNo} · ${dup.employee.code} ${localIso(dup.spentOn)!.slice(0, 10)}`);
  }
  const c = await prisma.$transaction(async (tx) => tx.expenseClaim.create({ data: {
    no: await allocateNumber(tx, { prefix: "EX", createdByEmployeeCode: actor.code, entityId: who.entityId }),
    entityId: who.entityId, employeeId: who.id, spentOn: d.spentOn, category: d.category, description: d.description, vendor: d.vendor, vendorTaxId: d.vendorTaxId, receiptNo: d.receiptNo,
    currency: d.currency, amount: d.amount, vatAmount: d.vatAmount, paidBy: d.paidBy, serviceOrderNo: d.serviceOrderNo, receipts: d.receipts as Prisma.InputJsonValue,
  } }));
  await audit(actor.id, "EXPENSE_FILE", c.id, { for: who.code, amount: d.amount, category: d.category });
  return c;
}

/** The finance person pays claims, never their own; the finance person's own claim is paid by the MD. */
export function mayPayClaim(actor: Actor, claim: { employeeId: string; employee: { role: string; extraRoles?: string[] | null } }) {
  if (claim.employeeId === actor.id) return false;
  return hasRole(actor, "FINANCE") || (hasRole(actor, "MD") && hasRole(claim.employee, "FINANCE"));
}

async function mayDecide(actor: Actor, claim: { employeeId: string; employee: { managerId: string | null } }) {
  const actorId = actor.id, md = hasRole(actor, "MD");
  if (claim.employeeId === actorId && !md) return false; // nobody approves their own claim; the MD has no one above
  return md || claim.employee.managerId === actorId;
}

export async function decideExpense(input: { id: string; actorCode: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const c = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: input.id }, include: { employee: { select: { managerId: true } } } });
  if (c.status !== "PENDING") throw new Error("EXPENSE_NOT_PENDING");
  if (!(await mayDecide(actor, c))) throw new Error("EXPENSE_NOT_APPROVER");
  if (input.decision === "REJECTED" && !input.note?.trim()) throw new Error("EXPENSE_REJECT_NEEDS_REASON");
  // one claim above the limit is the MD's to approve, whoever the manager is (THB; a foreign-currency claim always goes up)
  if (input.decision === "APPROVED" && !hasRole(actor, "MD") && (c.currency !== "THB" || overLimit(Number(c.amount)))) throw new Error("EXPENSE_NEEDS_MD");
  await prisma.expenseClaim.update({ where: { id: c.id }, data: { status: input.decision, approverId: actor.id, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
  await audit(actor.id, `EXPENSE_${input.decision}`, c.id, { amount: Number(c.amount) });
}

export async function cancelExpense(input: { id: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const c = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: input.id } });
  if (c.employeeId !== actor.id && !hasRole(actor, "MD")) throw new Error("EXPENSE_NOT_YOURS");
  if (c.status !== "PENDING") throw new Error("EXPENSE_NOT_PENDING");
  await prisma.expenseClaim.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
}

/** Finance pays an approved claim by hand (not waiting for payroll). A claim already inside an approved payroll is left to it. */
export async function payExpense(input: { id: string; actorCode: string; paidRef?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const c = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: input.id }, include: { employee: { select: { role: true } } } });
  if (!mayPayClaim(actor, c)) throw new Error(c.employeeId === actor.id ? "EXPENSE_OWN_PAY" : "FINANCE_PAYS");
  if (c.status !== "APPROVED") throw new Error("EXPENSE_NOT_APPROVED");
  if (c.payrollRunId) {
    const run = await prisma.payrollRun.findUnique({ where: { id: c.payrollRunId } });
    // 一条路 (需求清单 v3 P1-31): a claim that has gone into a payroll is paid with that payroll and nowhere else
    if (run) throw new Error(`EXPENSE_IN_PAYROLL:${run.month}`);
  }
  await prisma.expenseClaim.update({ where: { id: c.id }, data: { status: "PAID", paidAt: new Date(), paidRef: input.paidRef?.trim() || null, payrollRunId: null } });
  await audit(actor.id, "EXPENSE_PAID", c.id, { amount: Number(c.amount) });
}

export async function expensesFor(actorCode: string, filter: { status?: string; mine?: boolean } = {}) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const scope: Prisma.ExpenseClaimWhereInput = filter.mine || !(hasRole(a, ...SEE_ALL) || isApprover(a)) ? { employeeId: a.id }
    : hasRole(a, ...SEE_ALL) ? { entityId: a.entityId } : { OR: [{ employeeId: a.id }, { employee: { managerId: a.id } }] };
  const rows = await prisma.expenseClaim.findMany({ where: { ...scope, ...(filter.status ? { status: filter.status as never } : {}) }, include: { employee: { select: { id: true, code: true, name: true, managerId: true, role: true, extraRoles: true } }, approver: { select: { name: true } } }, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], take: 200 });
  const runs = new Map((await prisma.payrollRun.findMany({ where: { id: { in: rows.map((r) => r.payrollRunId).filter((x): x is string => !!x) } }, select: { id: true, month: true } })).map((x) => [x.id, x.month]));
  return { me: a, rows: await Promise.all(rows.map(async (r) => ({ ...r, payrollMonth: r.payrollRunId ? runs.get(r.payrollRunId) ?? null : null, canDecide: r.status === "PENDING" && (await mayDecide(a, r)), canPay: r.status === "APPROVED" && !r.payrollRunId && mayPayClaim(a, r) }))), seeAll: hasRole(a, ...SEE_ALL) };
}
