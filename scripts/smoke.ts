/**
 * End-to-end smoke test against a real database: one asset runs the whole ten-step flow and every number,
 * status and event is checked. Run after `npm run db:push && npm run db:seed`:  npx tsx scripts/smoke.ts
 * It creates its own customer/asset and leaves them in place (useful demo data); re-runs create new ones.
 */
import { onboardAsset, getAssetPage } from "../src/server/alm";
import { createServiceOrder, advanceServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../src/server/slm";
import { deliveryPlan, issueDelivery, signDelivery } from "../src/server/delivery";
import { createCustomer } from "../src/server/crm";
import { createEmployee } from "../src/server/opd";
import { createInspection, setQuoteLines, createRepairJob, recordAcceptance, receiveEquipment } from "../src/server/slm-docs";
import { recordMovement, recordStockDoc } from "../src/server/scm";
import { issueTaxInvoice, issueInvoice, recordPayment, issueMonthlyStatement } from "../src/server/to";
import { renderDocument, buildFields } from "../src/server/reports";
import { allocateNumber } from "../src/lib/numbering-db";
import { parseNumber } from "../src/lib/numbering";
import { prisma } from "../src/lib/db";
import { buildDashboardFromPrompt, heuristicSpec, parseActions } from "../src/server/ai";
import { renderDashboard } from "../src/server/dashboards";
import { METRICS } from "../src/lib/metrics";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`SMOKE FAIL: ${m}`); console.log("  ok  " + m); };

async function ensureSeed() {
  const entity = await prisma.legalEntity.upsert({ where: { countryCode: "TH" }, update: {}, create: { countryCode: "TH", code: "DCiT", nameEn: "DUCHENG INDUSTRIAL (THAILAND) CO., LTD.", nameLocal: "บริษัท ตู้เฉิง อินดัสเทรียล (ไทยแลนด์) จำกัด", taxId: "0205568072149", branchCode: "00000", localCurrency: "THB", bookCurrency: "CNY", vatRate: 0.07, signatoryName: "Zhu Dongsheng", phone: "+66 (0) 88 660 6999", email: "dongsheng.zhu@ducheng-industrial.com", website: "www.ducheng-industrial.com" } });
  await prisma.employee.upsert({ where: { code: "ETH2611001" }, update: {}, create: { code: "ETH2611001", entityId: entity.id, name: "Zhu Dongsheng", role: "MD", email: "dongsheng.zhu@ducheng-industrial.com", locale: "zh" } });
  const sie = await prisma.brand.upsert({ where: { code: "SIE" }, update: {}, create: { code: "SIE", name: "SIEMENS" } });
  const s120 = await prisma.series.upsert({ where: { brandId_code: { brandId: sie.id, code: "S120" } }, update: {}, create: { brandId: sie.id, code: "S120", name: "SINAMICS S120" } });
  await prisma.model.upsert({ where: { seriesId_code: { seriesId: s120.id, code: "6SL3120-2TE41-0AA1" } }, update: {}, create: { seriesId: s120.id, code: "6SL3120-2TE41-0AA1" } });
}

