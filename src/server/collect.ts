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
import { bocFor, fxDiff, FX_MD_THRESHOLD } from "@/server/fx";
import { recordPayment } from "@/server/to";

const r2 = (n: number) => Math.round(n * 100) / 100;
type Att = { name: string; url: string; kind?: string };
const person = (code: string) => prisma.employee.findUniqueOrThrow({ where: { code } });

/** What is still to receive on an invoice, not counting requests that are under way. */
export function receivableOpen(iv: { amountDue: unknown; paidAmount: unknown; whtAmount: unknown }, requests: { status: string; cashAmount: unknown; whtAmount: unknown }[]) {
  return r2(Number(iv.amountDue) - Number(iv.paidAmount ?? 0) - Number(iv.whtAmount ?? 0) - requests.filter((q) => q.status === "REQUESTED" || q.status === "APPROVED").reduce((a, q) => a + Number(q.cashAmount) + Number(q.whtAmount), 0));
}

export type RcFx = { ccy: string; rate: number; boc: number | null; bocDate: string | null; diffPct: number; manual: boolean; reason?: string; by?: string; at?: string; pending?: boolean; decidedBy?: string; decidedAt?: string };
export async function requestReceipt(input: { invoiceNo: string; actorCode: string; account: string; cashAmount: number; whtAmount?: number; whtCertRef?: string; receivedOn: Date; fxRate?: number; fxReason?: string }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "FINANCE")) throw new Error("FINANCE_COLLECTS");
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: input.invoiceNo }, include: { receiptRequests: true, serviceOrder: { select: { entityId: true, no: true } } } });
  if (iv.cancelledAt) throw new Error(`INVOICE_CANCELLED:${iv.no}`);
  if (!input.account?.trim() || !(await payAccounts(iv.serviceOrder.entityId)).some((a) => a.id === input.account)) throw new Error("PAY_ACCOUNT_REQUIRED");
  const cash = r2(input.cashAmount ?? 0), wht = r2(input.whtAmount ?? 0);
  if (!(cash >= 0) || !(wht >= 0) || r2(cash + wht) <= 0) throw new Error("PAYMENT_NEEDS_AMOUNT");
  const open = receivableOpen(iv, iv.receiptRequests);
  if (r2(cash + wht) > open + 0.005) throw new Error(`RC_OVER:${open.toFixed(2)}`);
  // 收款汇率 (v5 P1-2): an invoice not in CNY is received at the Bank of China rate of the day of receipt (the last one
  // published before a day without one). Finance may write its own with a reason; more than 2 % off waits for the MD
  // — a decision of its own, before the receipt itself can be approved and confirmed.
  let fx: RcFx | null = null;
  if (iv.currency !== "CNY") {
    const boc = await bocFor(iv.currency, input.receivedOn);
    const rate = input.fxRate && input.fxRate > 0 ? input.fxRate : boc?.rate;
    if (rate) {
      const manual = !boc || Math.abs(rate - boc.rate) > 1e-9;
      if (manual && !input.fxReason?.trim()) throw new Error("FX_REASON_REQUIRED");
      const diff = fxDiff(rate, boc?.rate);
      fx = { ccy: iv.currency, rate, boc: boc?.rate ?? null, bocDate: boc?.date ?? null, diffPct: Math.round(diff * 10000) / 100, manual, ...(manual ? { reason: input.fxReason!.trim(), by: actor.code, at: new Date().toISOString(), pending: diff > FX_MD_THRESHOLD + 1e-9 } : {}) };
    }
  }
  const rq = await prisma.receiptRequest.create({ data: { entityId: iv.serviceOrder.entityId, invoiceId: iv.id, account: input.account, cashAmount: cash, whtAmount: wht, whtCertRef: input.whtCertRef?.trim() || null, receivedOn: input.receivedOn, requestedBy: actor.code, ...(fx ? { fx: fx as unknown as Prisma.InputJsonValue } : {}) } });
  await audit(actor.id, "RECEIPT_REQUESTED", iv.no, { order: iv.serviceOrder.no, cash, wht, account: input.account, currency: iv.currency, ...(fx?.manual ? { fx } : {}) });
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
  if (input.approve && (rq.fx as RcFx | null)?.pending) throw new Error("RC_FX_WAITS_MD"); // the rate is decided first, as a step of its own
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

/**
 * 历史收据补「入账账户」 (派修单 v5 P0-1). Receipts written before the account was a list carry a hand-written text. Finance
 * (or the MD) says, receipt by receipt, which of our accounts it was. Only the internal account field changes — not the
 * number, the amount or the PDF already issued — and only once: a receipt that has one of our accounts is not touched
 * here (that would be a correction, which goes through void and re-issue).
 */
export async function setReceiptAccount(input: { receiptNo: string; actorCode: string; account: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (!hasRole(actor, "FINANCE", "MD")) throw new Error("FINANCE_COLLECTS");
  const rc = await prisma.receipt.findUniqueOrThrow({ where: { no: input.receiptNo }, select: { id: true, no: true, account: true, invoice: { select: { serviceOrder: { select: { entityId: true } } } } } });
  const known = new Set((await payAccounts(rc.invoice.serviceOrder.entityId)).map((a) => a.id));
  if (!known.has(input.account)) throw new Error("PAY_ACCOUNT_REQUIRED");
  if (rc.account && known.has(rc.account)) throw new Error("RC_ACCOUNT_KNOWN");
  await prisma.receipt.update({ where: { id: rc.id }, data: { account: input.account } });
  await audit(actor.id, "RECEIPT_ACCOUNT_SET", rc.no, { was: rc.account ?? null, account: input.account });
}

/** 收款汇率待 MD 批准 (v5 P1-2): the MD decides on the rate alone — before, and apart from, approving the receipt. Refused → the request is refused with it. */
export async function decideReceiptRate(input: { id: string; actorCode: string; approve: boolean; note?: string }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "MD")) throw new Error("MD_ONLY");
  const rq = await prisma.receiptRequest.findUniqueOrThrow({ where: { id: input.id }, include: { invoice: { select: { no: true } } } });
  const fx = rq.fx as RcFx | null;
  if (rq.status !== "REQUESTED" || !fx?.pending) throw new Error("FX_NOT_WAITING");
  if (!input.approve && !input.note?.trim()) throw new Error("REASON_REQUIRED");
  const next: RcFx = { ...fx, pending: false, decidedBy: actor.code, decidedAt: new Date().toISOString() };
  await prisma.receiptRequest.update({ where: { id: rq.id }, data: input.approve ? { fx: next as unknown as Prisma.InputJsonValue } : { fx: next as unknown as Prisma.InputJsonValue, status: "REJECTED", decidedBy: actor.code, decidedAt: new Date(), decisionNote: `${input.note!.trim()}` } });
  await audit(actor.id, input.approve ? "FX_RECEIPT_APPROVED" : "FX_RECEIPT_REJECTED", rq.invoice.no, { rate: fx.rate, boc: fx.boc, diffPct: fx.diffPct, askedBy: fx.by, note: input.note?.trim() || null });
}
