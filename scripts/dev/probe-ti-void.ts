/**
 * TITH void against a real database (decision 2026-11-08: anyone requests, only the MD decides):
 * issue TITH + IVTH → engineer requests void → MD rejects (nothing changes) → requests again → MD approves →
 * TITH voided (number kept), IVTH cancelled, payment on it refused, a new TITH + IVTH can be issued →
 * a TITH with payments cannot be voided.
 *   npx tsx scripts/dev/probe-ti-void.ts
 */
import { buildCashPlan } from "../../src/server/cash-plan";
import { localIso } from "../../src/lib/dates";
import { invoiceState, outstandingOf } from "../../src/server/to";
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { decideReceiptVoid, decideTaxInvoiceVoid, issueCreditNote, issueInvoice, issueTaxInvoice, recordPayment, requestReceiptVoid, requestTaxInvoiceVoid, voidCreditNote } from "../../src/server/to";
import { createEmployee } from "../../src/server/opd";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`TI VOID FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (fn: () => Promise<unknown>, re: RegExp, m: string) => { try { await fn(); assert(false, m); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.split("\n")[0]})`); } };

async function main() {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const eng = await createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `Void Probe Eng ${stamp}`, role: "FINANCE", email: `void${stamp}@dcit.test`, password: "probe123" });
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Void Probe Co ${stamp}`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const model = await prisma.model.findFirstOrThrow();
  const vfd = await onboardAsset({ createdByEmployeeCode: md.code, type: "VFD", serialNumber: `VOID-${stamp}`, modelId: model.id, customerId: customer.id, origin: "TAKEOVER" });
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "void probe" });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ assetCode: vfd.code, description: "Repair", descriptionLocal: "ซ่อม", qty: 1, unitPrice: 10000 }] });
  await prisma.serviceOrder.update({ where: { no: o.no }, data: { status: "ACCEPTED" } }); // shortcut: the acceptance chain is covered by smoke
  const lines = [{ descriptionLocal: "ซ่อม", descriptionEn: "Repair", qty: 1, unitPrice: 10000 }];

  console.log("1. first TITH + IVTH");
  const ti1 = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code, lines });
  const iv1 = await issueInvoice({ serviceOrderNo: o.no, actorCode: md.code, taxInvoiceNo: ti1.no });
  assert(ti1.voidStatus === "NONE" && !ti1.voidedAt, `${ti1.no} valid`);
  await refused(() => issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code, lines }), /TI_EXISTS/, "a second TITH while one is valid is refused");

  console.log("2. request → MD rejects");
  await refused(() => requestTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: eng.code, reason: "  " }), /VOID_REASON_REQUIRED/, "a reason is required");
  await requestTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: eng.code, reason: "wrong branch code" });
  await refused(() => requestTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: eng.code, reason: "again" }), /TI_VOID_PENDING/, "no second request while one is pending");
  await refused(() => decideTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: eng.code, decision: "APPROVED" }), /MD_ONLY/, "only the MD decides");
  const rejected = await decideTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: md.code, decision: "REJECTED", note: "branch is right" });
  assert(rejected.voidStatus === "REJECTED" && !rejected.voidedAt, "rejected: still valid, decision noted");
  assert(!(await prisma.invoice.findUniqueOrThrow({ where: { no: iv1.no } })).cancelledAt, "IVTH untouched after a rejection");

  console.log("3. request again → MD approves");
  await requestTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: eng.code, reason: "customer name misspelt" });
  const voided = await decideTaxInvoiceVoid({ taxInvoiceNo: ti1.no, actorCode: md.code, decision: "APPROVED", note: "re-issue" });
  assert(voided.voidedAt && voided.voidStatus === "APPROVED" && voided.voidReason === "customer name misspelt", `${ti1.no} voided with the request reason`);
  const cancelled = await prisma.invoice.findUniqueOrThrow({ where: { no: iv1.no } });
  assert(cancelled.cancelledAt && /voided/.test(cancelled.cancelReason ?? ""), `${iv1.no} cancelled with the void`);
  await refused(() => recordPayment({ invoiceNo: iv1.no, actorCode: md.code, paidAt: new Date(), paidAmount: 10700, whtAmount: 0 } as never), /INVOICE_CANCELLED/, "no payment on a cancelled IVTH");
  assert((await prisma.auditLog.count({ where: { target: ti1.no, action: { in: ["TI_VOID_REQUEST", "TI_VOID_REJECT", "TI_VOID_APPROVE"] } } })) === 4, "two requests and two decisions audited");
  assert((await prisma.taxInvoice.count({ where: { no: ti1.no } })) === 1, "the voided number is kept");
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).status === "ACCEPTED", "with no live tax invoice the order is \"accepted, not invoiced\" again (P1-22)");

  console.log("4. re-issue after the void");
  const ti2 = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code, lines });
  const iv2 = await issueInvoice({ serviceOrderNo: o.no, actorCode: md.code, taxInvoiceNo: ti2.no });
  assert(ti2.no !== ti1.no && !ti2.voidedAt, `new TITH ${ti2.no} issued after the void`);
  // TEST 号段 (朱总 2026-11-15): before go-live every money document is TEST-…, on its own counter, outside the tax invoice book
  assert(!process.env.LIVE_NUMBERS && [ti1.no, iv1.no, ti2.no, iv2.no].every((n) => n.startsWith("TEST-")) && ti2.seq === null && ti2.bookNo === null, `test series: ${ti1.no}, ${iv2.no}, no page in the book`);
  assert((await prisma.docSequence.count({ where: { prefix: "TEST-TI" } })) > 0, "the TEST- counter is its own row: real TITH numbers are untouched");
  const stillInvoiced = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  assert(stillInvoiced.status === "INVOICED", "order is INVOICED again");
  assert((await prisma.invoice.count({ where: { taxInvoice: { no: ti2.no }, cancelledAt: null } })) === 1, "the tax invoice brought exactly one IVTH with it (issueInvoice afterwards answers with the same one)");

  console.log("5. receipt: void asked, MD approves → the money is owed again");
  const p1 = await recordPayment({ invoiceNo: iv2.no, actorCode: md.code, paidAt: new Date(), paidAmount: 4000, whtAmount: 0 } as never);
  // 部分收款 (需求清单 v3 P0-16): 4,000 of 10,700 received — the invoice is not "paid", 6,700 is still owed, everywhere
  const part = await prisma.invoice.findUniqueOrThrow({ where: { no: iv2.no } });
  assert(part.paidAt === null && invoiceState(part) === "PARTIAL" && outstandingOf(part) === 6700, `after 4,000: state ${invoiceState(part)}, 未收 ${outstandingOf(part)}, paidAt empty`);
  const month = localIso(part.dueAt ?? new Date())!.slice(0, 7);
  const planLine = (await buildCashPlan(o.entityId, month)).lines.find((l) => l.what === iv2.no);
  assert(planLine?.amount === 6700, `the cash plan of ${month} still expects 6,700 (${planLine?.amount})`);
  const aging = (await prisma.invoice.findMany({ where: { cancelledAt: null, paidAt: null, no: iv2.no } })).length;
  assert(aging === 1, "it is still in the receivables (paidAt empty)");
  const p2 = await recordPayment({ invoiceNo: iv2.no, actorCode: md.code, paidAt: new Date(), paidAmount: 6400, whtAmount: 300 } as never);
  assert(!!(await prisma.invoice.findUniqueOrThrow({ where: { no: iv2.no } })).paidAt, "received in full: now it is paid");
  assert(p1.receiptNo.startsWith("TEST-RCTH") && p2.settled, `two receipts ${p1.receiptNo}, ${p2.receiptNo}; settled`);
  await refused(() => recordPayment({ invoiceNo: iv2.no, actorCode: md.code, paidAt: new Date(), paidAmount: 0, whtAmount: 0 } as never), /PAYMENT_NEEDS_AMOUNT/, "a payment of nothing is refused");
  await requestReceiptVoid({ receiptNo: p2.receiptNo, actorCode: eng.code, reason: "booked on the wrong invoice" });
  await refused(() => decideReceiptVoid({ receiptNo: p2.receiptNo, actorCode: eng.code, decision: "APPROVED" }), /MD_ONLY/, "only the MD voids a receipt");
  await decideReceiptVoid({ receiptNo: p2.receiptNo, actorCode: md.code, decision: "APPROVED" });
  const afterRc = await prisma.invoice.findUniqueOrThrow({ where: { no: iv2.no } });
  assert(afterRc.paidAt === null, "and it is unpaid again");
  assert(Number(afterRc.paidAmount) === 4000 && Number(afterRc.whtAmount) === 0, `receivable back to 10,700 − 4,000 (paid ${afterRc.paidAmount}, WHT ${afterRc.whtAmount})`);
  assert(!!(await prisma.receipt.findUniqueOrThrow({ where: { no: p2.receiptNo } })).voidedAt, "the receipt number is kept, marked void");

  console.log("6. credit note lowers the receivable");
  await refused(() => issueCreditNote({ taxInvoiceNo: ti2.no, actorCode: md.code, reason: "x", subtotal: 10001 }), /CREDIT_EXCEEDS_TI/, "not more than the tax invoice");
  const cn = await issueCreditNote({ taxInvoiceNo: ti2.no, actorCode: eng.code, reason: "price corrected", subtotal: 1000 });
  const afterCn = await prisma.invoice.findUniqueOrThrow({ where: { no: iv2.no } });
  assert(cn.no.startsWith("TEST-CNTH") && Number(cn.total) === 1070 && Number(afterCn.amountDue) === 9630, `${cn.no}: 1,000 + VAT 70 → amount due 9,630`);
  await refused(() => voidCreditNote({ no: cn.no, actorCode: eng.code, reason: "x" }), /MD_ONLY/, "only the MD voids a credit note");
  await voidCreditNote({ no: cn.no, actorCode: md.code, reason: "entered twice" });
  assert(Number((await prisma.invoice.findUniqueOrThrow({ where: { no: iv2.no } })).amountDue) === 10700, "voiding the credit note puts 1,070 back");

  console.log("7. a TITH with money on it can be voided: receivable and receipts go back with it");
  await requestTaxInvoiceVoid({ taxInvoiceNo: ti2.no, actorCode: eng.code, reason: "wrong buyer" });
  await decideTaxInvoiceVoid({ taxInvoiceNo: ti2.no, actorCode: md.code, decision: "APPROVED" });
  const gone = await prisma.invoice.findUniqueOrThrow({ where: { no: iv2.no }, include: { receipts: true } });
  assert(!!gone.cancelledAt && gone.paidAmount === null && gone.receipts.every((r) => r.voidedAt), "IVTH cancelled, nothing counted as received, both receipts void");
  const ti3 = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code, lines });
  assert(!ti3.voidedAt, `a new one can be issued: ${ti3.no}`);

  console.log(`\nTI VOID PASSED — ${ti1.no} voided, ${ti2.no} re-issued`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