const assertJobEvents = (n: number) => n === 1;

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
  // A country without its own legal entity has no counter: refuse instead of borrowing one (it would collide later).
  if (!(await prisma.legalEntity.findUnique({ where: { countryCode: "VN" } }))) {
    let refused = false;
    try { await prisma.$transaction((tx) => allocateNumber(tx, { prefix: "E", createdByEmployeeCode: admin.code, entityId: entity.id, country: "VN" })); } catch (e) { refused = (e as Error).message === "NO_ENTITY_FOR_COUNTRY:VN"; }
    assert(refused, "no VN entity → numbering for VN refused");
  }
  const plant = await prisma.plant.create({ data: { customerId: customer.id, code: "P2", name: "Plant 2" } });
  await prisma.contact.create({ data: { customerId: customer.id, plantId: plant.id, name: "Khun Somchai" } });
  const model = await prisma.model.findFirstOrThrow({ include: { series: true } });
  const part = await prisma.part.upsert({ where: { sku: "SIE-6SL3352-1AE32-1AA1" }, update: {}, create: { sku: "SIE-6SL3352-1AE32-1AA1", vendorPartNo: "6SL3352-1AE32-1AA1", name: "Power module fan" } });
  await prisma.modelPart.upsert({ where: { modelId_partId_position: { modelId: model.id, partId: part.id, position: "fan 1" } }, update: {}, create: { modelId: model.id, partId: part.id, position: "fan 1" } });
  await recordMovement({ actorCode: admin.code, direction: "IN", partSku: part.sku, qty: 5, unitCost: 4200, costCurrency: "THB" });

  const fan2 = await prisma.part.upsert({ where: { sku: "SIE-6SL3362-0AF00-0AA1" }, update: {}, create: { sku: "SIE-6SL3362-0AF00-0AA1", vendorPartNo: "6SL3362-0AF00-0AA1", name: "DC-link capacitor set" } });
  const ib = await recordStockDoc({ actorCode: admin.code, direction: "IN", supplierRef: "INV-88213", lines: [{ partSku: part.sku, qty: 2, unitCost: 4200 }, { partSku: fan2.sku, qty: 1, unitCost: 18500 }] });
  assert(ib.lines.length === 2 && ib.lines.every((l) => l.no === ib.no) && ib.lines.map((l) => l.lineNo).join() === "1,2", `one IBTH ${ib.no} carries 2 SKUs`);
  assert((await prisma.document.count({ where: { no: ib.no } })) === 1, "the IBTH is registered once");

  console.log("2. onboard VFD + motor, link them");
  const vfd = await onboardAsset({ createdByEmployeeCode: admin.code, type: "VFD", serialNumber: `SN-${Date.now()}`, modelId: model.id, customerId: customer.id, plantId: plant.id, location: "Mill 204 drive cabinet", origin: "TAKEOVER" });
  const motor = await onboardAsset({ createdByEmployeeCode: admin.code, type: "MOTOR", serialNumber: `MOT-${Date.now()}`, customerId: customer.id, plantId: plant.id, location: "Mill 204 main motor" });
  await prisma.assetRelation.create({ data: { fromAssetId: vfd.id, toAssetId: motor.id, relation: "DRIVES" } });
  assert(parseNumber(vfd.code)?.prefix === "A" && vfd.status === "IN_SERVICE", `asset ${vfd.code} onboarded as IN_SERVICE (takeover)`);
  await prisma.asset.update({ where: { id: vfd.id }, data: { status: "IN_SERVICE" } });

  console.log("3. report → QTTH");
  const order = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, plantId: plant.id, assetCodes: [vfd.code], mode: "REPAIR", reportedSymptom: "F30001 overcurrent at start", reportedAlarm: "F30001", productionImpact: "Line stopped", customerRef: "XCGDD2610140001" });
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
  // Today's THB rate may be the live BoC one (fx:fetch ran first) or the 0.2051 fixture — check against whichever is stored.
  const thb = Number((await prisma.fxRate.findFirstOrThrow({ where: { currency: "THB", rateDate: { lte: new Date() } }, orderBy: { rateDate: "desc" } })).rateToCny);
  assert(Math.abs(Number(quoted.totalCny) - Math.round(13375 * thb * 100) / 100) < 0.011, `CNY at BoC ${thb} = ${(13375 * thb).toFixed(2)}`);
  await advanceServiceOrder(order.no, "QUOTE_PENDING", admin.code);
  const poLines = await poLinesFromQuote(order.no);
  assert(poLines.length === 2 && poLines[1].isService && !poLines[0].isService, "PO lines from quote: labour is a service line");
  await confirmCustomerPo({ no: order.no, actorCode: admin.code, customerRef: "XCGDD2610140001", poLines, attachments: [{ name: "po.pdf", url: "/api/uploads/po.pdf", kind: "PO" }] });
  const confirmed = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: order.no } });
  assert(confirmed.status === "IN_PROGRESS" && Array.isArray(confirmed.poLines) && (confirmed.attachments as unknown[]).length === 1, "PO confirmed: lines + scan kept, work started");

  console.log("5b. equipment received at workshop (ERTH, template 07)");
  const er = await receiveEquipment({ serviceOrderNo: order.no, assetCode: vfd.code, actorCode: admin.code, sender: "Khun Somchai (customer truck)", accessories: "keypad × 1\ncable × 2", condition: "dusty, no visible damage", fault: "F30001 at start" });
  assert(parseNumber(er.sourceDocNo!)?.prefix === "ER", `equipment receiving ${er.sourceDocNo}`);

  console.log("6. stock out → repair (RPTH) → finished → ACCEPTANCE_PENDING");
  const out = await recordMovement({ actorCode: admin.code, direction: "OUT", partSku: part.sku, qty: 1, assetCode: vfd.code, serviceOrderNo: order.no, oldPartDisposition: "RETURN_TO_CUSTOMER" });
  assert(parseNumber(out.no)?.prefix === "OB" && out.no.length === 13, `stock out ${out.no} has 3-digit serial`);
  // "Save draft" twice, then finish: one RPTH number, one work event.
  const before = (await prisma.asset.findUniqueOrThrow({ where: { code: vfd.code } })).status;
  const d1 = await createRepairJob({ serviceOrderNo: order.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "WORKSHOP", confirmedFault: "fan 1 seized", travelCost: 350 });
  const d2 = await createRepairJob({ serviceOrderNo: order.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "WORKSHOP", confirmedFault: "fan 1 seized", rootCause: "bearing wear", travelCost: 350 });
  assert(d1.no === d2.no && !d2.finishedAt, `draft RPTH saved twice keeps ${d1.no}`);
  const d3 = await createRepairJob({ serviceOrderNo: order.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "WORKSHOP", confirmedFault: "fan 1 seized" });
  assert(d3.no === d1.no && d3.rootCause === null && d3.travelCost === null, "a field left blank when the draft is saved again is cleared");
  const job = await createRepairJob({ serviceOrderNo: order.no, assetCode: vfd.code, engineerCode: admin.code, kind: "REPAIR", location: "WORKSHOP", finishedAt: new Date(), travelCost: 350, confirmedFault: "fan 1 seized", rootCause: "bearing wear, dust", workPerformed: "replaced fan 1, cleaned heatsink, re-torqued DC bus", partsReplaced: [{ partSku: part.sku, name: "Power module fan", qty: 1, obthNo: out.no, oldSerial: "F-OLD-1", oldDisposition: "RETURN_TO_CUSTOMER" }], laborHours: 4, tests: [{ test: "No load", criterion: "runs 0-50 Hz", result: "ok", pass: true }, { test: "Load", criterion: "rated current", result: "92%", pass: true }] });
  await advanceServiceOrder(order.no, "ACCEPTANCE_PENDING", admin.code);
  let a = await getAssetPage(vfd.code);
  assert(a!.status === "ACCEPTANCE", `asset is ACCEPTANCE after finished job ${job.no}`);
  let threw = false;
  try { await prisma.$transaction(async () => { const { appendAssetEvent } = await import("../src/server/alm"); await appendAssetEvent({ assetCode: vfd.code, type: "STATUS_CHANGED", summary: "x", newStatus: "RETIRED" }); }); } catch { threw = true; }
  assert(threw, "ACCEPTANCE → RETIRED refused by the lifecycle");

  console.log("6b. delivery note DNTH checked against PO + returns");
  const plan = await deliveryPlan(order.no);
  const keys = Object.fromEntries(plan.lines.map((l) => [l.key, l]));
  assert(plan.lines.filter((l) => l.kind === "RETURN").length === 3, "must return: keypad, cables, old fan");
  const full = Object.fromEntries(plan.lines.map((l) => [l.key, l.isService ? 0 : l.expected - l.deliveredBefore]));
  const cableKey = plan.lines.find((l) => /cable/.test(l.description))!.key;
  let blocked = false;
  try { await issueDelivery({ serviceOrderNo: order.no, actorCode: admin.code, deliverOn: new Date(), delivered: { ...full, [cableKey]: 1 } }); } catch (e) { blocked = String((e as Error).message).startsWith("DELIVERY_MISMATCH"); }
  assert(blocked && keys[cableKey].expected === 2, "one cable short → delivery blocked");
  const draftDn = await issueDelivery({ serviceOrderNo: order.no, actorCode: admin.code, deliverOn: new Date(), delivered: { ...full, [cableKey]: 1 }, draft: true });
  assert(draftDn.status === "DRAFT" && (await deliveryPlan(order.no)).lines.every((l) => l.deliveredBefore === 0), `draft ${draftDn.no} saved without the check and counts as nothing delivered`);
  const dn = await issueDelivery({ serviceOrderNo: order.no, actorCode: admin.code, deliverOn: new Date(), delivered: full, vehicle: "pickup" });
  assert(parseNumber(dn.no)?.prefix === "DN" && dn.status === "ISSUED" && dn.no === draftDn.no, `delivery note ${dn.no} issued from the draft, same number`);
  assert(assertJobEvents(await prisma.assetEvent.count({ where: { sourceDocNo: job.no, type: "REPAIRED" } })), `${job.no}: one repair event on the timeline`);
  const ev = await prisma.assetEvent.findFirstOrThrow({ where: { sourceDocNo: job.no, type: "REPAIRED" } });
  assert((ev.payload as { statusFrom?: string }).statusFrom === before && (ev.payload as { statusTo?: string }).statusTo === "ACCEPTANCE", `repair event keeps where it started: ${before} → ACCEPTANCE`);
  await signDelivery({ no: dn.no, actorCode: admin.code, signedBy: "Khun Somchai" });
  assert((await prisma.deliveryNote.findUniqueOrThrow({ where: { no: dn.no } })).status === "SIGNED", "delivery signed");

  console.log("7. acceptance (13) → ACCEPTED, asset IN_SERVICE");
  await recordAcceptance({ serviceOrderNo: order.no, actorCode: admin.code, deliverables: [{ deliverable: "Mill 204 drive runs at 50 Hz under load", criterion: "no trip 2 h", result: "pass" }], status: "ACCEPTED", warrantyStart: new Date(), warrantyTerms: "6 months on replaced parts", customerSignatory: "Khun Somchai" });
  a = await getAssetPage(vfd.code);
  assert(a!.status === "IN_SERVICE", "asset back IN_SERVICE only through acceptance");

  console.log("8a. business closure off → TITH / payment / BLTH refused");
  const savedClosure = process.env.BUSINESS_CLOSURE;
  process.env.BUSINESS_CLOSURE = "off";
  const refused = await issueTaxInvoice({ serviceOrderNo: order.no, actorCode: admin.code }).then(() => "", (e: Error) => e.message);
  assert(refused === "CLOSURE_OFF:TI", "TITH refused while closure is off");
  const stillAccepted = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: order.no } });
  assert(stillAccepted.status === "ACCEPTED", "order stays ACCEPTED, no number used");
  process.env.BUSINESS_CLOSURE = "on"; // the rest of the smoke exercises the closure code paths
  console.log("8. TITH + IVTH");
  const ti = await issueTaxInvoice({ serviceOrderNo: order.no, actorCode: admin.code });
  assert(ti.currency === "THB" && Number(ti.total) === 13375, `tax invoice ${ti.no} in THB`);
  const iv = await issueInvoice({ serviceOrderNo: order.no, actorCode: admin.code, taxInvoiceNo: ti.no });
  assert(parseNumber(iv.no)?.prefix === "IV", `invoice ${iv.no}`);

  console.log("9. payment with 3% WHT → settled, then 项目完成 closes the order");
  const pay = await recordPayment({ invoiceNo: iv.no, actorCode: admin.code, paidAt: new Date(), paidAmount: 13000, whtAmount: 375, whtCertRef: "WHT-2611-001", bankRef: "BOC 1234" });
  assert(pay.settled === true, "invoice settled by the payment");
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { no: order.no } })).status === "INVOICED", "settlement alone does not close the order (decision 2026-11-08)");
  await advanceServiceOrder(order.no, "CLOSED", admin.code, "项目完成");
  const closed = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: order.no } });
  assert(closed.status === "CLOSED" && closed.closedAt, "order CLOSED after the person confirms project completion");

  console.log("10. reports from events");
  const r08 = await renderDocument(insp.no);
  const r09 = await renderDocument(job.no);
  const r13 = await renderDocument(order.no, "13");
  const r04 = await renderDocument(order.no, "04");
  const r06 = await renderDocument(order.no, "06");
  const r07 = await renderDocument(er.sourceDocNo!);
  const r19 = await renderDocument((await prisma.deliveryNote.findFirstOrThrow({ where: { serviceOrderId: order.id } })).no);
  const f13 = await buildFields(order.no, "13");
  const f07 = await buildFields(er.sourceDocNo!);
  assert(!JSON.stringify(f13.values).includes("Somchai") && !JSON.stringify(f07.values).includes("Somchai"), "customer names masked on customer-facing reports");
  for (const [k, r] of Object.entries({ r08, r09, r13, r04, r06, r07, r19 })) { assert(r.unfilled.length === 0, `${k} rendered with no blank placeholders`); await r.cleanup(); }
  assert(new Set([r04, r06, r13].map((r) => r.fileBase)).size === 3, "reports under one QTTH download under different names");
  assert(!JSON.stringify((await buildFields(order.no, "04")).values).match(/Repair Report 09|Customer Acceptance 13| · /), "proposal shows report names, one item per line");

  console.log("10b. BLTH monthly statement for a credit customer");
  await prisma.customer.update({ where: { id: customer.id }, data: { monthlyStatement: true } });
  const o2 = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "CONTRACT", reportedSymptom: "quarterly PM" });
  assert(o2.mode === "MAINTENANCE" && o2.kind === "CONTRACT", "a contract-maintenance order is in the 维保 mode");
  for (const st of ["ASSIGNED", "DIAGNOSING", "IN_PROGRESS", "ACCEPTANCE_PENDING"] as const) await advanceServiceOrder(o2.no, st, admin.code);
  await setQuoteLines({ serviceOrderNo: o2.no, actorCode: admin.code, lines: [{ description: "PM visit", descriptionLocal: "บำรุงรักษา", qty: 1, unitPrice: 3000 }] });
  try { await recordAcceptance({ serviceOrderNo: o2.no, actorCode: admin.code, deliverables: [{ deliverable: "PM done" }], status: "ACCEPTED" }); assert(false, "acceptance without PMTH must be refused"); }
  catch (e) { assert(/ACCEPTANCE_INCOMPLETE:PMTH/.test((e as Error).message), "acceptance without a PMTH is refused (document completeness)"); }
  await createRepairJob({ serviceOrderNo: o2.no, assetCode: vfd.code, engineerCode: admin.code, kind: "MAINTENANCE", location: "SITE", finishedAt: new Date(), level: "QUARTERLY", handled: "cleaned, checked", conditionRating: "GOOD" });
  await recordAcceptance({ serviceOrderNo: o2.no, actorCode: admin.code, deliverables: [{ deliverable: "PM done" }], status: "ACCEPTED" });
  assert(!!(await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o2.no } })).lockedAt, "acceptance locks the order (price, cost, stock, purchasing)");
  const ti2 = await issueTaxInvoice({ serviceOrderNo: o2.no, actorCode: admin.code });
  await issueInvoice({ serviceOrderNo: o2.no, actorCode: admin.code, taxInvoiceNo: ti2.no });
  const bl = await issueMonthlyStatement(customer.code, "2611", admin.code);
  assert(parseNumber(bl.no)?.prefix === "BL" && Number(bl.total) === 3210, `statement ${bl.no} totals the unpaid IVTH (3210)`);

  console.log("10c. PMTH maintenance order with checklist → maintenance record (11)");
  const pm = await createServiceOrder({ createdByEmployeeCode: admin.code, customerId: customer.id, assetCodes: [vfd.code], kind: "MAINTENANCE", reportedSymptom: "annual PM" });
  for (const st of ["ASSIGNED", "DIAGNOSING", "IN_PROGRESS"] as const) await advanceServiceOrder(pm.no, st, admin.code);
  const pmJob = await createRepairJob({ serviceOrderNo: pm.no, assetCode: vfd.code, engineerCode: admin.code, kind: "MAINTENANCE", location: "SITE", finishedAt: new Date(), level: "ANNUAL", runHours: 8560, checklist: [{ item: "Fan 2 noise", criterion: "no noise", measured: "bearing noise", verdict: "HAZARD" }, { item: "DC capacitors", criterion: ">=80%", measured: "88%", verdict: "OK" }], hazards: "fan 2 bearing noise", handled: "cleaned heatsink", recommendation: "replace fan 2", conditionRating: "GOOD_WITH_ISSUE", nextDueAt: new Date(Date.now() + 180 * 86400000) });
  assert(pmJob.no.startsWith("PMTH") && pmJob.hazards === "fan 2 bearing noise", `maintenance job ${pmJob.no}`);
  const r11 = await renderDocument(pmJob.no);
  assert(r11.unfilled.length === 0, "r11 rendered with no blank placeholders");
  await r11.cleanup();

  console.log("10d. CRM customer from documents; OPD is MD-only");
  const c2 = await createCustomer({ actorCode: admin.code, entityCode: "DCiT", taxId: "0205568072149", branchCode: "00001", nameLocal: "บริษัท ทดสอบ จำกัด", name: `Smoke Customer ${Date.now()}`, plants: [{ code: "P1", name: "Plant 1" }], contacts: [{ name: "Khun Anan", phone: "081-234-5612" }], files: [{ name: "dbd.pdf", url: "/x", kind: "DBD" }] }).catch((e) => { if (String(e.message).startsWith("CUSTOMER_EXISTS")) return null; throw e; });
  assert(c2 === null || parseNumber(c2.code)?.prefix === "C", `customer from documents ${c2?.code ?? "(exists)"}`);
  if (await prisma.legalEntity.findUnique({ where: { code: "DCiV" } })) {
    // Booked under DCiV by a TH employee: still a CTH number, from the TH counter, never colliding with existing CTH numbers.
    const c3 = await createCustomer({ actorCode: admin.code, entityCode: "DCiV", taxId: String(Date.now()).padStart(13, "9").slice(-13), nameLocal: "บริษัท ทดสอบ เวียดนาม จำกัด", name: `Smoke VN ${Date.now()}`, plants: [{ code: "P1", name: "Plant 1" }], contacts: [] });
    assert(c3.code.startsWith("CTH"), `DCiV customer by a TH employee is ${c3.code}`);
  }
  const eng = await prisma.employee.findFirst({ where: { role: { not: "MD" }, active: true } });
  if (eng) { let denied = false; try { await createEmployee({ actorCode: eng.code, entityCode: "DCiT", name: "x", role: "ENGINEER", email: `x${Date.now()}@x.com`, password: "secret12" }); } catch (e) { denied = /MD_ONLY|MD only/.test((e as Error).message); } assert(denied, "non-MD cannot create employees"); }

  console.log("11. metrics catalog + AI dashboard builder (heuristic path when no API key)");
  for (const m of METRICS) { const r = await m.run(prisma, {}); assert(Array.isArray(r.labels) && r.labels.length === r.values.length, `metric ${m.id} → ${r.values.slice(0, 3).join(",")}`); }
  const spec = heuristicSpec("本月维修看板：工单、收入、工程师");
  assert(spec.widgets.some((w) => w.metric === "orders_per_month") && spec.widgets.some((w) => w.metric === "revenue_cny_per_month"), "heuristic spec picks orders + revenue");
  const dash = await buildDashboardFromPrompt("设备按客户和品牌", admin.code, "zh");
  const rendered = await renderDashboard(dash.id);
  assert(rendered.widgets.length >= 3 && rendered.widgets.every((w) => w.data.labels.length === w.data.values.length), `dashboard ${dash.id} renders ${rendered.widgets.length} widgets`);
  const acts = parseActions("Done.\nFORM: {\"findings\":\"fan seized\"}\nGOTO: /dashboard/abc");
  assert(acts.some((x) => x.type === "fill_form" && x.fields?.findings === "fan seized") && acts.some((x) => x.type === "navigate" && x.href === "/dashboard/abc"), "assistant actions parsed (FORM + GOTO)");

  a = await getAssetPage(vfd.code);
  const types = a!.events.map((e) => e.type);
  for (const t of ["ONBOARDED", "SERVICE_REQUESTED", "INSPECTED", "QUOTED", "ORDER_CONFIRMED", "RECEIVED_WORKSHOP", "PART_REPLACED", "REPAIRED", "TESTED", "DELIVERED", "ACCEPTED", "INVOICED", "PAID", "MAINTAINED"]) assert(types.includes(t as never), `timeline has ${t}`);
  process.env.BUSINESS_CLOSURE = savedClosure;
  console.log(`\nSMOKE PASSED — asset ${vfd.code}, order ${order.no}, ${a!.events.length} events`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
