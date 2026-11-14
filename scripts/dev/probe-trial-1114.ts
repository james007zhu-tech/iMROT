/**
 * Trial findings of 2026-11-14, each pinned so it stays fixed:
 *   1. a purchase order carrying the maker's own part number is received against the library's brand-prefixed SKU;
 *   2. a maintenance order is accepted on its PMTH without an INTH, and an INTH after the work is refused;
 *   3. nothing is issued or delivered beyond the stock, and the same goods bought twice for one order are refused.
 * Leaves its customer, parts and orders in the trial data like the other probes.  npx tsx scripts/dev/probe-trial-1114.ts
 */
import { prisma } from "../../src/lib/db";
import { allocateNumber } from "../../src/lib/numbering-db";
import { onboardAsset } from "../../src/server/alm";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { createInspection, createRepairJob, missingForAcceptance, setQuoteLines } from "../../src/server/slm-docs";
import { recordStockDoc, resolveParts, stockOnHand } from "../../src/server/scm";
import { createPurchaseOrder, receivePurchaseOrder } from "../../src/server/purchasing";
import { deliveryPlan, issueDelivery } from "../../src/server/delivery";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return ""; } catch (e) { return (e as Error).message.split("\n")[0]; } };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: process.env.PROBE_ACTOR ?? "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Trial 1114 Co ${stamp}`, taxId: `01088${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true, isPartner: false } });
  const oem = `6SL3210-${stamp}`;
  const part = await prisma.part.create({ data: { sku: `SIE-${oem}`, vendorPartNo: oem, name: "SINAMICS G120 PM240-2", lastCost: 30000 } });

  // ── 1. the maker's number finds the brand-prefixed SKU
  const r = await resolveParts([oem, ` ${oem.toLowerCase()} `, part.sku, "NO-SUCH-PART"]);
  check("a part is found by the maker's number, in any case and spacing, and by its SKU", r.found.get(oem)?.sku === part.sku && r.found.get(oem.toLowerCase())?.sku === part.sku && r.found.get(part.sku)?.sku === part.sku && r.unknown.join() === "NO-SUCH-PART", r.unknown.join());

  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "DOMESTIC_TRADE", customerRef: `RFQ-${stamp}`, requestLines: [{ sku: part.sku, description: part.name, qty: 3, unit: "pcs" }] });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ partSku: part.sku, description: part.name, qty: 3, unit: "pcs", unitPrice: 38000, unitCost: 30000 }] });
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
  const auto = await prisma.purchaseOrder.findMany({ where: { serviceOrderId: o.id, status: { not: "CANCELLED" } } });
  // the buyer types the maker's number on the POTH, as the supplier's quotation shows it — two of the three arrive first
  const line = { vendorPartNo: oem, description: part.name, qty: 3, unit: "pcs", unitPrice: 30000 };
  const po = auto[0] ?? await createPurchaseOrder({ actorCode: md.code, supplierId: supplier.id, serviceOrderNo: o.no, lines: [line] });
  if (auto[0]) await prisma.purchaseOrder.update({ where: { id: po.id }, data: { lines: [{ lineNo: 1, ...line, amount: 90000, receivedQty: 0 }] } });
  const got = await receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 2 }] });
  const after = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: po.id } });
  check("a POTH line with the maker's number is received into the library's SKU", /^IBTH/.test(got.ibthNo) && (await stockOnHand(part.sku)) === 2 && (after.lines as { partSku?: string }[])[0].partSku === part.sku, `${got.ibthNo} · on hand ${await stockOnHand(part.sku)} · line now ${(after.lines as { partSku?: string }[])[0].partSku}`);

  // ── 3. stock and repeated purchases
  const again = await refused(() => createPurchaseOrder({ actorCode: md.code, supplierId: supplier.id, serviceOrderNo: o.no, lines: [line] }));
  check("the same goods on a second POTH for the order are refused", again.startsWith("PO_REPEAT"), again.slice(0, 90));
  const extra = await createPurchaseOrder({ actorCode: md.code, supplierId: supplier.id, serviceOrderNo: o.no, lines: [{ ...line, qty: 1 }], allowRepeat: true });
  check("…unless the buyer says they want it", /^POTH/.test(extra.no), extra.no);
  await prisma.purchaseOrder.update({ where: { id: extra.id }, data: { status: "CANCELLED" } });

  const plan = await deliveryPlan(o.no);
  const all = Object.fromEntries(plan.lines.map((l) => [l.key, l.expected - l.deliveredBefore]));
  const over = await refused(() => issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all }));
  check("three cannot be delivered with two in stock", over.startsWith("DELIVERY_NO_STOCK") && over.includes("3/2"), over);
  const forced = await refused(() => issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all, overrideReason: "customer insists" }));
  check("…and no reason overrides it", forced.startsWith("DELIVERY_NO_STOCK"), forced.slice(0, 40));
  const outOver = await refused(() => recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: oem, qty: 3 }] }));
  check("three cannot be issued from the store with two in it", outOver.startsWith("STOCK_SHORT") && outOver.includes("3/2"), outOver);
  await recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: oem, qty: 2 }] });
  const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), partial: true, delivered: Object.fromEntries(plan.lines.map((l) => [l.key, Math.min(2, l.expected)])) });
  check("the two that exist go out on a partial DNTH", /^DNTH/.test(dn.no) && dn.status === "ISSUED", dn.no);
  await receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 1 }] });
  const rest = await deliveryPlan(o.no);
  await recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: part.sku, qty: 1 }] });
  const dn2 = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: Object.fromEntries(rest.lines.map((l) => [l.key, l.expected - l.deliveredBefore])) });
  check("the third follows once it has been received", /^DNTH/.test(dn2.no), dn2.no);

  // ── 2. maintenance: accepted on the PMTH; an INTH after the work is refused
  const vfd = await onboardAsset({ createdByEmployeeCode: md.code, type: "VFD", serialNumber: `T1114-${stamp}`, customerId: customer.id, origin: "TAKEOVER" });
  const m = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, assetCodes: [vfd.code], mode: "MAINTENANCE", reportedSymptom: "annual PM" });
  check("before the work, a maintenance order waits for its PMTH, not for an INTH", (await missingForAcceptance(m.no)).join() === "PMTH", (await missingForAcceptance(m.no)).join());
  await setQuoteLines({ serviceOrderNo: m.no, actorCode: md.code, lines: [{ description: "Annual preventive maintenance", qty: 1, unit: "job", unitPrice: 8000, unitCost: 3000 }] });
  await confirmCustomerPo({ no: m.no, actorCode: md.code, customerRef: `PM-${stamp}`, poLines: await poLinesFromQuote(m.no) });
  await createRepairJob({ serviceOrderNo: m.no, assetCode: vfd.code, engineerCode: md.code, kind: "MAINTENANCE", location: "SITE", confirmedFault: "", workPerformed: "cleaned, retightened, fans checked", finishedAt: new Date() });
  check("with the PMTH and no INTH, nothing is missing for acceptance", (await missingForAcceptance(m.no)).length === 0, (await missingForAcceptance(m.no)).join() || "nothing missing");
  const late = await refused(() => createInspection({ serviceOrderNo: m.no, assetCode: vfd.code, engineerCode: md.code, findings: "after the fact" }));
  check("an INTH after the PMTH is refused", late.startsWith("INSPECTION_AFTER_WORK"), late);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
