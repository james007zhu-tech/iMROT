/**
 * Flow probes beyond the smoke test: where does the repair closed loop break or let something through
 * that the 维修业务闭环 diagram forbids? Prints PASS / GAP per probe; never throws. npx tsx scripts/dev/probe-flow.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder, advanceServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { createInspection, setQuoteLines, createRepairJob, recordAcceptance, receiveEquipment } from "../../src/server/slm-docs";
import { recordStockDoc } from "../../src/server/scm";
import { deliveryPlan, issueDelivery, signDelivery } from "../../src/server/delivery";
import { issueTaxInvoice, issueInvoice, recordPayment } from "../../src/server/to";
import { allocateNumber } from "../../src/lib/numbering-db";

const out: { probe: string; result: "PASS" | "GAP"; note: string }[] = [];
const pass = (p: string, n: string) => out.push({ probe: p, result: "PASS", note: n });
const gap = (p: string, n: string) => out.push({ probe: p, result: "GAP", note: n });
const errMsg = (e: unknown) => (e as Error).message.split("\n")[0].slice(0, 160);

async function main() {
  const admin = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: admin.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: "Probe Tyre Co.", taxId: "0105566666666", branchCode: "00000", paymentTermDays: 30 } });
  });
  const plant = await prisma.plant.create({ data: { customerId: customer.id, code: "P1", name: "Plant 1" } });
  const contact = await prisma.contact.create({ data: { customerId: customer.id, plantId: plant.id, name: "Khun Probe" } });
  const model = await prisma.model.findFirstOrThrow();
  const part = await prisma.part.upsert({ where: { sku: "PRB-FAN" }, update: {}, create: { sku: "PRB-FAN", vendorPartNo: "PRB-FAN", name: "Probe fan" } });
  await recordStockDoc({ actorCode: admin.code, direction: "IN", lines: [{ partSku: part.sku, qty: 10, unitCost: 1000 }] });
  const vfd = await onboardAsset({ createdByEmployeeCode: admin.code, type: "VFD", serialNumber: `PRB-${Date.now()}`, modelId: model.id, customerId: customer.id, plantId: plant.id, origin: "TAKEOVER" });

  // ── Probe 1: inspect + quote on an order that was never assigned ──
  {
    const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "trips F30001" });
    try {
      await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "fan dead" });
      await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, partSku: part.sku, description: "Fan", qty: 1, unitPrice: 3000 }] });
      const s = (await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).status;
      s === "QUOTE_PENDING" ? pass("P1 unassigned order can be inspected and quoted", `status ${s}`) : gap("P1 unassigned order: inspect+quote leaves status", `${s} (expected QUOTE_PENDING)`);
    } catch (e) { gap("P1 unassigned order: inspect/quote throws", errMsg(e)); }
  }

  // ── Probe 2: margin — quote below cost is accepted silently? ──
  {
    const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "noise" });
    await advanceServiceOrder(o.no, "ASSIGNED", admin.code, undefined, admin.code);
    await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "bearing" });
    await advanceServiceOrder(o.no, "DIAGNOSING", admin.code);
    try {
      await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, partSku: part.sku, description: "Fan at a loss", qty: 1, unitPrice: 900 }] });
      const so = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
      so.marginApproval === "PENDING" ? pass("P2 quote below the 50% floor waits for the MD", `margin ${so.marginPct}, ${so.marginApproval}`) : gap("P2 quote below cost (price 900 < cost 1000) saved without margin check", `marginApproval ${so.marginApproval}`);
      try { await confirmCustomerPo({ no: o.no, actorCode: admin.code, poLines: await poLinesFromQuote(o.no) }); gap("P2b customer PO accepted while margin approval pending", ""); }
      catch (e) { pass("P2b customer PO blocked until the MD approves", errMsg(e)); }
    } catch (e) { pass("P2 quote below cost rejected", errMsg(e)); }
  }

  // ── Probe 3: full run, then try to edit after acceptance ──
  {
    const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "overheat" });
    await advanceServiceOrder(o.no, "ASSIGNED", admin.code, undefined, admin.code);
    await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "fan" });
    await advanceServiceOrder(o.no, "DIAGNOSING", admin.code);
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, partSku: part.sku, description: "Fan", descriptionLocal: "พัดลม", qty: 1, unitPrice: 3000 }, { assetCode: vfd.code, description: "Labour", descriptionLocal: "ค่าแรง", qty: 1, unitPrice: 2000 }] });
    await advanceServiceOrder(o.no, "QUOTE_PENDING", admin.code);
    await confirmCustomerPo({ no: o.no, actorCode: admin.code, customerRef: "PO-PRB-1", poLines: await poLinesFromQuote(o.no) });
    await receiveEquipment({ serviceOrderNo: o.no, assetCode: vfd.code, actorCode: admin.code, sender: "truck" });
    await recordStockDoc({ actorCode: admin.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: part.sku, qty: 1, assetCode: vfd.code }] });
    await createRepairJob({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "WORKSHOP", confirmedFault: "fan", workPerformed: "replaced", finishedAt: new Date(), tests: [{ test: "run", criterion: "ok", result: "ok", pass: true }] });
    const plan = await deliveryPlan(o.no);
    const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: admin.code, deliverOn: new Date(), delivered: Object.fromEntries(plan.lines.map((l) => [l.key, l.expected - l.deliveredBefore])) } as never);
    await signDelivery({ no: dn.no, actorCode: admin.code, signedBy: "Khun Probe" });
    await recordAcceptance({ serviceOrderNo: o.no, actorCode: admin.code, status: "ACCEPTED", deliverables: [{ deliverable: "runs", criterion: "ok", result: "ok" }], customerContactId: contact.id });

    try {
      await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, description: "Extra after acceptance", descriptionLocal: "เพิ่มหลังตรวจรับ", qty: 1, unitPrice: 99999 }] });
      gap("P3a quote lines editable after acceptance", "price not locked");
    } catch (e) { pass("P3a quote locked after acceptance", errMsg(e)); }
    try {
      await recordStockDoc({ actorCode: admin.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: part.sku, qty: 1, assetCode: vfd.code }] });
      gap("P3b stock issue (OBTH) still allowed after acceptance", "cost not locked");
    } catch (e) { pass("P3b stock issue blocked after acceptance", errMsg(e)); }

    const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: admin.code, issuedAt: new Date() } as never);
    const iv = await issueInvoice({ serviceOrderNo: o.no, actorCode: admin.code, taxInvoiceNo: ti.no, issuedAt: new Date() } as never);
    try {
      await recordPayment({ invoiceNo: iv.no, actorCode: admin.code, paidAmount: 1000, paidAt: new Date(), bankRef: "KBANK-1" } as never);
      const inv = await prisma.invoice.findUniqueOrThrow({ where: { no: iv.no } });
      const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
      Number(inv.paidAmount) < Number(inv.amountDue) && order.status === "CLOSED"
        ? gap("P3c partial payment closes the order", `paid ${inv.paidAmount} of ${inv.amountDue}, order ${order.status}`)
        : pass("P3c partial payment keeps the order open", `paid ${inv.paidAmount} of ${inv.amountDue}, order ${order.status}`);
      try {
        await recordPayment({ invoiceNo: iv.no, actorCode: admin.code, paidAmount: 4350, paidAt: new Date(), bankRef: "KBANK-2" } as never);
        const inv2 = await prisma.invoice.findUniqueOrThrow({ where: { no: iv.no } });
        Number(inv2.paidAmount) === 5350 ? pass("P3d second payment accumulates", `paidAmount ${inv2.paidAmount}`) : gap("P3d second payment overwrites the first", `paidAmount ${inv2.paidAmount} (expected 5350)`);
      } catch (e) { gap("P3d second payment on the same invoice throws", errMsg(e)); }
    } catch (e) { gap("P3c payment throws", errMsg(e)); }
    const proof = await prisma.invoice.findUniqueOrThrow({ where: { no: iv.no } });
    "attachments" in proof ? pass("P3e payment proof can be archived on the invoice", "") : gap("P3e no place to archive the customer's payment proof", "Invoice has no attachments field");
  }

  // ── Probe 4: rejected acceptance → back to repair? ──
  {
    const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "again" });
    await advanceServiceOrder(o.no, "ASSIGNED", admin.code, undefined, admin.code);
    await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "x" });
    await advanceServiceOrder(o.no, "DIAGNOSING", admin.code);
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, description: "Labour", qty: 1, unitPrice: 1000 }] });
    await advanceServiceOrder(o.no, "QUOTE_PENDING", admin.code);
    await confirmCustomerPo({ no: o.no, actorCode: admin.code, poLines: await poLinesFromQuote(o.no) });
    await createRepairJob({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "SITE", confirmedFault: "x", workPerformed: "y", finishedAt: new Date() });
    try {
      await recordAcceptance({ serviceOrderNo: o.no, actorCode: admin.code, status: "REJECTED", deliverables: [{ deliverable: "runs", criterion: "ok", result: "fails" }], punchList: "still trips" });
      const s = (await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).status;
      pass("P4 rejected acceptance routes order to", s);
      try {
        await createRepairJob({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "SITE", confirmedFault: "x2", workPerformed: "rework", finishedAt: new Date() });
        pass("P4b rework RPTH allowed after rejection", "");
      } catch (e) { gap("P4b rework RPTH blocked after rejection", errMsg(e)); }
    } catch (e) { gap("P4 rejected acceptance throws", errMsg(e)); }
  }

  // ── Probe 5: customer declines the quote → end ──
  {
    const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "decline" });
    await advanceServiceOrder(o.no, "ASSIGNED", admin.code, undefined, admin.code);
    await advanceServiceOrder(o.no, "DIAGNOSING", admin.code);
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, description: "Labour", qty: 1, unitPrice: 1000 }] });
    await advanceServiceOrder(o.no, "QUOTE_PENDING", admin.code);
    try {
      await advanceServiceOrder(o.no, "CANCELLED", admin.code, "customer declined");
      const a = await prisma.asset.findUniqueOrThrow({ where: { code: vfd.code } });
      a.status === "IN_SERVICE" || a.status === "ONBOARDED" ? pass("P5 declined quote cancels order and asset status is", a.status) : gap("P5 declined quote: asset left in", a.status);
    } catch (e) { gap("P5 cannot cancel from QUOTE_PENDING", errMsg(e)); }
  }

  // ── Probe 6: acceptance with missing documents (no INTH, no RPTH) ──
  {
    const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "skip" });
    await advanceServiceOrder(o.no, "ASSIGNED", admin.code, undefined, admin.code);
    await advanceServiceOrder(o.no, "DIAGNOSING", admin.code);
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, description: "Labour", qty: 1, unitPrice: 1000 }] });
    await advanceServiceOrder(o.no, "QUOTE_PENDING", admin.code);
    await confirmCustomerPo({ no: o.no, actorCode: admin.code, poLines: await poLinesFromQuote(o.no) });
    try {
      await advanceServiceOrder(o.no, "ACCEPTANCE_PENDING", admin.code);
      await recordAcceptance({ serviceOrderNo: o.no, actorCode: admin.code, status: "ACCEPTED", deliverables: [{ deliverable: "runs", criterion: "ok", result: "ok" }] });
      gap("P6 acceptance recorded with no INTH and no RPTH", "no document-completeness check");
    } catch (e) { pass("P6 acceptance blocked without INTH/RPTH", errMsg(e)); }
  }

  console.log("\n=== FLOW PROBES ===");
  for (const r of out) console.log(`${r.result.padEnd(4)} ${r.probe}${r.note ? " — " + r.note : ""}`);
  console.log(`\n${out.filter((r) => r.result === "GAP").length} gaps / ${out.length} probes`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
