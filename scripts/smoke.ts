/**
 * End-to-end smoke test against a real database: one asset runs the whole ten-step flow and every number,
 * status and event is checked. Run after `npm run db:push && npm run db:seed`:  npx tsx scripts/smoke.ts
 * It creates its own customer/asset and leaves them in place (useful demo data); re-runs create new ones.
 */
import { onboardAsset, getAssetPage } from "../src/server/alm";
import { createServiceOrder, advanceServiceOrder } from "../src/server/slm";
import { createInspection, setQuoteLines, createRepairJob, recordAcceptance } from "../src/server/slm-docs";
import { recordMovement } from "../src/server/scm";
import { issueTaxInvoice, issueInvoice, recordPayment } from "../src/server/to";
import { renderDocument } from "../src/server/reports";
import { allocateNumber } from "../src/lib/numbering-db";
import { parseNumber } from "../src/lib/numbering";
import { prisma } from "../src/lib/db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`SMOKE FAIL: ${m}`); console.log("  ok  " + m); };

async function ensureSeed() {
  const entity = await prisma.legalEntity.upsert({ where: { countryCode: "TH" }, update: {}, create: { countryCode: "TH", nameEn: "DUCHENG INDUSTRIAL (THAILAND) CO., LTD.", nameLocal: "บริษัท ตู้เฉิง อินดัสเทรียล (ไทยแลนด์) จำกัด", taxId: "0205568072149", branchCode: "00000", localCurrency: "THB", bookCurrency: "CNY", vatRate: 0.07, signatoryName: "Zhu Dongsheng", phone: "+66 (0) 88 660 6999", email: "dongsheng.zhu@ducheng-industrial.com", website: "www.ducheng-industrial.com" } });
  await prisma.employee.upsert({ where: { code: "ETH2611001" }, update: {}, create: { code: "ETH2611001", entityId: entity.id, name: "Zhu Dongsheng", role: "ADMIN", email: "dongsheng.zhu@ducheng-industrial.com", locale: "zh" } });
  const sie = await prisma.brand.upsert({ where: { code: "SIE" }, update: {}, create: { code: "SIE", name: "SIEMENS" } });
  const s120 = await prisma.series.upsert({ where: { brandId_code: { brandId: sie.id, code: "S120" } }, update: {}, create: { brandId: sie.id, code: "S120", name: "SINAMICS S120" } });
  await prisma.model.upsert({ where: { seriesId_code: { seriesId: s120.id, code: "6SL3120-2TE41-0AA1" } }, update: {}, create: { seriesId: s120.id, code: "6SL3120-2TE41-0AA1" } });
}

