/**
 * Helpers for the probes. Two rules of 2026-11-17 stand in front of what most probes want to exercise — every quote
 * line carries a cost, every PO is approved by the MD — so the probes go through these wrappers, which do that step the
 * way a person would (a cost of 0 on the lines that have none; the MD's approval) and then call the real function.
 * The rules themselves are probed in probe-dispatch-v2.ts with the real functions.
 */
import { prisma } from "../../src/lib/db";
import { setQuoteLines as realSetQuoteLines } from "../../src/server/slm-docs";
import { askPoApproval, decidePurchaseOrder, receivePurchaseOrder as realReceive } from "../../src/server/purchasing";
import { dispatchToPartner as realDispatch } from "../../src/server/srm";

export const setQuoteLines: typeof realSetQuoteLines = async (input) => {
  try {
    const r = await realSetQuoteLines(input);
    if (!r.costPending.length) return r;
    // Sales saved lines that wait for a cost (派修单 v4): the probe plays the MD who fills 0 in, then Sales saves again and the quote goes out
    const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.serviceOrderNo } });
    await prisma.quoteLine.updateMany({ where: { serviceOrderId: o.id, unitCost: null }, data: { unitCost: 0 } });
    return await realSetQuoteLines(input);
  }
  catch (e) {
    const m = /^QUOTE_(?:COST|EST)_REQUIRED:(.+)$/.exec((e as Error).message);
    if (!m) throw e;
    const missing = m[1].split("、").map(Number); // the lines a person would be asked for: the probe answers 0 (no cost on this line)
    return realSetQuoteLines({ ...input, lines: input.lines.map((l, i) => (missing.includes(i + 1) ? { ...l, unitCost: 0 } : l)) });
  }
};

export async function approvePo(no: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no } });
  if (po.approvedAt || po.status !== "DRAFT") { if (!po.approvedAt) await prisma.purchaseOrder.update({ where: { no }, data: { approvedAt: new Date(), approvedBy: "probe" } }); return; }
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  if (!po.approvalAskedAt) await askPoApproval({ no, actorCode: md.code });
  await decidePurchaseOrder({ no, actorCode: md.code, approve: true });
}
export const receivePurchaseOrder: typeof realReceive = async (input) => { await approvePo(input.poNo); return realReceive(input); };
export const dispatchToPartner: typeof realDispatch = async (input) => { await approvePo(input.poNo); return realDispatch(input); };

/** 付款三步、两人 (2026-11-17): finance asks → the MD approves → finance confirms with the slip. Returns the invoice. */
import { confirmPayment, decidePayment, requestPayment } from "../../src/server/pay";
export async function payInvoice(input: { id: string; actorCode: string; paymentRef?: string; amount?: number }) {
  const p = await requestPayment({ invoiceId: input.id, actorCode: input.actorCode, account: "CASH", amount: input.amount });
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  await decidePayment({ id: p.id, actorCode: md.code, approve: true });
  await confirmPayment({ id: p.id, actorCode: input.actorCode, paymentRef: input.paymentRef ?? "probe-ref", slip: [{ name: "slip.jpg", url: "/uploads/probe-slip.jpg" }] });
  return prisma.supplierInvoice.findUniqueOrThrow({ where: { id: input.id } });
}


/** 收款三步、两人 (2026-11-18): finance asks → the MD approves → finance confirms with the slip. Same call shape as the old one-step recordPayment. */
import { confirmReceipt, decideReceipt, requestReceipt } from "../../src/server/collect";
import { hasRole } from "../../src/lib/caps";
export async function recordPayment(input: { invoiceNo: string; actorCode: string; paidAt?: Date | string; paidAmount: number; whtAmount?: number; whtCertRef?: string; bankRef?: string; account?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: input.invoiceNo }, include: { serviceOrder: { select: { entityId: true } } } });
  // the people of the three steps: whoever may not collect is refused as themselves; the MD's and finance's calls are played by a finance person and the MD
  const fin = hasRole(actor, "MD", "FINANCE") ? (hasRole(actor, "FINANCE") && !hasRole(actor, "MD") ? actor : await prisma.employee.findFirst({ where: { active: true, entityId: iv.serviceOrder.entityId, OR: [{ role: "FINANCE" }, { extraRoles: { has: "FINANCE" } }], NOT: { role: "MD" } } })
    ?? await prisma.employee.create({ data: { code: `ETH98${String(Date.now()).slice(-5)}`, name: "TEST probe finance", role: "FINANCE", entityId: iv.serviceOrder.entityId, email: `probe-fin-${Date.now()}@dcit.test`, passwordHash: "x", active: true } as never })) : actor;
  const rq = await requestReceipt({ invoiceNo: input.invoiceNo, actorCode: fin.code, account: input.account ?? "CASH", cashAmount: input.paidAmount, whtAmount: input.whtAmount, whtCertRef: input.whtCertRef, receivedOn: input.paidAt ? new Date(input.paidAt) : new Date() });
  await decideReceipt({ id: rq.id, actorCode: md.code, approve: true });
  return confirmReceipt({ id: rq.id, actorCode: fin.code, bankRef: input.bankRef ?? "probe-ref", slip: [{ name: "slip.jpg", url: "/uploads/probe-slip.jpg" }] });
}

/** 开票前成本认可 (2026-11-18): the probes recognise the cost as the MD, then issue. */
import { issueTaxInvoice as issueTaxInvoice0 } from "../../src/server/to";
import { confirmOrderCost } from "../../src/server/job-cost";
export async function issueTaxInvoice(input: Parameters<typeof issueTaxInvoice0>[0]) {
  await confirmOrderCost({ no: input.serviceOrderNo, actorCode: "ETH2611001" }).catch(() => undefined);
  return issueTaxInvoice0(input);
}
