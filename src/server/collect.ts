/**
 * 收款三步、两人 (朱总 2026-11-18: "收款也是一样" — the same as paying, server/pay.ts):
 *   1. finance says what arrived: the invoice, the account it arrived in, the amount, any tax the customer withheld;
 *   2. the MD approves — every amount, one baht included; finance and the MD are two people;
 *   3. finance uploads the bank slip and enters the transfer reference — only then is the receipt (RCTH) written and
 *      the invoice counted as paid.
 * No account → no request; no slip → not received. Part receipts are possible; the page shows received and open. A
 * receipt entered by mistake is voided the way it always was (asked with a reason, decided by the MD).
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { hasRole } from "@/lib/caps";
import { payAccounts } from "@/server/pay";
import { recordPayment } from "@/server/to";

const r2 = (n: number) => Math.round(n * 100) / 100;
type Att = { name: string; url: string; kind?: string };
const person = (code: string) => prisma.employee.findUniqueOrThrow({ where: { code } });

/** What is still to receive on an invoice, not counting requests that are under way. */
export function receivableOpen(iv: { amountDue: unknown; paidAmount: unknown; whtAmount: unknown }, requests: { status: string; cashAmount: unknown; whtAmount: unknown }[]) {
  return r2(Number(iv.amountDue) - Number(iv.paidAmount ?? 0) - Number(iv.whtAmount ?? 0) - requests.filter((q) => q.status === "REQUESTED" || q.status === "APPROVED").reduce((a, q) => a + Number(q.cashAmount) + Number(q.whtAmount), 0));
}

export async function requestReceipt(input: { invoiceNo: string; actorCode: string; account: string; cashAmount: number; whtAmount?: number; whtCertRef?: string; receivedOn: Date }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "FINANCE")) throw new Error("FINANCE_COLLECTS");
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: input.invoiceNo }, include: { receiptRequests: true, serviceOrder: { select: { entityId: true, no: true } } } });
  if (iv.cancelledAt) throw new Error(`INVOICE_CANCELLED:${iv.no}`);
  if (!input.account?.trim() || !(await payAccounts(iv.serviceOrder.entityId)).some((a) => a.id === input.account)) throw new Error("PAY_ACCOUNT_REQUIRED");
  const cash = r2(input.cashAmount ?? 0), wht = r2(input.whtAmount ?? 0);
  if (!(cash >= 0) || !(wht >= 0) || r2(cash + wht) <= 0) throw new Error("PAYMENT_NEEDS_AMOUNT");
  const open = receivableOpen(iv, iv.receiptRequests);
  if (r2(cash + wht) > open + 0.005) throw new Error(`RC_OVER:${open.toFixed(2)}`);
  const rq = await prisma.receiptRequest.create({ data: { entityId: iv.serviceOrder.entityId, invoiceId: iv.id, account: input.account, cashAmount: cash, whtAmount: wht, whtCertRef: input.whtCertRef?.trim() || null, receivedOn: input.receivedOn, requestedBy: actor.code } });
  await audit(actor.id, "RECEIPT_REQUESTED", iv.no, { order: iv.serviceOrder.no, cash, wht, account: input.account, currency: iv.currency });
  return rq;
}

/** Step 2 — the MD decides. A refusal needs a reason. */
export async function decideReceipt(input: { id: string; actorCode: string; approve: boolean; note?: string }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "MD")) throw new Error("MD_ONLY");
  const rq = await prisma.receiptRequest.findUniqueOrThrow({ where: { id: input.id }, include: { invoice: { select: { no: true } } } });
  if (rq.status !== "REQUESTED") throw new Error(`RC_NOT_WAITING:${rq.status}`);
  if (rq.requestedBy === actor.code) throw new Error("PAY_TWO_PEOPLE");
  if (!input.approve && !input.note?.trim()) throw new Error("REASON_REQUIRED");
  await audit(actor.id, input.approve ? "RECEIPT_APPROVED" : "RECEIPT_REJECTED", rq.invoice.no, { cash: Number(rq.cashAmount), wht: Number(rq.whtAmount), note: input.note });
  return prisma.receiptRequest.update({ where: { id: rq.id }, data: { status: input.approve ? "APPROVED" : "REJECTED", decidedBy: actor.code, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
}

/** Step 3 — finance confirms with the bank slip and the reference: the RCTH is written, the invoice counted. */
export async function confirmReceipt(input: { id: string; actorCode: string; bankRef: string; slip: Att[] }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "FINANCE")) throw new Error("FINANCE_COLLECTS");
  const rq = await prisma.receiptRequest.findUniqueOrThrow({ where: { id: input.id }, include: { invoice: { select: { no: true } } } });
  if (rq.status !== "APPROVED") throw new Error(rq.status === "REQUESTED" ? "RC_NEEDS_MD" : `RC_NOT_WAITING:${rq.status}`);
  if (!input.slip?.length) throw new Error("PAY_SLIP_REQUIRED");
  if (!input.bankRef?.trim()) throw new Error("PAY_REF_REQUIRED");
  const done = await recordPayment({ invoiceNo: rq.invoice.no, actorCode: actor.code, paidAt: rq.receivedOn, paidAmount: Number(rq.cashAmount), whtAmount: Number(rq.whtAmount), whtCertRef: rq.whtCertRef ?? undefined, bankRef: input.bankRef.trim(), account: rq.account, attachments: input.slip.map((a) => ({ ...a, kind: "PAYMENT_PROOF" })) }, { requestId: rq.id });
  await prisma.receiptRequest.update({ where: { id: rq.id }, data: { status: "RECEIVED", confirmedBy: actor.code, confirmedAt: new Date(), bankRef: input.bankRef.trim(), slip: input.slip as unknown as Prisma.InputJsonValue, receiptNo: done.receiptNo } });
  await audit(actor.id, "RECEIPT_CONFIRMED", rq.invoice.no, { receipt: done.receiptNo, cash: Number(rq.cashAmount), wht: Number(rq.whtAmount), settled: done.settled });
  return done;
}

/** Withdrawn by finance while it waits or is approved and not yet confirmed. */
export async function withdrawReceipt(input: { id: string; actorCode: string }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "FINANCE", "MD")) throw new Error("NO_PERMISSION");
  const rq = await prisma.receiptRequest.findUniqueOrThrow({ where: { id: input.id }, include: { invoice: { select: { no: true } } } });
  if (!["REQUESTED", "APPROVED"].includes(rq.status)) throw new Error(`RC_NOT_WAITING:${rq.status}`);
  await audit(actor.id, "RECEIPT_WITHDRAWN", rq.invoice.no, { was: rq.status });
  return prisma.receiptRequest.update({ where: { id: rq.id }, data: { status: "WITHDRAWN" } });
}