async function main() {
  await ensureSeed();
  const admin = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  await prisma.fxRate.upsert({ where: { rateDate_currency_source: { rateDate: new Date(new Date().toISOString().slice(0, 10)), currency: "THB", source: "BOC" } }, update: {}, create: { rateDate: new Date(new Date().toISOString().slice(0, 10)), currency: "THB", rateToCny: 0.2051, source: "BOC" } });

  console.log("1. customer + plant");
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: admin.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: "Smoke Rubber (Thailand)", taxId: "0105555555555", branchCode: "00000", paymentTermDays: 30 } });
  });
  assert(parseNumber(customer.code)?.prefix === "C", `customer number ${customer.code}`);
  const plant = await prisma.plant.create({ data: { customerId: customer.id, code: "P2", name: "Plant 2" } });
  const model = await prisma.model.findFirstOrThrow({ include: { series: true } });
  const part = await prisma.part.upsert({ where: { sku: "SIE-6SL3352-1AE32-1AA1" }, update: {}, create: { sku: "SIE-6SL3352-1AE32-1AA1", vendorPartNo: "6SL3352-1AE32-1AA1", name: "Power module fan" } });
  await prisma.modelPart.upsert({ where: { modelId_partId_position: { modelId: model.id, partId: part.id, position: "fan 1" } }, update: {}, create: { modelId: model.id, partId: part.id, position: "fan 1" } });
  await recordMovement({ actorCode: admin.code, direction: "IN", partSku: part.sku, qty: 5, unitCost: 4200, costCurrency: "THB" });

  console.log("2. onboard VFD + motor, link them");
  const vfd = await onboardAsset({ createdByEmployeeCode: admin.code, type: "VFD", serialNumber: `SN-${Date.now()}`, modelId: model.id, customerId: customer.id, plantId: plant.id, location: "Mill 204 drive cabinet", origin: "TAKEOVER" });
  const motor = await onboardAsset({ createdByEmployeeCode: admin.code, type: "MOTOR", serialNumber: `MOT-${Date.now()}`, customerId: customer.id, plantId: plant.id, location: "Mill 204 main motor" });
  await prisma.assetRelation.create({ data: { fromAssetId: vfd.id, toAssetId: motor.id, relation: "DRIVES" } });
  assert(parseNumber(vfd.code)?.prefix === "A" && vfd.status === "ONBOARDED", `asset ${vfd.code} onboarded`);
  await prisma.asset.update({ where: { id: vfd.id }, data: { status: "IN_SERVICE" } });

  console.log("3. report → QTTH");
  const order = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, plantId: plant.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "F30001 overcurrent at start", reportedAlarm: "F30001", productionImpact: "Line stopped", customerRef: "XCGDD2610140001" });
  assert(parseNumber(order.no)?.prefix === "QT" && order.status === "RECEIVED", `service order ${order.no}`);
  assert(order.customerRef === "XCGDD2610140001", "customer ref kept verbatim");

  console.log("4. assign → inspect (INTH)");
  await advanceServiceOrder(order.no, "ASSIGNED", admin.code, "派工");
  const insp = await createInspection({ serviceOrderNo: order.no, assetCode: vfd.code, engineerCode: admin.code, conditions: "38°C, dusty", findings: "fan 1 seized, DC bus ripple high", probableCause: "cooling failure → capacitor stress", recommendation: "replace fan, test under load", tests: [{ test: "Visual", criterion: "no damage", result: "fan blocked" }, { test: "Power", criterion: "380V±10%", result: "372V" }] });
  await advanceServiceOrder(order.no, "DIAGNOSING", admin.code);
  assert(parseNumber(insp.no)?.prefix === "IN", `inspection ${insp.no}`);

  console.log("5. quote lines → QUOTE_PENDING → customer confirms");
  const quoted = await setQuoteLines({ serviceOrderNo: order.no, actorCode: admin.code, lines: [{ assetCode: vfd.code, partSku: part.sku, description: "Power module fan", descriptionLocal: "พัดลมโมดูลกำลัง", qty: 1, unitPrice: 6500 }, { assetCode: vfd.code, description: "Labour, site repair", descriptionLocal: "ค่าแรงซ่อมหน้างาน", qty: 4, unitPrice: 1500 }] });
  assert(Number(quoted.subtotal) === 12500 && Number(quoted.vatAmount) === 875 && Number(quoted.total) === 13375, "totals 12500 + 7% = 13375");
  assert(Math.abs(Number(quoted.totalCny) - 2743.21) < 0.01, "CNY at BoC 0.2051 = 2743.21");
  await advanceServiceOrder(order.no, "QUOTE_PENDING", admin.code);
  await advanceServiceOrder(order.no, "IN_PROGRESS", admin.code, "customer confirmed by PO");

  console.log("6. stock out → repair (RPTH) → finished → ACCEPTANCE_PENDING");
  const out = await recordMovement({ actorCode: admin.code, direction: "OUT", partSku: part.sku, qty: 1, assetCode: vfd.code, serviceOrderNo: order.no, oldPartDisposition: "scrapped" });
  assert(parseNumber(out.no)?.prefix === "OB" && out.no.length === 13, `stock out ${out.no} has 3-digit serial`);
  const job = await createRepairJob({ serviceOrderNo: order.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "SITE", finishedAt: new Date(), confirmedFault: "fan 1 seized", rootCause: "bearing wear, dust", workPerformed: "replaced fan 1, cleaned heatsink, re-torqued DC bus", partsReplaced: [{ partSku: part.sku, qty: 1, obthNo: out.no }], laborHours: 4, tests: [{ test: "No load", criterion: "runs 0-50 Hz", result: "ok", pass: true }, { test: "Load", criterion: "rated current", result: "92%", pass: true }] });
  await advanceServiceOrder(order.no, "ACCEPTANCE_PENDING", admin.code);
  let a = await getAssetPage(vfd.code);
  assert(a!.status === "ACCEPTANCE", `asset is ACCEPTANCE after finished job ${job.no}`);
  let threw = false;
  try { await prisma.$transaction(async () => { const { appendAssetEvent } = await import("../src/server/alm"); await appendAssetEvent({ assetCode: vfd.code, type: "STATUS_CHANGED", summary: "x", newStatus: "RETIRED" }); }); } catch { threw = true; }
  assert(threw, "ACCEPTANCE → RETIRED refused by the lifecycle");

  console.log("7. acceptance (13) → ACCEPTED, asset IN_SERVICE");
  await recordAcceptance({ serviceOrderNo: order.no, actorCode: admin.code, deliverables: [{ deliverable: "Mill 204 drive runs at 50 Hz under load", criterion: "no trip 2 h", result: "pass" }], status: "ACCEPTED", warrantyStart: new Date(), warrantyTerms: "6 months on replaced parts", customerSignatory: "Khun Somchai" });
  a = await getAssetPage(vfd.code);
  assert(a!.status === "IN_SERVICE", "asset back IN_SERVICE only through acceptance");

  console.log("8. TITH + IVTH");
  const ti = await issueTaxInvoice({ serviceOrderNo: order.no, actorCode: admin.code });
  assert(ti.currency === "THB" && Number(ti.total) === 13375, `tax invoice ${ti.no} in THB`);
  const iv = await issueInvoice({ serviceOrderNo: order.no, actorCode: admin.code, taxInvoiceNo: ti.no });
  assert(parseNumber(iv.no)?.prefix === "IV", `invoice ${iv.no}`);

  console.log("9. payment with 3% WHT → CLOSED");
  await recordPayment({ invoiceNo: iv.no, actorCode: admin.code, paidAt: new Date(), paidAmount: 13000, whtAmount: 375, whtCertRef: "WHT-2611-001", bankRef: "BOC 1234" });
  const closed = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: order.no } });
  assert(closed.status === "CLOSED", "order CLOSED after settlement");

  console.log("10. reports from events");
  const r08 = await renderDocument(insp.no);
  const r09 = await renderDocument(job.no);
  const r13 = await renderDocument(order.no, "13");
  assert(r08.unfilled.length === 0 && r09.unfilled.length === 0 && r13.unfilled.length === 0, `08/09/13 rendered with no blank placeholders (${r08.docxPath})`);

  a = await getAssetPage(vfd.code);
  const types = a!.events.map((e) => e.type);
  for (const t of ["ONBOARDED", "SERVICE_REQUESTED", "INSPECTED", "QUOTED", "PART_REPLACED", "REPAIRED", "TESTED", "ACCEPTED", "INVOICED", "PAID"]) assert(types.includes(t as never), `timeline has ${t}`);
  console.log(`\nSMOKE PASSED — asset ${vfd.code}, order ${order.no}, ${a!.events.length} events`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
