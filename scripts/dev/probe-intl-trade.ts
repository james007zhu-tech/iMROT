/**
 * 国际贸易 against a real database (flow 国际贸易-流程图-v1, 2026-11-09): trade terms fixed on the order → USD quote at
 * VAT 0 % and the 10 % floor → customer PO → OBTH → shipment: CI (IVTH, 33) + PL (DNTH, 34) → B/L = accepted, locked,
 * INVOICED → USD payment → no TITH anywhere. Quotation, CI and PL render.
 *   npx tsx scripts/dev/probe-intl-trade.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { recordStockDoc } from "../../src/server/scm";
import { confirmShipment, issueShipment, shipmentFor } from "../../src/server/export";
import { issueTaxInvoice, recordPayment } from "../../src/server/to";
import { buildFields } from "../../src/server/reports";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`INTL FAIL: ${m}`); console.log("  ok  " + m); };
async function refused(f: () => Promise<unknown>, re: RegExp, m: string) {
  try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 90)})`); return; }
  throw new Error(`INTL FAIL: ${m} — was not refused`);
}

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `PT Sinar Probe ${stamp}`, addressEn: "Jl. Industri 7, Jakarta, Indonesia", paymentTermDays: 0 } });
  });
  const a = await prisma.part.create({ data: { sku: `SIE-G120X-${stamp}`, vendorPartNo: "6SL3210-1PE23-8UL0", name: "SINAMICS G120 PM240-2 18.5 kW", lastCost: 900 } });
  const b = await prisma.part.create({ data: { sku: `SIE-CU240X-${stamp}`, vendorPartNo: "6SL3244-0BB13-1PA1", name: "CU240E-2 PN", lastCost: 270 } });
  await recordStockDoc({ actorCode: md.code, direction: "IN", lines: [{ partSku: a.sku, qty: 4, unitCost: 900 }, { partSku: b.sku, qty: 4, unitCost: 270 }] });
  const terms = { currency: "USD", incoterm: "FOB", place: "Laem Chabang", destCountry: "Indonesia", destPort: "Jakarta", shipMode: "SEA", paymentTerms: "T/T 100% within 30 days of B/L", paymentDays: 30 };

  console.log("1. order with trade terms, HS code and origin on the inquiry lines");
  await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "INTERNATIONAL_TRADE", requestLines: [{ sku: a.sku, qty: 1 }], tradeTerms: { ...terms, incoterm: "FOT" } }), /BAD_INCOTERM/, "unknown Incoterm refused");
  await refused(() => createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "INTERNATIONAL_TRADE", requestLines: [{ sku: a.sku, qty: 1 }], tradeTerms: { ...terms, place: "" } }), /TRADE_TERMS_REQUIRED:place/, "the named place is required");
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "INTERNATIONAL_TRADE", customerRef: `SE-RFQ-${stamp}`, tradeTerms: terms,
    requestLines: [{ sku: a.sku, description: a.name, qty: 4, unit: "pcs", hsCode: "8504.40.90", origin: "de" }, { sku: b.sku, qty: 4, unit: "pcs", hsCode: "8537.10", origin: "DE" }] });
  const row = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(row.mode === "INTERNATIONAL_TRADE" && row.currency === "USD" && (row.tradeTerms as { incoterm: string }).incoterm === "FOB", "USD order on FOB Laem Chabang");
  assert(((row.requestLines as { origin?: string }[])[0]).origin === "DE", "origin kept, upper-cased");

  console.log("2. USD quote, VAT 0 %, 10 % floor; customer PO");
  const lines = [
    { partSku: a.sku, description: a.name, qty: 4, unit: "pcs", unitPrice: 1010, unitCost: 900 },
    { partSku: b.sku, description: b.name, qty: 4, unit: "pcs", unitPrice: 305, unitCost: 270 },
  ];
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines });
  const q = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  assert(Number(q.vatAmount) === 0 && Number(q.total) === 5260 && q.marginApproval === "NOT_NEEDED", `USD ${Number(q.total)} without VAT; ${(Number(q.marginPct) * 100).toFixed(1)} % clears the 10 % floor`);
  await refused(() => issueShipment({ no: o.no, actorCode: md.code, shipMode: "SEA", portLoading: "Laem Chabang", portDischarge: "Jakarta", etd: "2026-12-01", lines: [] }), /SHIPMENT_TOO_EARLY/, "no shipment before the customer PO");
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `SE-PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
  await recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: a.sku, qty: 4 }, { partSku: b.sku, qty: 4 }] });

  console.log("3. shipment: CI + PL; customs data required");
  const pre = await shipmentFor(o.no);
  assert(pre.shipping.lines.length === 2 && pre.shipping.lines[0].hsCode === "8504.40.90" && pre.shipping.portLoading === "Laem Chabang", "lines prefilled with HS code and origin; FOB place is the port of loading");
  const keys = pre.shipping.lines.map((l) => l.key);
  await refused(() => issueShipment({ no: o.no, actorCode: md.code, shipMode: "SEA", portLoading: "Laem Chabang", portDischarge: "Jakarta", etd: "2026-12-01", lines: [{ key: keys[0], packages: 2, netKg: 60, grossKg: 50 }] }), /SHIPMENT_INCOMPLETE:.*WEIGHT:1.*PACKAGES:2/, "gross below net and missing packages refused");
  const packing = [{ key: keys[0], packages: 2, netKg: 60, grossKg: 68 }, { key: keys[1], packages: 1, netKg: 4, grossKg: 5.5 }];
  const s1 = await issueShipment({ no: o.no, actorCode: md.code, shipMode: "SEA", portLoading: "Laem Chabang", portDischarge: "Jakarta", packageKind: "carton", marks: `SINAR\nJAKARTA\nC/NO. 1-3`, cbm: 0.42, etd: "2026-12-01", lines: packing });
  assert(/^IVTH/.test(s1.invoiceNo ?? "") && /^DNTH/.test(s1.dnNo), `CI ${s1.invoiceNo} and PL ${s1.dnNo}`);
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: s1.invoiceNo! } });
  assert(iv.currency === "USD" && Number(iv.amountDue) === 5260 && !iv.taxInvoiceId && iv.dueAt!.getTime() - iv.issuedAt.getTime() === 30 * 86_400_000, "CI: USD 5,260, no TITH, due 30 days");
  const s2 = await issueShipment({ no: o.no, actorCode: md.code, shipMode: "SEA", portLoading: "Laem Chabang", portDischarge: "Tanjung Priok", etd: "2026-12-02", vessel: "WAN HAI 305 / 112S", lines: packing });
  assert(s2.dnNo === s1.dnNo && s2.invoiceNo === s1.invoiceNo && (await prisma.invoice.count({ where: { serviceOrderId: o.id } })) === 1, "saving again updates the same DNTH; one CI");
  assert((await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).status === "IN_PROGRESS", "not accepted before the goods leave");

  console.log("4. B/L → accepted, locked, invoiced; USD payment; no TITH");
  await refused(() => confirmShipment({ no: o.no, actorCode: md.code, blNo: " ", shippedAt: "2026-12-02" }), /BL_NO/, "B/L number required");
  await confirmShipment({ no: o.no, actorCode: md.code, blNo: `WHLC0${stamp}`, shippedAt: "2026-12-02", exportEntryNo: `A0011${stamp}` });
  const done = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id }, include: { deliveries: true } });
  assert(done.status === "INVOICED" && !!done.lockedAt && done.deliveries[0].status === "SIGNED", "shipped → INVOICED and locked, the PL counts as signed by the carrier");
  await refused(() => issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code }), /EXPORT_NO_TAX_INVOICE/, "no TITH for an export");
  const pay = await recordPayment({ invoiceNo: s1.invoiceNo!, actorCode: md.code, paidAt: new Date(), paidAmount: 5260, bankRef: `TT-${stamp}` });
  assert(pay.settled && /^RCTH/.test(pay.receiptNo), `USD paid, receipt ${pay.receiptNo}`);

  console.log("5. documents");
  const qt = await buildFields(o.no, "30");
  assert(String(qt.values.DELIVERY_TERMS).startsWith("FOB Laem Chabang") && qt.values.VAT_LABEL === "0%" && qt.values.CURRENCY === "USD", "quotation: FOB Laem Chabang, VAT 0 %, USD");
  const ci = await buildFields(s1.invoiceNo!);
  assert(ci.template === "33" && (ci.values.L_HS as string[])[0] === "8504.40.90" && String(ci.values.TRANSPORT_DOC).includes("B/L WHLC0") && String(ci.values.TOTAL_WORDS_EN).length > 10, "commercial invoice: HS codes, B/L, amount in words");
  const pl = await buildFields(s1.dnNo);
  assert(pl.template === "34" && pl.values.TOTAL_PACKAGES === "3 carton" && pl.values.TOTAL_GROSS === "73.5 kg" && pl.values.INVOICE_NO === s1.invoiceNo, "packing list: 3 cartons, 73.5 kg gross, CI number");
  console.log(`\nINTL TRADE PASSED — ${o.no} · ${s1.invoiceNo} · ${s1.dnNo}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
