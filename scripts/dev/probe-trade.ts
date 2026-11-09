/**
 * 国内贸易 against a real database (business modes, 2026-11-09): customer inquiry lines, no ATH → shortages raise a
 * PRTH → quote at the 20 % floor → customer PO → OBTH → DNTH signed = accepted and locked → TITH → quotation and order
 * confirmation render without equipment.
 *   npx tsx scripts/dev/probe-trade.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { recordStockDoc } from "../../src/server/scm";
import { issueDelivery, signDelivery, deliveryPlan } from "../../src/server/delivery";
import { issueTaxInvoice } from "../../src/server/to";
import { buildFields } from "../../src/server/reports";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`TRADE FAIL: ${m}`); console.log("  ok  " + m); };
async function refused(f: () => Promise<unknown>, re: RegExp, m: string) {
  try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message})`); return; }
  throw new Error(`TRADE FAIL: ${m} — was not refused`);
}

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Trade Probe ${stamp} Co.`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const a = await prisma.part.create({ data: { sku: `SIE-G120-${stamp}`, vendorPartNo: "6SL3210-1PE23-8UL0", name: "SINAMICS G120 PM240-2 18.5 kW", nameLocal: "อินเวอร์เตอร์ G120 18.5 kW", lastCost: 30000 } });
  const b = await prisma.part.create({ data: { sku: `SIE-CU240-${stamp}`, vendorPartNo: "6SL3244-0BB13-1PA1", name: "CU240E-2 PN", nameLocal: "ชุดควบคุม CU240E-2 PN", lastCost: 9000 } });
  await recordStockDoc({ actorCode: md.code, direction: "IN", lines: [{ partSku: a.sku, qty: 10, unitCost: 30000 }] });

  console.log("1. trade order: customer + SKU lines, no ATH; shortages raise a PRTH");
  await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "DOMESTIC_TRADE", requestLines: [] }), /ITEM_LINES_REQUIRED/, "a trade order needs item lines");
  await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "INTERNATIONAL_TRADE", requestLines: [{ sku: a.sku, qty: 1 }] }), /MODE_NOT_OPEN/, "international trade is not open yet");
  const o = await createServiceOrder({
    createdByEmployeeCode: md.code, customerId: customer.id, mode: "DOMESTIC_TRADE", customerRef: `RFQ-${stamp}`,
    requestLines: [{ sku: a.sku, description: a.name, qty: 3, unit: "pcs" }, { sku: b.sku, qty: 2, unit: "pcs" }, { description: "Shielded motor cable 4×10 mm²", qty: 50, unit: "m" }, { description: "", qty: 0 }],
  });
  const row = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { assets: true, documents: true, inquiries: true } });
  assert(row.mode === "DOMESTIC_TRADE" && row.kind === "PARTS_SALE" && row.assets.length === 0, "mode 国内贸易, kind PARTS_SALE, no asset");
  assert((row.requestLines as unknown[]).length === 3, "empty rows dropped, three inquiry lines kept");
  assert(row.documents.find((d) => d.type === "QT")?.templateCode === "30", "QTTH renders as a quotation (30)");
  const prth = row.inquiries[0];
  const prLines = (prth?.lines ?? []) as { partSku?: string; description: string; qty: number }[];
  assert(row.inquiries.length === 1 && prLines.length === 2 && prLines.some((l) => l.partSku === b.sku && l.qty === 2) && prLines.some((l) => !l.partSku && l.qty === 50), `PRTH ${prth?.no}: CU240 × 2 and the cable × 50 (the G120 is on the shelf)`);

  console.log("2. quote at the 20 % floor, customer PO");
  const lines = [
    { partSku: a.sku, description: a.name, descriptionLocal: a.nameLocal!, qty: 3, unit: "pcs", unitPrice: 38000, unitCost: 30000 },
    { partSku: b.sku, description: b.name, descriptionLocal: b.nameLocal!, qty: 2, unit: "pcs", unitPrice: 11500, unitCost: 9000 },
    { description: "Shielded motor cable 4×10 mm²", descriptionLocal: "สายมอเตอร์ชีลด์ 4×10 ตร.มม.", qty: 50, unit: "m", unitPrice: 130, unitCost: 100 },
  ];
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: lines.map((l) => ({ ...l, unitPrice: Math.round(l.unitCost * 1.15) })) });
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).marginApproval === "PENDING", "13 % margin is below the 20 % trade floor → MD approval");
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines });
  const q = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(q.marginApproval === "NOT_NEEDED" && q.status === "QUOTE_PENDING" && Number(q.marginPct) >= 0.2 && Number(q.marginPct) < 0.5, `${(Number(q.marginPct) * 100).toFixed(1)} % clears the 20 % trade floor (a repair would need 50 %)`);
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).status === "IN_PROGRESS", "customer PO → in progress");

  console.log("3. stock out, delivery note signed = accepted and locked");
  await recordStockDoc({ actorCode: md.code, direction: "IN", lines: [{ partSku: b.sku, qty: 2, unitCost: 9000 }] }); // the CU240 arrived
  await recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: a.sku, qty: 3 }, { partSku: b.sku, qty: 2 }] });
  const plan = await deliveryPlan(o.no);
  const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: Object.fromEntries(plan.lines.map((l) => [l.key, l.expected - l.deliveredBefore])) });
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).status === "IN_PROGRESS", `${dn.no} issued — not accepted before the customer signs`);
  await signDelivery({ no: dn.no, actorCode: md.code, signedBy: "Khun Buyer" });
  const acc = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(acc.status === "ACCEPTED" && !!acc.lockedAt, `${dn.no} signed → ACCEPTED and locked`);

  console.log("4. tax invoice and the trade documents");
  const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code });
  assert(/^TITH/.test(ti.no), `tax invoice ${ti.no}`);
  for (const t of ["30", "31"]) {
    const f = await buildFields(o.no, t);
    const json = JSON.stringify(f.values);
    assert(f.template === t && (f.values.L_SKU as string[]).includes(a.sku) && json.includes("Shielded motor cable") && !json.includes("Diagnostic report"), `${t}: SKU lines, no service reports`);
  }
  console.log(`\nTRADE PASSED — ${o.no} · ${prth.no} · ${dn.no} · ${ti.no}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
