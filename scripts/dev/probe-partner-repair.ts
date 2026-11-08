/**
 * 合作维修 end to end against a real database (flow v4, decided 2026-11-08):
 * INTH → route to partner → recommend → PRTH (no customer data) → two partner quotes → warranty short refused →
 * select → cost into the QTTH, 33 % floor → customer PO → POTH back-to-back → 外送 OBTH → milestones →
 * revision needs consent → DNTH blocked before retest → return with accessory check → retest fail → rework →
 * retest pass → supplier invoice (月结 15 天, 3 % WHT) → PVTH → rating → DNTH → acceptance with warranty-until.
 *   npx tsx scripts/dev/probe-partner-repair.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { createInspection, setQuoteLines, receiveEquipment, missingForAcceptance, recordAcceptance } from "../../src/server/slm-docs";
import { addSupplierQuote, createPurchaseOrder, createSupplier, receivePurchaseOrder, selectSupplierQuote } from "../../src/server/purchasing";
import { addMilestone, createSubcontractInquiry, dispatchToPartner, paySupplierInvoice, rateSupplier, recommendPartners, recordRetest, registerSupplierInvoice, returnFromPartner, revisePurchaseOrder, routeInHouse, routeToPartner, savePartnerProfile } from "../../src/server/srm";
import { deliveryPlan, issueDelivery, signDelivery } from "../../src/server/delivery";
import { buildFields, renderDocument } from "../../src/server/reports";
import { readFile } from "node:fs/promises";
import { readZip } from "../../src/lib/docx/zip";
import { createEmployee } from "../../src/server/opd";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`PARTNER FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (fn: () => Promise<unknown>, re: RegExp, m: string) => { try { await fn(); assert(false, m); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.split("\n")[0]})`); } };
const noCustomer = (values: Record<string, unknown>, words: string[], what: string) => { const all = JSON.stringify(values); const hit = words.filter((w) => w && all.includes(w)); assert(!hit.length, `${what} carries no customer data${hit.length ? ` — found ${hit.join(", ")}` : ""}`); };

async function main() {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const eng = await createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `Partner Probe Eng ${stamp}`, role: "ENGINEER", email: `pp${stamp}@dcit.test`, password: "probe123" });
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Secret Tyre Co ${stamp}`, taxId: `01077${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const model = await prisma.model.findFirstOrThrow();
  const motor = await onboardAsset({ createdByEmployeeCode: md.code, type: "MOTOR", serialNumber: `MOT-${stamp}`, modelId: model.id, customerId: customer.id, origin: "TAKEOVER" });
  const th = await createSupplier({ actorCode: md.code, name: `Rayong Rewind ${stamp}`, taxId: `01055${stamp}01`, address: "Rayong", contactName: "Khun Somchai", phone: "081" });
  const cn = await createSupplier({ actorCode: md.code, name: `Ningbo Motor Works ${stamp}`, address: "Ningbo" });
  await savePartnerProfile({ code: th.code!, actorCode: md.code, isPartner: true, capabilities: ["motor", "CNC"], countryCode: "TH" });
  await savePartnerProfile({ code: cn.code!, actorCode: md.code, isPartner: true, capabilities: ["MOTOR"], countryCode: "CN" });
  const thP = await prisma.supplier.findUniqueOrThrow({ where: { id: th.id } }), cnP = await prisma.supplier.findUniqueOrThrow({ where: { id: cn.id } });
  assert(thP.paymentMode === "MONTHLY" && thP.paymentDays === 15 && cnP.paymentMode === "PER_ORDER" && thP.capabilities.includes("MOTOR"), "TH partner monthly 15 days, CN per order; capabilities upper-cased");

  console.log("1. order, intake, INTH, route to partner");
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [motor.code], kind: "REPAIR", reportedSymptom: "motor overheats", customerRef: `SECRETPO${stamp}` });
  await receiveEquipment({ serviceOrderNo: o.no, assetCode: motor.code, actorCode: eng.code, accessories: "Fan cover × 1\nTerminal box × 1", condition: "dusty" });
  await createInspection({ serviceOrderNo: o.no, assetCode: motor.code, engineerCode: eng.code, symptoms: "overheats at full load", findings: "winding insulation 0.3 MΩ", probableCause: "stator winding" });
  await refused(() => createSubcontractInquiry({ no: o.no, actorCode: eng.code }), /NOT_PARTNER_ORDER/, "no partner PRTH before routing");
  await refused(() => routeToPartner({ no: o.no, actorCode: eng.code, reason: " " }), /PARTNER_REASON_REQUIRED/, "routing needs a reason");
  await routeToPartner({ no: o.no, actorCode: eng.code, reason: "motor rewinding is not our trade" });
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).fulfilment === "PARTNER", "order is PARTNER");
  const rec = await recommendPartners(o.no);
  assert(rec.some((r) => r.id === th.id && r.match === 1) && rec.some((r) => r.id === cn.id), "both MOTOR partners recommended");

  console.log("2. PRTH to partners — no customer data");
  const inq = await createSubcontractInquiry({ no: o.no, actorCode: eng.code, note: "please quote rewinding" });
  assert(inq.kind === "SUBCONTRACT" && (inq.lines as { assetCode?: string }[])[0].assetCode === motor.code, `${inq.no} is SUBCONTRACT, one line per machine`);
  await refused(() => createSubcontractInquiry({ no: o.no, actorCode: eng.code }), /SUBCONTRACT_INQUIRY_OPEN/, "one open partner PRTH per order");
  const pr = await buildFields(inq.no);
  noCustomer(pr.values, [customer.name, `SECRETPO${stamp}`, o.no], `PRTH ${inq.no}`);

  console.log("3. quotes, warranty back-to-back, cost into QTTH, 33 % floor");
  const qTh = await addSupplierQuote({ inquiryNo: inq.no, actorCode: eng.code, supplierId: th.id, quoteNo: "RR-1", leadTimeDays: 10, warrantyDays: 60, solution: "full rewind, class F, new bearings", lines: [{ lineNo: 1, qty: 1, unitPrice: 6000 }] });
  const qCn = await addSupplierQuote({ inquiryNo: inq.no, actorCode: eng.code, supplierId: cn.id, quoteNo: "NB-9", leadTimeDays: 20, warrantyDays: 30, lines: [{ lineNo: 1, qty: 1, unitPrice: 5000 }] });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, warrantyDays: 60, lines: [{ assetCode: motor.code, description: "Motor repair (rewind)", descriptionLocal: "ซ่อมมอเตอร์", qty: 1, unit: "set", unitPrice: 10000 }] });
  await refused(() => selectSupplierQuote({ inquiryNo: inq.no, quoteId: qCn.id, actorCode: md.code }), /WARRANTY_SHORT/, "a partner covering 30 days cannot back a 60-day promise");
  await selectSupplierQuote({ inquiryNo: inq.no, quoteId: qTh.id, actorCode: md.code });
  let ord = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  assert(Number(ord.costTotal) === 6000 && Number(ord.marginPct) === 0.4 && ord.marginApproval === "NOT_NEEDED", `partner cost 6000 → margin 40 % ≥ 33 %, no MD needed (in-house would need it)`);
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ assetCode: motor.code, description: "Motor repair (rewind)", qty: 1, unit: "set", unitPrice: 8500 }] });
  ord = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  assert(Number(ord.costTotal) === 6000 && ord.marginApproval === "PENDING", `re-quote keeps the partner cost; 29.4 % < 33 % → MD`);
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ assetCode: motor.code, description: "Motor repair (rewind)", descriptionLocal: "ซ่อมมอเตอร์", qty: 1, unit: "set", unitPrice: 10000 }] });
  ord = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  assert(ord.marginApproval === "NOT_NEEDED" && ord.warrantyDays === 60, "back to 10 000: 40 %; customer warranty 60 days kept");

  console.log("4. customer PO → POTH back-to-back");
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `SECRETPO${stamp}`, poLines: await poLinesFromQuote(o.no) });
  const po = await prisma.purchaseOrder.findFirstOrThrow({ where: { serviceOrderId: ord.id, kind: "SUBCONTRACT" } });
  assert(po.supplierId === th.id && po.warrantyDays === 60 && po.scope === "full rewind, class F, new bearings" && /Monthly/.test(po.paymentTerms ?? ""), `${po.no}: partner, 60 days, scope, monthly terms`);
  await refused(() => createPurchaseOrder({ actorCode: md.code, supplierId: th.id, serviceOrderNo: o.no, kind: "SUBCONTRACT", warrantyDays: 30, lines: [{ description: "x", qty: 1, unitPrice: 1 }] }), /WARRANTY_NOT_BACK_TO_BACK/, "a POTH with other warranty days than the customer's is refused");
  const poF = await buildFields(po.no);
  noCustomer(poF.values, [customer.name, `SECRETPO${stamp}`, o.no], `POTH ${po.no}`);
  assert(/Warranty/.test(String((poF.values.L_DESC as string[])[0])) && /DCiT only/.test(String(poF.values.DELIVER_TO)), "POTH prints scope + warranty and 'return to DCiT only'");
  await refused(() => routeInHouse({ no: o.no, actorCode: md.code }), /PARTNER_PO_EXISTS/, "cannot go back in-house once a partner POTH exists");

  console.log("5. 外送 OBTH, milestones, revision");
  const out1 = await dispatchToPartner({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, accessories: "Fan cover × 1\nTerminal box × 1", condition: "winding burnt smell", carriedBy: "Art" });
  assert(/^OBTH/.test(out1.no), `外送维修单 ${out1.no}`);
  const ob = await prisma.document.findUniqueOrThrow({ where: { no: out1.no } });
  assert(ob.templateCode === "28", "OBTH prints on template 28");
  const obF = await buildFields(out1.no);
  assert(obF.template === "28" && (obF.values.L_ITEM as string[]).length === 2 && obF.values.CONDITION === "winding burnt smell", "dispatch note lists 2 accessories and the condition");
  noCustomer(obF.values, [customer.name, `SECRETPO${stamp}`, o.no], `外送维修单 ${out1.no}`);
  assert((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status === "SENT", "POTH → SENT");
  await refused(() => dispatchToPartner({ poNo: po.no, actorCode: eng.code, assetCode: motor.code }), /ALREADY_AT_PARTNER/, "cannot send it twice");
  await refused(() => receivePurchaseOrder({ poNo: po.no, actorCode: eng.code, received: [{ lineNo: 1, qty: 1 }] }), /PO_IS_SUBCONTRACT/, "a partner POTH is not received as parts");
  await addMilestone({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, stage: "ARRIVED" });
  await addMilestone({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, stage: "DISASSEMBLED", note: "bearing seized too" });
  await refused(() => revisePurchaseOrder({ poNo: po.no, actorCode: md.code, reason: "bearing seized", lines: [{ description: "Rewind + bearings", qty: 1, unit: "set", unitPrice: 6600 }] }), /CUSTOMER_CONSENT_REQUIRED/, "extra cost needs the customer's written consent");
  const rev = await revisePurchaseOrder({ poNo: po.no, actorCode: md.code, reason: "bearing seized", customerConsent: "customer e-mail 2026-11-09 OK", lines: [{ description: "Rewind + bearings", qty: 1, unit: "set", unitPrice: 6600 }] });
  ord = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  assert(rev.version === 2 && Number(rev.subtotal) === 6600 && Number(ord.costTotal) === 6600 && Number(ord.marginPct) === 0.34, `POTH v2 6600; order cost 6600, margin 34 %`);
  await addMilestone({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, stage: "COMPLETED", note: "test report RR-T-1" });

  console.log("6. DNTH blocked, return with accessory check, retest fail → rework → pass");
  const plan = await deliveryPlan(o.no);
  const all = Object.fromEntries(plan.lines.map((l) => [l.key, l.expected - l.deliveredBefore]));
  await refused(() => issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all }), /RETEST_NOT_PASSED/, "no DNTH while the machine is at the partner");
  await refused(() => returnFromPartner({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, returned: "Fan cover × 1" }), /ACCESSORIES_MISSING:Terminal box×1/, "a missing terminal box refuses the return");
  const back1 = await returnFromPartner({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, partnerSigned: "Somchai" });
  assert((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status === "RECEIVED", `${back1.no} back; POTH RECEIVED`);
  const ibF = await buildFields(back1.no);
  assert(ibF.template === "29" && ibF.values.DISPATCH_NO === out1.no && (ibF.values.L_CHECK as string[]).every((x) => x === "✓"), "return note checks every accessory against the dispatch");
  noCustomer(ibF.values, [customer.name, `SECRETPO${stamp}`, o.no], `外协返回单 ${back1.no}`);
  await refused(() => recordRetest({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, passed: false }), /RETEST_FAIL_NOTE_REQUIRED/, "a failed retest needs a note");
  await recordRetest({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, passed: false, note: "vibration 7 mm/s" });
  assert((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } })).status === "SENT", "failed retest → POTH back to SENT (rework under warranty)");
  await refused(() => registerSupplierInvoice({ poNo: po.no, actorCode: md.code, invoiceNo: "INV-1", invoiceDate: new Date("2026-11-08"), subtotal: 6600 }), /NOT_ACCEPTED_YET/, "no supplier invoice before our retest passed");
  const out2 = await dispatchToPartner({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, accessories: "Fan cover × 1\nTerminal box × 1", condition: "rework: vibration" });
  await returnFromPartner({ poNo: po.no, actorCode: eng.code, assetCode: motor.code });
  const pass = await recordRetest({ poNo: po.no, actorCode: eng.code, assetCode: motor.code, passed: true, note: "vibration 1.2 mm/s, temp rise 55 K" });
  ord = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
  const m = await prisma.asset.findUniqueOrThrow({ where: { id: motor.id } });
  assert(pass.orderReady && ord.status === "ACCEPTANCE_PENDING" && m.status === "ACCEPTANCE", `rework ${out2.no} passed: order ACCEPTANCE_PENDING, machine ACCEPTANCE`);
  const rep = await prisma.assetEvent.findFirstOrThrow({ where: { assetId: motor.id, type: "REPAIRED" }, orderBy: { occurredAt: "desc" } });
  assert((rep.payload as { warrantyDays?: number; partner?: string }).warrantyDays === 60 && (rep.payload as { partner?: string }).partner === th.code, "ALM record: partner, plan, warranty 60 d");

  console.log("7. payables, rating");
  await refused(() => registerSupplierInvoice({ poNo: po.no, actorCode: md.code, invoiceNo: "INV-1", invoiceDate: new Date("2026-11-08"), subtotal: 7000 }), /INVOICE_EXCEEDS_PO/, "an invoice above the POTH is refused");
  const inv = await registerSupplierInvoice({ poNo: po.no, actorCode: md.code, invoiceNo: "INV-1", invoiceDate: new Date("2026-11-08"), subtotal: 6600 });
  assert(inv.dueDate.toISOString().slice(0, 10) === "2026-12-15" && Number(inv.whtAmount) === 198 && Number(inv.payable) === 6864, `月结 15 天 → due 2026-12-15; WHT 3 % = 198; pay 6600 + 462 − 198 = 6864`);
  await refused(() => paySupplierInvoice({ id: inv.id, actorCode: eng.code }), /FINANCE_ONLY/, "engineers cannot pay");
  const paid = await paySupplierInvoice({ id: inv.id, actorCode: md.code, paymentRef: "KBANK 123" });
  assert(paid.status === "PAID" && /^PVTH/.test(paid.paymentNo ?? ""), `paid on ${paid.paymentNo}`);
  await rateSupplier({ poNo: po.no, actorCode: md.code, quality: 4, onTime: 3, price: 4, cooperation: 5, note: "rework once" });
  const rec2 = await recommendPartners(o.no);
  const iTh = rec2.findIndex((r) => r.id === th.id), iCn = rec2.findIndex((r) => r.id === cn.id);
  assert(rec2[iTh].score === 4 && rec2[iTh].jobs === 1 && iTh < iCn, "rated partner (score 4, 1 job) ranks above the unrated one");

  console.log("8. DNTH, acceptance, warranty-until");
  const miss = await missingForAcceptance(o.no);
  assert(miss.length === 1 && miss[0] === "DNTH", `only the DNTH is missing (${miss.join(",")})`);
  const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all });
  await signDelivery({ no: dn.no, actorCode: md.code, signedBy: "Khun Receiver" });
  assert(!(await missingForAcceptance(o.no)).length, "complete: QTTH INTH POTH OBTH IBTH retest ERTH DNTH");
  await recordAcceptance({ serviceOrderNo: o.no, actorCode: md.code, status: "ACCEPTED", deliverables: [{ deliverable: "Motor runs", result: "OK" }], acceptedAt: new Date("2026-11-20") });
  const acc = await prisma.assetEvent.findFirstOrThrow({ where: { assetId: motor.id, type: "ACCEPTED" }, orderBy: { occurredAt: "desc" } });
  assert((acc.payload as { warrantyUntil?: string }).warrantyUntil === "2027-01-19", "warranty until 2027-01-19 (60 days from acceptance)");

  console.log("9. rendered partner documents");
  assert((await buildFields(out1.no)).values.CONDITION === "winding burnt smell" && (await buildFields(out2.no)).values.CONDITION === "rework: vibration", "each dispatch note keeps its own condition");
  for (const no of [inq.no, po.no, out1.no, back1.no]) {
    const r = await renderDocument(no);
    const xml = readZip(await readFile(r.docxPath)).find((e) => e.name === "word/document.xml")!.data.toString("utf8");
    assert(!r.unfilled.length && !xml.includes(customer.name) && !xml.includes(`SECRETPO${stamp}`), `${no} rendered (${r.docxPath.split("/").pop()}): all fields filled, no customer name or PO in the file`);
  }

  console.log(`\nPARTNER REPAIR PASSED — ${o.no} via ${po.no} (${out1.no}, ${out2.no})`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
