/**
 * Second round of trial findings, 2026-11-14, each pinned so it stays fixed:
 *   1. goods bought for one trade order, whose customer PO line carries no part number, are still checked against the
 *      store at delivery; the delivery takes them out of the store, so the next order sees what is really left;
 *   2. a model the library does not have is created while the machine is filed, with its brand and series.
 * Leaves its data in the trial database like the other probes.  npx tsx scripts/dev/probe-trial-1114b.ts
 */
import { prisma } from "../../src/lib/db";
import { allocateNumber } from "../../src/lib/numbering-db";
import { ensureModel } from "../../src/server/alm";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { stockOnHand } from "../../src/server/scm";
import { createPurchaseOrder, receivePurchaseOrder } from "../../src/server/purchasing";
import { deliveryPlan, issueDelivery } from "../../src/server/delivery";
import { normalizeNumber } from "../../src/lib/recognize";
import { localIso } from "../../src/lib/dates";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return ""; } catch (e) { return (e as Error).message.split("\n")[0]; } };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: process.env.PROBE_ACTOR ?? "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Trial 1114b Co ${stamp}`, taxId: `01077${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const supplier = await prisma.supplier.findFirstOrThrow({ where: { active: true, isPartner: false } });
  const all = (lines: { key: string; expected: number; deliveredBefore: number }[], cap = Infinity) => Object.fromEntries(lines.map((l) => [l.key, Math.min(cap, l.expected - l.deliveredBefore)]));

  // ── 1. the customer's PO is read in before the part exists: no part number on the line, a plain description
  const mk = async (qty: number) => {
    const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "DOMESTIC_TRADE", customerRef: `RFQ-${stamp}`, requestLines: [{ description: "Power Module PM240-2 4kW", qty, unit: "pcs" }] });
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ description: "Power Module PM240-2 4kW", qty, unit: "pcs", unitPrice: 38000, unitCost: 30000 }] });
    await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
    return o;
  };
  const o = await mk(3);
  const plan0 = await deliveryPlan(o.no);
  check("the customer's PO line carries no part number", plan0.lines.filter((l) => l.kind === "PO").every((l) => !l.partSku));
  const none = await refused(() => issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all(plan0.lines) }));
  check("goods that match no part in the store cannot be delivered", none.startsWith("DELIVERY_NO_PART"), none.slice(0, 70));

  // the part is created only now, when the goods are bought for this order; two of the three arrive
  const oem = `6SL3210-1PE21-${stamp}`;
  const part = await prisma.part.create({ data: { sku: `SIE-${oem}`, vendorPartNo: oem, name: "SINAMICS PM240-2", lastCost: 30000 } });
  for (const p of await prisma.purchaseOrder.findMany({ where: { serviceOrderId: o.id } })) await prisma.purchaseOrder.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
  const po = await createPurchaseOrder({ actorCode: md.code, supplierId: supplier.id, serviceOrderNo: o.no, lines: [{ vendorPartNo: oem, description: "PM240-2", qty: 3, unit: "pcs", unitPrice: 30000 }] });
  await receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 2 }] });
  const plan = await deliveryPlan(o.no);
  const over = await refused(() => issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all(plan.lines) }));
  check("three cannot be delivered with two received, though the PO line has no part number", over.startsWith("DELIVERY_NO_STOCK") && over.includes(`${part.sku} 3/2`), over);
  const dn = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), partial: true, delivered: all(plan.lines, 2) });
  const out = await prisma.stockMovement.findMany({ where: { serviceOrderId: o.id, direction: "OUT" } });
  check("the two that exist go out, and the delivery takes them out of the store", /^DNTH/.test(dn.no) && out.length === 1 && Number(out[0].qty) === 2 && /^OBTH/.test(out[0].no) && (await stockOnHand(part.sku)) === 0, `${dn.no} · ${out[0]?.no} · on hand ${await stockOnHand(part.sku)}`);
  check("the note remembers which part it delivered", (dn.lines as { partSku?: string; delivered: number }[]).some((l) => l.partSku === part.sku && l.delivered === 2));

  // another order for the same goods sees an empty store
  const o2 = await mk(1);
  for (const p of await prisma.purchaseOrder.findMany({ where: { serviceOrderId: o2.id } })) await prisma.purchaseOrder.update({ where: { id: p.id }, data: { status: "CANCELLED" } });
  await prisma.serviceOrder.update({ where: { id: o2.id }, data: { poLines: (await deliveryPlan(o2.no)).lines.filter((l) => l.kind === "PO").map((l) => ({ lineNo: l.poLineNo, description: l.description, qty: l.expected, unit: "pcs", isService: false, partSku: oem })) } });
  const other = await refused(async () => { const p2 = await deliveryPlan(o2.no); return issueDelivery({ serviceOrderNo: o2.no, actorCode: md.code, deliverOn: new Date(), delivered: all(p2.lines) }); });
  check("a second order cannot deliver what the first one already took", other.startsWith("DELIVERY_NO_STOCK") && other.includes("1/0"), other);

  // the third arrives and follows; nothing is taken out twice
  await receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 1 }] });
  const rest = await deliveryPlan(o.no);
  const dn2 = await issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: all(rest.lines) });
  const outAll = await prisma.stockMovement.aggregate({ _sum: { qty: true }, where: { serviceOrderId: o.id, direction: "OUT" } });
  check("the third follows once received; three left the store in all", /^DNTH/.test(dn2.no) && Number(outAll._sum.qty) === 3 && (await stockOnHand(part.sku)) === 0, `${dn2.no} · out ${outAll._sum.qty}`);

  // ── 2. a new model while filing a machine
  const brandName = `Probe Drives ${stamp}`;
  const a = await ensureModel({ brand: brandName, series: `PD ${stamp} Series`, modelCode: `PD-${stamp}-4K0`, assetType: "VFD", ratedPowerKw: 4, ratedVoltageV: 400, ratedCurrentA: 9, actorId: md.id });
  check("a model the library does not have is created with its brand and series", a.created && a.model.series.brand.name === brandName.toUpperCase() && Number(a.model.ratedPowerKw) === 4, `${a.model.series.brand.code} / ${a.model.series.code} / ${a.model.code}`);
  const b = await ensureModel({ brand: brandName.toLowerCase(), series: `pd ${stamp} series`, modelCode: `PD-${stamp}-7K5` });
  check("a second model of the same brand and series joins them, whatever the case typed", b.created && b.model.seriesId === a.model.seriesId);
  const c = await ensureModel({ brand: "", series: "", modelCode: `pd-${stamp}-4k0` });
  check("a known model is simply found", !c.created && c.model.id === a.model.id);
  const d = await refused(() => ensureModel({ brand: "", series: "", modelCode: `PD-${stamp}-NEW` }));
  check("a new model without brand and series is asked for them", d.startsWith("MODEL_NEEDS_BRAND_SERIES"), d);

  // ── 3. small ones
  check('"2x4.0 kW" reads as 4, not 24', normalizeNumber("2x4.0 kW", "ratedPowerKw") === "4" && normalizeNumber("4.0 kW", "ratedPowerKw") === "4" && normalizeNumber("1,234.5") === "1234.5");
  check("times are written as the local clock shows them", localIso(new Date(2026, 10, 14, 9, 5, 7)) === "2026-11-14T09:05:07");

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
