/**
 * 服务咨询 against a real database (朱总 2026-11-27): no goods, no machine. Customer + service lines → quote → customer
 * PO (every line a service line) → no DNTH can be raised → acceptance on the customer's signed confirmation → TITH.
 *   npx tsx scripts/dev/probe-consulting.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { issueDelivery, deliveryPlan } from "../../src/server/delivery";
import { attachAcceptSheet, missingForAcceptance, recordAcceptance as rawAccept } from "../../src/server/slm-docs";
import { skuGaps } from "../../src/server/purchasing";
import { issueTaxInvoice, setQuoteLines } from "./_probe";
import { buildFields } from "../../src/server/reports";
import { allocateNumber } from "../../src/lib/numbering-db";
import { nextSteps } from "../../src/lib/order-steps";
import { chainOf } from "../../src/lib/doc-chain";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`CONSULTING FAIL: ${m}`); console.log("  ok  " + m); };
async function refused(f: () => Promise<unknown>, re: RegExp, m: string) {
  try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 80)})`); return; }
  throw new Error(`CONSULTING FAIL: ${m} — was not refused`);
}

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Consulting Probe ${stamp} Co.`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });

  console.log("1. order: customer + service lines, no machine, no SKU, nothing sent to purchasing");
  await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "SERVICE_CONSULTING", requestLines: [] }), /ITEM_LINES_REQUIRED/, "a consulting order needs a service line");
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "SERVICE_CONSULTING", customerRef: `RFQ-${stamp}`, requestLines: [{ sku: "SHOULD-BE-DROPPED", description: "Technical service and consulting", qty: 1 }] });
  const row = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { assets: true, documents: true, inquiries: true } });
  const req = row.requestLines as { sku?: string; unit: string }[];
  assert(row.mode === "SERVICE_CONSULTING" && row.assets.length === 0 && req.length === 1 && !req[0].sku && req[0].unit === "lot", "mode 服务咨询, no asset, the line carries no SKU and counts in lot");
  assert(row.documents.find((d) => d.type === "QT")?.templateCode === "30" && row.inquiries.length === 0, "QTTH renders as a quotation (30); no PRTH raised");
  assert((await skuGaps(o.no)).length === 0, "no 'line has no part number' warning");

  console.log("2. quote: 50 % floor, then the customer PO — every line a service line");
  const line = { description: "Technical service and consulting", descriptionLocal: "ค่าบริการทางเทคนิคและที่ปรึกษา", qty: 1, unit: "lot", unitPrice: 100000 };
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ ...line, unitCost: 60000 }] });
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).marginApproval === "PENDING", "40 % margin is below the 50 % floor → MD approval");
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ ...line, unitCost: 13000 }] });
  const q = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(q.marginApproval === "NOT_NEEDED" && q.status === "QUOTE_PENDING", `${(Number(q.marginPct) * 100).toFixed(0)} % clears the floor; quote pending`);
  const po = await poLinesFromQuote(o.no);
  assert(po.length === 1 && po[0].isService, "the PO line is a service line");
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: po.map((l) => ({ ...l, isService: false })) });
  const c = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { purchaseOrders: true } });
  assert(c.status === "IN_PROGRESS" && (c.poLines as { isService: boolean }[]).every((l) => l.isService) && c.purchaseOrders.length === 0, "customer PO → in progress; lines stay service lines whatever the form sent; no POTH");

  console.log("3. no delivery note; the next step is the acceptance");
  const shape = { status: "IN_PROGRESS", kind: c.kind, hasInspection: false, hasQuote: true, hasJob: false, jobFinished: false, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false, consulting: true };
  const st = nextSteps(shape);
  assert(st.primary === "accept" && !st.also.includes("deliver") && !st.also.includes("stockOut"), "next step: acceptance — no delivery, no stock-out offered");
  assert(!chainOf("SERVICE_CONSULTING", []).some((s) => s.key === "DN" || s.key === "OB"), "document chain has no DNTH / OBTH");
  const plan = await deliveryPlan(o.no);
  await refused(() => issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: Object.fromEntries(plan.lines.map((l) => [l.key, 1])) }), /NO_DELIVERY_FOR_SERVICE/, "a delivery note is refused");
  assert((await missingForAcceptance(o.no)).length === 0, "no INTH / RPTH / DNTH asked for before acceptance");

  console.log("4. acceptance needs the customer's signed confirmation; then the tax invoice");
  const acc = { serviceOrderNo: o.no, actorCode: md.code, status: "ACCEPTED" as const, deliverables: [{ deliverable: line.description, criterion: `PO-${stamp}`, result: "done" }] };
  await refused(() => rawAccept(acc), /ACCEPT_NEEDS_SHEET/, "no acceptance without the signed confirmation");
  await refused(() => issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code }), /ACCEPTED|EVIDENCE/, "no tax invoice before acceptance");
  await attachAcceptSheet({ orderNos: [o.no], actorCode: md.code, files: [{ name: "service-confirmation.pdf", url: "/uploads/accept/probe-consulting.pdf" }] });
  await rawAccept(acc);
  const a = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { deliveries: true } });
  assert(a.status === "ACCEPTED" && !!a.lockedAt && a.deliveries.length === 0, "signed confirmation uploaded → ACCEPTED and locked, without any DNTH");
  const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code });
  const done = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { invoices: true } });
  assert(/^(TEST-)?TITH/.test(ti.no) && done.status === "INVOICED" && done.invoices.length === 1, `tax invoice ${ti.no} and its receivable`);
  const f = await buildFields(o.no, "30");
  assert(f.template === "30" && JSON.stringify(f.values).includes("Technical service and consulting"), "quotation 30 renders the service line");
  console.log(`\nCONSULTING PASSED — ${o.no} · ${ti.no}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
