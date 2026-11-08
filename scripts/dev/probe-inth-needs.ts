/**
 * Flow step 3 against a real database: the INTH lists the parts and labour the repair needs → the stock check marks
 * what is short → one PRTH is raised for the short parts only → the quote starts from the INTH needs.
 *   npx tsx scripts/dev/probe-inth-needs.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder } from "../../src/server/slm";
import { createInspection, type InspectionNeed } from "../../src/server/slm-docs";
import { recordStockDoc } from "../../src/server/scm";
import { autoInquiryForOrder, inquiryLinesFromOrder } from "../../src/server/purchasing";
import { allocateNumber } from "../../src/lib/numbering-db";
import { parseNumber } from "../../src/lib/numbering";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`INTH NEEDS FAIL: ${m}`); console.log("  ok  " + m); };

async function main() {
  const admin = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: admin.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Needs Probe ${stamp}`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const model = await prisma.model.findFirstOrThrow();
  const vfd = await onboardAsset({ createdByEmployeeCode: admin.code, type: "VFD", serialNumber: `NEED-${stamp}`, modelId: model.id, customerId: customer.id, origin: "TAKEOVER" });
  const inStock = await prisma.part.create({ data: { sku: `PRB-FAN-${stamp}`, vendorPartNo: "FAN-24V", name: "Cooling fan 24 V", lastCost: 1800 } });
  await recordStockDoc({ actorCode: admin.code, direction: "IN", lines: [{ partSku: inStock.sku, qty: 3, unitCost: 1800 }], supplierRef: "opening" });
  const shortPart = await prisma.part.create({ data: { sku: `PRB-IGBT-${stamp}`, vendorPartNo: "FF450R", name: "IGBT module", lastCost: 12000 } }); // nothing on hand

  const o = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "F30001 overcurrent" });

  console.log("1. draft keeps the needs as typed, no stock check, no PRTH");
  const draft = await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "IGBT shorted", draft: true,
    needs: [{ kind: "PART", partSku: shortPart.sku, description: "IGBT module", qty: 2 }, { kind: "PART", partSku: inStock.sku, description: "Cooling fan", qty: 1 }, { kind: "LABOUR", description: "Repair and load test", qty: 6, unit: "h" }] });
  const dn = draft.needs as InspectionNeed[];
  assert(dn.length === 3 && dn[0].short === undefined, "draft stores three needs without a stock check");
  assert((await prisma.purchaseInquiry.count({ where: { serviceOrder: { no: o.no } } })) === 0, "no PRTH from a draft");

  console.log("2. saved for real: stock checked, short part raises one PRTH");
  const insp = await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: admin.code, findings: "IGBT shorted", probableCause: "overcurrent", recommendation: "replace IGBT and fan",
    needs: [{ kind: "PART", partSku: shortPart.sku, description: "IGBT module", qty: 2 }, { kind: "PART", partSku: inStock.sku, description: "Cooling fan", qty: 1 }, { kind: "LABOUR", description: "Repair and load test", qty: 6, unit: "h" }] });
  assert(insp.no === draft.no && !insp.draft, `the draft ${draft.no} became the real INTH`);
  const needs = insp.needs as InspectionNeed[];
  assert(needs[0].onHand === 0 && needs[0].short === 2, "IGBT: on hand 0, short 2");
  assert(needs[1].onHand === 3 && needs[1].short === 0, "fan: on hand 3, nothing short");
  assert(needs[2].short === undefined && needs[2].unit === "h", "labour row untouched, in hours");
  assert(needs[0].vendorPartNo === "FF450R", "vendor part number filled from the catalogue");
  const lines = await inquiryLinesFromOrder(o.no);
  assert(lines.length === 1 && lines[0].partSku === shortPart.sku && lines[0].qty === 2 && lines[0].assetCode === vfd.code, "inquiry lines from the INTH needs: only the short IGBT × 2, tagged with the asset");
  const pr = await autoInquiryForOrder(o.no, admin.code);
  assert(pr && parseNumber(pr)?.prefix === "PR", `PRTH ${pr} raised`);
  const inq = await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: pr! } });
  assert((inq.lines as unknown[]).length === 1 && inq.status === "OPEN", "the PRTH carries one line and is OPEN");
  assert((await autoInquiryForOrder(o.no, admin.code)) === null, "a second save does not raise a second PRTH while one is open");
  const ev = await prisma.assetEvent.findFirst({ where: { sourceDocNo: insp.no, type: "INSPECTED" } });
  assert(ev && Array.isArray((ev.payload as { needs?: unknown[] }).needs), "the INSPECTED event carries the needs (asset history)");

  console.log("3. nothing short → no PRTH");
  const o2 = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "fan noise" });
  await createInspection({ serviceOrderNo: o2.no, assetCode: vfd.code, engineerCode: admin.code, findings: "fan", needs: [{ kind: "PART", partSku: inStock.sku, description: "Cooling fan", qty: 2 }] });
  assert((await autoInquiryForOrder(o2.no, admin.code)) === null, "fan × 2 with 3 on hand → nothing to buy");

  console.log(`\nINTH NEEDS PASSED — ${insp.no} → ${pr}`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
