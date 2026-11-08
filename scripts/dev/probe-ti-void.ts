/**
 * TITH void against a real database (decision 2026-11-08: anyone requests, only the MD decides):
 * issue TITH + IVTH → engineer requests void → MD rejects (nothing changes) → requests again → MD approves →
 * TITH voided (number kept), IVTH cancelled, payment on it refused, a new TITH + IVTH can be issued →
 * a TITH with payments cannot be voided.
 *   npx tsx scripts/dev/probe-ti-void.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { decideTaxInvoiceVoid, issueInvoice, issueTaxInvoice, recordPayment, requestTaxInvoiceVoid } from "../../src/server/to";
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

  console.log("4. re-issue after the void");
  const ti2 = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code, lines });
  const iv2 = await issueInvoice({ serviceOrderNo: o.no, actorCode: md.code, taxInvoiceNo: ti2.no });
  assert(ti2.no !== ti1.no && !ti2.voidedAt, `new TITH ${ti2.no} issued on the INVOICED order`);
  const size = (await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } })).taxInvoiceBookSize;
  assert(ti2.seq === ti1.seq! + 1 && ti2.bookNo === String(Math.ceil(ti2.seq! / size)).padStart(3, "0") && ti2.bookSeq === ((ti2.seq! - 1) % size) + 1, `เล่มที่ runs on: ${ti1.no} seq ${ti1.seq} book ${ti1.bookNo}/${ti1.bookSeq} → ${ti2.no} seq ${ti2.seq} book ${ti2.bookNo}/${ti2.bookSeq}; the voided one keeps its place`);
  const stillInvoiced = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  assert(stillInvoiced.status === "INVOICED", "order stays INVOICED");

  console.log("5. a TITH with payments cannot be voided");
  await recordPayment({ invoiceNo: iv2.no, actorCode: md.code, paidAt: new Date(), paidAmount: 10700, whtAmount: 0 } as never);
  await refused(() => requestTaxInvoiceVoid({ taxInvoiceNo: ti2.no, actorCode: eng.code, reason: "late change" }), /TI_HAS_PAYMENTS/, "void refused once money was received");

  console.log(`\nTI VOID PASSED — ${ti1.no} voided, ${ti2.no} re-issued`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
