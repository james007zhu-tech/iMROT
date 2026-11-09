/**
 * 客户拒绝报价 end to end against a real database (朱总 2026-11-09, mockup docs/mockups/quote-decline-v0.1.html):
 * ERTH intake → INTH → quote → plain cancel refused → decline needs the reply, a fee or a waiver reason → DECLINED and
 * locked, machine status untouched → undo and decline again → close refused → return DNTH (machine unrepaired +
 * accessories, no PO lines) → fee TITH (one line per machine) → IVTH → payment → close. Waived on-site order closes at once.
 * Trade quotes are cancelled, not declined. Renders the DNTH and TITH and checks what they say.
 *   npx tsx scripts/dev/probe-decline.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { advanceServiceOrder, createServiceOrder } from "../../src/server/slm";
import { createInspection, receiveEquipment, setQuoteLines } from "../../src/server/slm-docs";
import { declineQuote, undoDecline } from "../../src/server/decline";
import { deliveryPlan, issueDelivery, signDelivery } from "../../src/server/delivery";
import { issueInvoice, issueTaxInvoice, recordPayment } from "../../src/server/to";
import { buildFields, renderDocument } from "../../src/server/reports";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`DECLINE FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (fn: () => Promise<unknown>, re: RegExp, m: string) => { try { await fn(); assert(false, m); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.split("\n")[0]})`); } };
const reply = [{ name: "line-reply.png", url: "/uploads/decline/line-reply.png" }];

async function main() {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Decline Tyre Co ${stamp}`, nameLocal: `บริษัท ทดสอบ ${stamp} จำกัด`, taxId: `01088${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const plant = await prisma.plant.create({ data: { customerId: customer.id, code: "P1", name: "Plant 1" } });
  const contact = await prisma.contact.create({ data: { customerId: customer.id, plantId: plant.id, name: "Khun Somchai" } });
  const model = await prisma.model.findFirstOrThrow();
  const vfd = await onboardAsset({ createdByEmployeeCode: md.code, type: "VFD", serialNumber: `DCL-${stamp}`, modelId: model.id, customerId: customer.id, plantId: plant.id, origin: "TAKEOVER" });

  console.log("1. repair order: ERTH intake, INTH, quote sent");
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, plantId: plant.id, assetCodes: [vfd.code], mode: "REPAIR", reportedSymptom: "F30001 overcurrent" });
  await advanceServiceOrder(o.no, "ASSIGNED", md.code, undefined, md.code);
  await receiveEquipment({ serviceOrderNo: o.no, assetCode: vfd.code, actorCode: md.code, sender: "customer truck", accessories: "BOP-2 panel × 1\nPower cable × 1\nManual × 1" });
  await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: md.code, findings: "IGBT short", probableCause: "IGBT module failed" });
  await advanceServiceOrder(o.no, "DIAGNOSING", md.code);
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ assetCode: vfd.code, description: "Replace IGBT module and test", descriptionLocal: "เปลี่ยนโมดูล IGBT และทดสอบ", qty: 1, unitPrice: 38500 }] });
  await advanceServiceOrder(o.no, "QUOTE_PENDING", md.code);
  const statusBefore = (await prisma.asset.findUniqueOrThrow({ where: { id: vfd.id } })).status;

  console.log("2. a quote for machines is declined, not cancelled; the form needs the reply and a fee or a waiver reason");
  await refused(() => advanceServiceOrder(o.no, "CANCELLED", md.code), /USE_DECLINE/, "plain cancel of a machine quote refused");
  await refused(() => advanceServiceOrder(o.no, "DECLINED", md.code), /USE_DECLINE/, "DECLINED only through the decline form");
  const base = { no: o.no, actorCode: md.code, reason: "PRICE", note: "over budget, buying new", contactId: contact.id, waived: false, fees: [{ assetCode: vfd.code, amount: 1500 }], attachments: reply };
  await refused(() => declineQuote({ ...base, attachments: [] }), /DECLINE_REPLY_REQUIRED/, "no customer reply → refused");
  await refused(() => declineQuote({ ...base, fees: [] }), /FEE_REQUIRED/, "charged but no fee → refused");
  await refused(() => declineQuote({ ...base, waived: true, fees: [] }), /FEE_WAIVE_REASON_REQUIRED/, "waived without a reason → refused");

  console.log("3. declined: locked, inquiry-free, machine status untouched; undo and decline again");
  await declineQuote(base);
  let so = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no }, include: { decline: true } });
  const a1 = await prisma.asset.findUniqueOrThrow({ where: { id: vfd.id } });
  assert(so.status === "DECLINED" && so.lockedAt && so.decline?.reason === "PRICE", "order DECLINED and locked");
  assert(((so.attachments as { kind: string }[] | null) ?? []).some((x) => x.kind === "DECLINE"), "customer reply kept as DECLINE");
  assert(a1.status === statusBefore, `machine status untouched (${a1.status}) — 11-08 decision`);
  assert(await prisma.assetEvent.count({ where: { assetId: vfd.id, type: "QUOTE_DECLINED" } }) === 1, "QUOTE_DECLINED on the machine's timeline");
  await refused(() => setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ assetCode: vfd.code, description: "cheaper", qty: 1, unitPrice: 30000 }] }), /ORDER_LOCKED/, "no re-pricing after the decline");
  await refused(() => advanceServiceOrder(o.no, "QUOTE_PENDING", md.code), /USE_UNDO_DECLINE/, "back only through undo");
  await undoDecline({ no: o.no, actorCode: md.code });
  so = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no }, include: { decline: true } });
  assert(so.status === "QUOTE_PENDING" && !so.lockedAt && !so.decline, "undo: back to 待确认报价, unlocked");
  await declineQuote(base);

  console.log("4. close refused until the machine is back and the fee invoiced");
  await refused(() => advanceServiceOrder(o.no, "CLOSED", md.code), /DECLINE_OPEN:RETURN_DNTH,FEE_TITH/, "close blocked: return + fee");
  const plan = await deliveryPlan(o.no);
  assert(!plan.lines.some((l) => l.kind === "PO"), "no PO lines on a declined order");
  assert(plan.lines.filter((l) => l.kind === "MACHINE").length === 1 && plan.lines.filter((l) => l.kind === "RETURN").length === 3, "plan: the machine + 3 accessories");
  const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), contactId: contact.id, delivered: Object.fromEntries(plan.lines.map((l) => [l.key, l.expected - l.deliveredBefore])) });
  assert(dn.remark?.includes("Returned unrepaired"), "DNTH remark says returned unrepaired");
  await refused(() => undoDecline({ no: o.no, actorCode: md.code }), /DECLINE_DOCS_ISSUED/, "no undo once the DNTH is out");
  await signDelivery({ no: dn.no, actorCode: md.code, signedBy: "Khun Somchai" });
  await refused(() => advanceServiceOrder(o.no, "CLOSED", md.code), /DECLINE_OPEN:FEE_TITH/, "close still blocked: fee");

  console.log("5. fee TITH → IVTH → payment → close");
  const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code });
  const tl = ti.lines as { descriptionLocal: string; descriptionEn?: string; qty: number; unitPrice: number }[];
  assert(tl.length === 1 && tl[0].unitPrice === 1500 && tl[0].descriptionLocal.startsWith("ค่าตรวจเช็ค") && tl[0].descriptionLocal.includes(vfd.serialNumber), "one fee line, Thai first, names the machine");
  assert(Number(ti.total) === 1605, `1,500 + VAT 7 % = ${Number(ti.total)}`);
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).status === "INVOICED", "order INVOICED");
  const iv = await issueInvoice({ serviceOrderNo: o.no, actorCode: md.code, taxInvoiceNo: ti.no });
  await recordPayment({ invoiceNo: iv.no, actorCode: md.code, paidAmount: 1605, paidAt: new Date(), bankRef: `KB-${stamp}` } as never);
  await advanceServiceOrder(o.no, "CLOSED", md.code);
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).status === "CLOSED", "closed");

  console.log("6. printed: DNTH says unrepaired, TITH carries the fee");
  const dnFields = await buildFields(dn.no);
  assert(String(dnFields.values.ACK_EN).includes("returned unrepaired") && String(dnFields.values.REMARKS).includes("ส่งคืนโดยไม่ได้ซ่อม"), "DNTH receipt wording and remark");
  assert((dnFields.values.L_DESC as string[]).some((x) => x.includes("Returned unrepaired")) && (dnFields.values.L_R_ITEM as string[]).length === 3, "machine line + 3 accessories returned");
  for (const no of [dn.no, ti.no]) {
    const r = await renderDocument(no);
    assert(!r.unfilled.length, `${no} renders with every field filled`);
    await r.cleanup();
  }

  console.log("7. waived, inspected on site: closes at once; trade quotes are cancelled");
  const o2 = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [vfd.code], mode: "REPAIR", reportedSymptom: "noise" });
  await advanceServiceOrder(o2.no, "ASSIGNED", md.code, undefined, md.code);
  await advanceServiceOrder(o2.no, "DIAGNOSING", md.code);
  await setQuoteLines({ serviceOrderNo: o2.no, actorCode: md.code, lines: [{ assetCode: vfd.code, description: "Bearing", qty: 1, unitPrice: 9000 }] });
  await advanceServiceOrder(o2.no, "QUOTE_PENDING", md.code);
  await declineQuote({ ...base, no: o2.no, reason: "SELF", waived: true, waivedReason: "long-standing customer", fees: [] });
  await refused(() => issueTaxInvoice({ serviceOrderNo: o2.no, actorCode: md.code }), /FEE_WAIVED/, "nothing to invoice when waived");
  await advanceServiceOrder(o2.no, "CLOSED", md.code);
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o2.no } })).status === "CLOSED", "waived + on site → closed directly");
  const t = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "DOMESTIC_TRADE", requestLines: [{ description: "Fan", qty: 1, unit: "pcs" }] } as never);
  await refused(() => declineQuote({ ...base, no: t.no }), /TRADE_QUOTE_CANCEL/, "trade quote: cancel, not decline");

  console.log(`DECLINE PASSED — ${o.no} · ${dn.no} · ${ti.no} · ${o2.no}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
