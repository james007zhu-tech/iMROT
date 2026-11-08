/**
 * Purchasing chain against a real database: PRTH from an order's short parts → two supplier quotes → selection
 * writes costs into the QTTH (margin) → customer PO raises the POTH → IBTH receipt closes the PO.
 *   npx tsx scripts/dev/probe-purchasing.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote, approveMargin } from "../../src/server/slm";
import { createInspection, setQuoteLines } from "../../src/server/slm-docs";
import { createSupplier, createInquiry, inquiryLinesFromOrder, addSupplierQuote, selectSupplierQuote, receivePurchaseOrder } from "../../src/server/purchasing";
import { allocateNumber } from "../../src/lib/numbering-db";
import { parseNumber } from "../../src/lib/numbering";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`PURCHASING FAIL: ${m}`); console.log("  ok  " + m); };

async function main() {
  const admin = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: admin.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: "Purchasing Probe Co.", taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const model = await prisma.model.findFirstOrThrow();
  const vfd = await onboardAsset({ createdByEmployeeCode: admin.code, type: "VFD", serialNumber: `PUR-${Date.now()}`, modelId: model.id, customerId: customer.id, origin: "TAKEOVER" });
  const sku = `MIT-QY82P-${Date.now().toString().slice(-5)}`;
  const part = await prisma.part.create({ data: { sku, vendorPartNo: "QY82P", name: "Mitsubishi QY82P output module" } }); // nothing in stock

  const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "output module dead" });
  await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "QY82P output module failed" });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, partSku: sku, description: "QY82P output module", descriptionLocal: "โมดูลเอาต์พุต QY82P", qty: 1, unitPrice: 20000 }, { assetCode: vfd.code, description: "Labour", descriptionLocal: "ค่าแรง", qty: 2, unitPrice: 1500, unit: "h" }] });

  console.log("1. PRTH from the order's short parts");
  const short = await inquiryLinesFromOrder(o.no);
  assert(short.length === 1 && short[0].partSku === sku && short[0].qty === 1, `one short line: ${sku} × 1`);
  const inq = await createInquiry({ actorCode: admin.code, serviceOrderNo: o.no, lines: short, note: "urgent" });
  assert(parseNumber(inq.no)?.prefix === "PR", `inquiry ${inq.no}`);
  assert((await prisma.document.count({ where: { no: inq.no, type: "PR" } })) === 1, "PRTH registered in Document");

  console.log("2. two supplier quotes, pick the cheaper");
  const s1 = await createSupplier({ actorCode: admin.code, name: "Mitsubishi Electric Factory Automation (Thailand)", taxId: `010${Date.now().toString().slice(-10)}`, currency: "THB" });
  assert(parseNumber(s1.code)?.prefix === "S", `supplier code ${s1.code}`);
  const s2 = await createSupplier({ actorCode: admin.code, name: "FA Parts Bangkok", currency: "THB" });
  await addSupplierQuote({ inquiryNo: inq.no, actorCode: admin.code, supplierId: s1.id, quoteNo: "FA26101674", currency: "THB", vatRate: 0.07, lines: [{ lineNo: 1, vendorPartNo: "QY82P", qty: 1, unitPrice: 8770 }] });
  const q2 = await addSupplierQuote({ inquiryNo: inq.no, actorCode: admin.code, supplierId: s2.id, quoteNo: "FAP-2211", currency: "THB", vatRate: 0.07, leadTimeDays: 3, lines: [{ lineNo: 1, vendorPartNo: "QY82P", qty: 1, unitPrice: 8200 }] });
  assert(Number(q2.subtotal) === 8200 && Number(q2.total) === 8774, `quote totals ${q2.subtotal} / ${q2.total}`);
  await selectSupplierQuote({ inquiryNo: inq.no, quoteId: q2.id, actorCode: admin.code });
  const after = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no }, include: { lines: true } });
  const costLine = after.lines.find((l) => l.partId === part.id)!;
  assert(Number(costLine.unitCost) === 8200, "selected quote price became the quote line's cost");
  assert(Number(after.costTotal) === 8200 && Math.abs(Number(after.marginPct) - (23000 - 8200) / 23000) < 1e-4, `margin recomputed: cost ${after.costTotal}, ${(Number(after.marginPct) * 100).toFixed(1)}%`);
  assert(after.marginApproval === "NOT_NEEDED", "margin above the floor needs no approval");
  assert((await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: inq.no } })).status === "COMPARED", "inquiry COMPARED");

  console.log("3. customer PO raises the POTH");
  await confirmCustomerPo({ no: o.no, actorCode: admin.code, customerRef: "PO-PUR-1", poLines: await poLinesFromQuote(o.no) });
  const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { serviceOrder: { no: o.no } }, include: { supplier: true } });
  assert(parseNumber(po.no)?.prefix === "PO" && po.supplier.id === s2.id && po.status === "DRAFT", `POTH ${po.no} drafted to the selected supplier`);
  assert(Number(po.subtotal) === 8200 && Number(po.vatAmount) === 574 && Number(po.total) === 8774, `POTH totals ${po.subtotal} + VAT ${po.vatAmount} = ${po.total}`);
  assert((await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: inq.no } })).status === "ORDERED", "inquiry ORDERED");

  console.log("4. goods arrive: IBTH against the POTH");
  const r = await receivePurchaseOrder({ poNo: po.no, actorCode: admin.code, supplierRef: "INV-FAP-9001", received: [{ lineNo: 1, qty: 1 }] });
  assert(parseNumber(r.ibthNo)?.prefix === "IB" && r.status === "RECEIVED", `IBTH ${r.ibthNo}, PO ${r.status}`);
  const mv = await prisma.stockMovement.findFirstOrThrow({ where: { no: r.ibthNo } });
  assert(mv.purchaseOrderId === po.id && Number(mv.unitCost) === 8200 && mv.supplierRef === "INV-FAP-9001", "IBTH line links the POTH, cost and supplier invoice");
  assert(Number((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).lastCost) === 8200, "part lastCost updated from the receipt");
  try { await receivePurchaseOrder({ poNo: po.no, actorCode: admin.code, received: [{ lineNo: 1, qty: 1 }] }); assert(false, "second receipt must be refused"); }
  catch (e) { assert(/PO_CLOSED/.test((e as Error).message), "receiving on a RECEIVED POTH is refused"); }

  console.log("5. margin below the floor via a dearer selection");
  const o2 = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "again" });
  await setQuoteLines({ serviceOrderNo: o2.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, partSku: sku, description: "QY82P output module", descriptionLocal: "โมดูล", qty: 1, unitPrice: 10000 }] });
  const inq2 = await createInquiry({ actorCode: admin.code, serviceOrderNo: o2.no, lines: [{ partSku: sku, description: "QY82P output module", qty: 1, unit: "pcs" }] });
  const q3 = await addSupplierQuote({ inquiryNo: inq2.no, actorCode: admin.code, supplierId: s1.id, currency: "THB", lines: [{ lineNo: 1, qty: 1, unitPrice: 8770 }] });
  await selectSupplierQuote({ inquiryNo: inq2.no, quoteId: q3.id, actorCode: admin.code });
  const low = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o2.no } });
  assert(low.marginApproval === "PENDING", `margin ${(Number(low.marginPct) * 100).toFixed(1)}% → PENDING`);
  try { await confirmCustomerPo({ no: o2.no, actorCode: admin.code, poLines: await poLinesFromQuote(o2.no) }); assert(false, "PO must be blocked"); }
  catch (e) { assert(/MARGIN_APPROVAL_REQUIRED/.test((e as Error).message), "customer PO blocked until the MD approves"); }
  await approveMargin({ no: o2.no, actorCode: admin.code, decision: "APPROVED", note: "strategic customer" });
  await confirmCustomerPo({ no: o2.no, actorCode: admin.code, poLines: await poLinesFromQuote(o2.no) });
  assert((await prisma.purchaseOrder.count({ where: { serviceOrder: { no: o2.no } } })) === 1, "after MD approval the PO goes through and the POTH is raised");

  console.log(`\nPURCHASING PASSED — ${inq.no} → ${po.no} → ${r.ibthNo}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
