/**
 * 自动化项目 against a real database (flow 自动化项目-流程图-v1, 2026-11-09): project order without ATH → plan (BOM
 * shortage raises a PRTH, split must be 100 %) → quote at the 20 % floor → PO = contract milestone → instalment 1 →
 * milestones in order (FAT needs its record, delivery a signed DNTH) → instalment 2 → SAT accepts and locks →
 * instalment 3 → INVOICED; the instalments add up to the contract; no order-level TITH.
 *   npx tsx scripts/dev/probe-project.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { completeMilestone, invoiceMilestone, savePlan } from "../../src/server/project";
import { issueDelivery, signDelivery, deliveryPlan } from "../../src/server/delivery";
import { issueTaxInvoice, recordPayment } from "../../src/server/to";
import { buildFields } from "../../src/server/reports";
import { allocateNumber } from "../../src/lib/numbering-db";
import { PHASES } from "../../src/lib/project";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`PROJECT FAIL: ${m}`); console.log("  ok  " + m); };
async function refused(f: () => Promise<unknown>, re: RegExp, m: string) {
  try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 80)})`); return; }
  throw new Error(`PROJECT FAIL: ${m} — was not refused`);
}
const file = (n: string) => [{ name: `${n}.pdf`, url: `/uploads/probe-${n}.pdf` }];

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Project Probe ${stamp} Co.`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const vfd = await prisma.part.create({ data: { sku: `SIE-G120P-${stamp}`, vendorPartNo: "6SL3210-1PE27-5UL0", name: "SINAMICS G120 PM240-2 37 kW", nameLocal: "อินเวอร์เตอร์ G120 37 kW", lastCost: 60000 } });

  console.log("1. project order: customer, name, scope — no ATH; nine milestones 30/60/10");
  await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "AUTOMATION_PROJECT", project: { name: " " } }), /PROJECT_NAME_REQUIRED/, "a project needs a name");
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "AUTOMATION_PROJECT", customerRef: `URS-${stamp}`, project: { name: "Line 3 extruder drive upgrade", dueDate: "2027-02-28", scope: "Replace 3 DC drives with AC inverters" } });
  const ms0 = await prisma.projectMilestone.findMany({ where: { serviceOrderId: o.id }, orderBy: { seq: "asc" } });
  assert(ms0.length === 9 && ms0.map((m) => Number(m.payPct ?? 0)).join() === "0.3,0,0,0,0,0.6,0,0.1,0", "nine milestones, 30 % / 60 % / 10 %");

  console.log("2. plan: BOM shortage → PRTH; the split must add up to 100 %");
  const plan = { no: o.no, actorCode: md.code, solution: "3 × G120 37 kW in a Rittal VX25 cabinet, PROFINET to the existing S7-1500", deliverables: [{ name: "Drive cabinet +A1", qty: 1 }],
    bom: [{ sku: vfd.sku, description: vfd.name, qty: 3, unit: "pcs" }, { description: "Rittal VX25 cabinet 1200×2000×600", qty: 1, unit: "set" }],
    labour: [{ description: "Electrical design", hours: 40, costPerHour: 600 }, { description: "Assembly and programming", hours: 80, costPerHour: 500 }, { description: "Site commissioning", hours: 40, costPerHour: 700 }] };
  await refused(() => savePlan({ ...plan, milestones: PHASES.map((p) => ({ phase: p, payPct: p === "CONTRACT" ? 0.3 : p === "DELIVERY" ? 0.5 : null })) }), /PAY_SPLIT:80/, "30 % + 50 % refused");
  const r = await savePlan({ ...plan, milestones: PHASES.map((p) => ({ phase: p, payPct: p === "CONTRACT" ? 0.3 : p === "DELIVERY" ? 0.6 : p === "SAT" ? 0.1 : null, plannedOn: p === "SAT" ? "2027-02-20" : undefined })) });
  assert(/^PRTH/.test(r.prth ?? ""), `shortage PRTH ${r.prth}: 3 × G120 and the cabinet`);
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).status === "DIAGNOSING", "plan saved → 方案中 (DIAGNOSING)");

  console.log("3. quote at the 20 % floor, PO = contract milestone");
  const lines = [
    { partSku: vfd.sku, description: vfd.name, descriptionLocal: vfd.nameLocal!, qty: 3, unit: "pcs", unitPrice: 76000, unitCost: 60000 },
    { description: "Rittal VX25 cabinet, assembled and wired", descriptionLocal: "ตู้ Rittal VX25 ประกอบและเดินสาย", qty: 1, unit: "set", unitPrice: 150000, unitCost: 120000 },
    { description: "Engineering, programming and commissioning", descriptionLocal: "ค่าแรงงานวิศวกรรม", qty: 160, unit: "h", unitPrice: 1000, unitCost: 575 },
  ];
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines });
  const q = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(q.marginApproval === "NOT_NEEDED" && Number(q.marginPct) >= 0.2 && Number(q.subtotal) === 538000, `THB 538,000 at ${(Number(q.marginPct) * 100).toFixed(1)} % clears the 20 % floor`);
  const qt = await buildFields(o.no, "30");
  assert(String(qt.values.PAYMENT_TERMS).startsWith("30%  on contract") && String(qt.values.DELIVERY_TERMS).includes("Line 3 extruder"), "quotation: payment by milestone, project named");
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
  let ms = await prisma.projectMilestone.findMany({ where: { serviceOrderId: o.id }, orderBy: { seq: "asc" } });
  assert(ms[0].doneAt && ms[0].note === `PO-${stamp}`, "the PO completes the contract milestone");
  await refused(() => issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code }), /USE_MILESTONE_INVOICE/, "no order-level TITH for a project");
  const i1 = await invoiceMilestone({ no: o.no, actorCode: md.code, seq: 1 });
  assert(i1.amount === 161400 && /^TITH/.test(i1.taxInvoiceNo) && /^IVTH/.test(i1.invoiceNo), `instalment 1: 30 % = 161,400 + VAT → ${i1.taxInvoiceNo} / ${i1.invoiceNo}`);
  await refused(() => invoiceMilestone({ no: o.no, actorCode: md.code, seq: 1 }), /TI_EXISTS/, "an instalment is invoiced once");
  await refused(() => savePlan({ ...plan, bom: [], milestones: PHASES.map((p) => ({ phase: p, payPct: p === "CONTRACT" ? 1 : null })) }).then(() => prisma.projectMilestone.findFirstOrThrow({ where: { serviceOrderId: o.id, phase: "DELIVERY" } })).then((m) => { if (Number(m.payPct) === 0.6) throw new Error("FROZEN"); }), /FROZEN/, "after the PO the split and BOM stay as contracted");

  console.log("4. milestones in order; FAT needs its record; delivery needs a signed DNTH");
  await refused(() => completeMilestone({ no: o.no, actorCode: md.code, seq: 3 }), /MILESTONE_EARLIER_OPEN/, "procurement before design refused");
  for (const seq of [2, 3, 4]) await completeMilestone({ no: o.no, actorCode: md.code, seq });
  await refused(() => completeMilestone({ no: o.no, actorCode: md.code, seq: 5 }), /MILESTONE_TEST_RECORD_REQUIRED/, "FAT without a test record refused");
  await completeMilestone({ no: o.no, actorCode: md.code, seq: 5, note: "IR test, I/O check, drive parameters", attachments: file("fat") });
  await refused(() => completeMilestone({ no: o.no, actorCode: md.code, seq: 6 }), /MILESTONE_DELIVERY_NOT_SIGNED/, "delivery before the DNTH is signed refused");
  const dp = await deliveryPlan(o.no);
  const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: Object.fromEntries(dp.lines.map((l) => [l.key, l.isService ? 0 : l.expected - l.deliveredBefore])) });
  await signDelivery({ no: dn.no, actorCode: md.code, signedBy: "Khun Somchai" });
  assert(!(await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).lockedAt, `${dn.no} signed — a project is not accepted by the delivery note`);
  await completeMilestone({ no: o.no, actorCode: md.code, seq: 6 });
  const i2 = await invoiceMilestone({ no: o.no, actorCode: md.code, seq: 6 });
  assert(i2.amount === 322800, `instalment 2: 60 % = 322,800 → ${i2.taxInvoiceNo}`);

  console.log("5. SAT accepts and locks; last instalment → INVOICED; instalments = contract");
  await completeMilestone({ no: o.no, actorCode: md.code, seq: 7 });
  await refused(() => completeMilestone({ no: o.no, actorCode: md.code, seq: 8 }), /MILESTONE_TEST_RECORD_REQUIRED/, "SAT needs the signed protocol");
  await completeMilestone({ no: o.no, actorCode: md.code, seq: 8, attachments: file("sat") });
  const acc = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(acc.status === "ACCEPTED" && !!acc.lockedAt, "SAT → ACCEPTED and locked");
  const i3 = await invoiceMilestone({ no: o.no, actorCode: md.code, seq: 8 });
  const tis = await prisma.taxInvoice.findMany({ where: { serviceOrderId: o.id } });
  assert(i3.amount === 53800 && Math.round(tis.reduce((s, t) => s + Number(t.subtotal), 0) * 100) / 100 === 538000, "instalment 3: 10 % = 53,800; the three add up to 538,000");
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).status === "INVOICED", "every instalment invoiced → INVOICED");
  await completeMilestone({ no: o.no, actorCode: md.code, seq: 9, note: "Manuals, backups, 1-day training" });
  const pay = await recordPayment({ invoiceNo: i1.invoiceNo, actorCode: md.code, paidAt: new Date(), paidAmount: 161400 * 1.07 - 161400 * 0.03, whtAmount: 161400 * 0.03, bankRef: `KB-${stamp}` });
  assert(pay.settled, `instalment 1 paid with 3 % WHT → ${pay.receiptNo}`);
  const ti1 = await buildFields(i1.taxInvoiceNo);
  assert(JSON.stringify(ti1.values.L_DESC).includes("งวดที่ 1"), "the instalment TITH says งวดที่ 1 in Thai");
  console.log(`\nPROJECT PASSED — ${o.no} · ${r.prth} · ${dn.no} · ${i1.taxInvoiceNo} ${i2.taxInvoiceNo} ${i3.taxInvoiceNo}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
