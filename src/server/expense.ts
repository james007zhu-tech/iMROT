/**
 * 费用报销: the person files a claim per receipt; their manager or the MD decides; an approved out-of-pocket claim is
 * reimbursed with the month's payroll, or earlier by finance. People see their own claims; managers their reports';
 * the MD and finance see all.
 */
import { localIso } from "@/lib/dates";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { allocateNumber } from "@/lib/numbering-db";

const SEE_ALL = ["MD", "FINANCE"];
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
  if (forCode !== actor.code && !SEE_ALL.includes(actor.role)) throw new Error("EXPENSE_NOT_YOURS");
  const who = forCode === actor.code ? actor : await prisma.employee.findUniqueOrThrow({ where: { code: forCode } });
  if (d.vatAmount != null && d.vatAmount >= d.amount) throw new Error("EXPENSE_VAT_TOO_HIGH");
  if (d.spentOn.getTime() > Date.now() + 86_400_000) throw new Error("EXPENSE_FUTURE_DATE");
  if (d.serviceOrderNo && !(await prisma.serviceOrder.findUnique({ where: { no: d.serviceOrderNo }, select: { id: true } }))) throw new Error(`NO_ORDER:${d.serviceOrderNo}`);
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

async function mayDecide(actorId: string, role: string, claim: { employeeId: string; employee: { managerId: string | null } }) {
  if (claim.employeeId === actorId && role !== "MD") return false; // nobody approves their own claim; the MD has no one above
  return role === "MD" || claim.employee.managerId === actorId;
}

export async function decideExpense(input: { id: string; actorCode: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const c = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: input.id }, include: { employee: { select: { managerId: true } } } });
  if (c.status !== "PENDING") throw new Error("EXPENSE_NOT_PENDING");
  if (!(await mayDecide(actor.id, actor.role, c))) throw new Error("EXPENSE_NOT_APPROVER");
  if (input.decision === "REJECTED" && !input.note?.trim()) throw new Error("EXPENSE_REJECT_NEEDS_REASON");
  await prisma.expenseClaim.update({ where: { id: c.id }, data: { status: input.decision, approverId: actor.id, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
  await audit(actor.id, `EXPENSE_${input.decision}`, c.id, { amount: Number(c.amount) });
}

export async function cancelExpense(input: { id: string; actorCode: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const c = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: input.id } });
  if (c.employeeId !== actor.id && actor.role !== "MD") throw new Error("EXPENSE_NOT_YOURS");
  if (c.status !== "PENDING") throw new Error("EXPENSE_NOT_PENDING");
  await prisma.expenseClaim.update({ where: { id: c.id }, data: { status: "CANCELLED" } });
}

/** Finance pays an approved claim by hand (not waiting for payroll). A claim already inside an approved payroll is left to it. */
export async function payExpense(input: { id: string; actorCode: string; paidRef?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!SEE_ALL.includes(actor.role)) throw new Error("FINANCE_ONLY");
  const c = await prisma.expenseClaim.findUniqueOrThrow({ where: { id: input.id } });
  if (c.status !== "APPROVED") throw new Error("EXPENSE_NOT_APPROVED");
  if (c.payrollRunId) {
    const run = await prisma.payrollRun.findUnique({ where: { id: c.payrollRunId } });
    if (run && run.status !== "DRAFT") throw new Error(`EXPENSE_IN_PAYROLL:${run.month}`);
  }
  await prisma.expenseClaim.update({ where: { id: c.id }, data: { status: "PAID", paidAt: new Date(), paidRef: input.paidRef?.trim() || null, payrollRunId: null } });
  await audit(actor.id, "EXPENSE_PAID", c.id, { amount: Number(c.amount) });
}

export async function expensesFor(actorCode: string, filter: { status?: string; mine?: boolean } = {}) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const scope: Prisma.ExpenseClaimWhereInput = filter.mine || !(SEE_ALL.includes(a.role) || a.role === "MANAGER") ? { employeeId: a.id }
    : SEE_ALL.includes(a.role) ? { entityId: a.entityId } : { OR: [{ employeeId: a.id }, { employee: { managerId: a.id } }] };
  const rows = await prisma.expenseClaim.findMany({ where: { ...scope, ...(filter.status ? { status: filter.status as never } : {}) }, include: { employee: { select: { id: true, code: true, name: true, managerId: true } }, approver: { select: { name: true } } }, orderBy: [{ spentOn: "desc" }, { createdAt: "desc" }], take: 200 });
  return { me: a, rows: await Promise.all(rows.map(async (r) => ({ ...r, canDecide: r.status === "PENDING" && (await mayDecide(a.id, a.role, r)) }))), seeAll: SEE_ALL.includes(a.role) };
}
