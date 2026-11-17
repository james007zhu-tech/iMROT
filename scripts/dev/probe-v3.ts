/**
 * 需求清单 v3 (2026-11-16), the rules that had no probe of their own:
 *   P0-06 a POTH line without a SKU whose maker's number matches a part is a suggestion — confirmed, or not received
 *   P0-07 the quote changed after the customer's PO → delivery waits until the PO is confirmed again
 *   P1-03 a machine of another customer cannot be put on an order
 *     npx tsx scripts/dev/probe-v3.ts
 */
import { prisma } from "../../src/lib/db";
import { createPurchaseOrder, createSupplier, receivePurchaseOrder } from "../../src/server/purchasing";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { issueNeeds, recordStockDoc, stockOnHand } from "../../src/server/scm";
import { issueDelivery, deliveryPlan } from "../../src/server/delivery";
import { allocateNumber } from "../../src/lib/numbering-db";

let failed = 0;
const check = (m: string, c: unknown, d = "") => { console.log(`${c ? "✓" : "✗"} ${m}${d ? ` — ${d}` : ""}`); if (!c) failed++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const tag = Date.now().toString().slice(-6);
  const mk = (name: string) => prisma.$transaction(async (tx) => tx.customer.create({ data: { code: await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id }), entityId: entity.id, name, taxId: `01055${Math.random().toString().slice(2, 10)}`, branchCode: "00000", paymentTermDays: 30 } }));
  const [c1, c2] = [await mk(`TEST v3 A ${tag}`), await mk(`TEST v3 B ${tag}`)];

  // ── P0-06
  const part = await prisma.part.create({ data: { sku: `TEST-V3-${tag}`, vendorPartNo: `V3MAKER-${tag}`, name: "TEST v3 fan", lastCost: 100 } });
  const sup = await createSupplier({ actorCode: md.code, name: `TEST v3 Supplier ${tag}` });
  const po = await createPurchaseOrder({ actorCode: md.code, supplierId: sup.id, vatRate: 0.07, lines: [{ vendorPartNo: part.vendorPartNo!, description: "TEST v3 fan", qty: 2, unitPrice: 100 }] });
  await prisma.purchaseOrder.update({ where: { id: po.id }, data: { lines: (po.lines as { partSku?: string }[]).map((l) => ({ ...l, partSku: undefined })) as never } }); // as an old POTH: no SKU on the line
  const before = await stockOnHand(part.sku);
  check("P0-06 a suggested SKU is not taken silently", /PO_LINE_SKU_UNCONFIRMED:1/.test(await msg(receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 2 }] }))));
  check("P0-06 nothing went into stock", (await stockOnHand(part.sku)) === before);
  check("P0-06 confirmed, it is received under that SKU", (await msg(receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 2 }], confirmedLines: [1] }))) === "ok" && (await stockOnHand(part.sku)) === before + 2);

  // ── P0-07
  const p2 = await prisma.part.create({ data: { sku: `TEST-V3B-${tag}`, vendorPartNo: `V3CARD-${tag}`, name: "TEST v3 memory card", lastCost: 50 } });
  await recordStockDoc({ actorCode: md.code, direction: "IN", lines: [{ partSku: p2.sku, qty: 3, unitCost: 50 }] });
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: c1.id, mode: "DOMESTIC_TRADE", requestLines: [{ sku: part.sku, qty: 1, unit: "pcs" }] });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ partSku: part.sku, description: "TEST v3 fan", qty: 1, unit: "pcs", unitPrice: 300, unitCost: 100 }] });
  await prisma.serviceOrder.update({ where: { id: o.id }, data: { status: "QUOTE_PENDING" } });
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${tag}`, poLines: await poLinesFromQuote(o.no) });
  check("P0-07 a confirmed PO cannot be confirmed twice", /PO_ALREADY_CONFIRMED/.test(await msg(confirmCustomerPo({ no: o.no, actorCode: md.code, poLines: await poLinesFromQuote(o.no) }))));
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ partSku: p2.sku, description: "TEST v3 memory card", qty: 1, unit: "pcs", unitPrice: 300, unitCost: 50 }] });
  check("P0-07 changing the goods marks the PO stale", !!(await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).poStaleAt);
  const plan0 = await deliveryPlan(o.no);
  check("P0-07 delivery is refused until the PO is confirmed again", /PO_STALE/.test(await msg(issueDelivery({ serviceOrderNo: o.no, actorCode: md.code, deliverOn: new Date(), delivered: Object.fromEntries(plan0.lines.map((l) => [l.key, l.expected])) } as never))));
  await confirmCustomerPo({ no: o.no, actorCode: md.code, poLines: await poLinesFromQuote(o.no) });
  const after = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  const plan1 = await deliveryPlan(o.no);
  check("P0-07 confirmed again: same status, the delivery lines are the memory card", !after.poStaleAt && after.status === "IN_PROGRESS" && plan1.lines.length === 1 && plan1.lines[0].partSku === p2.sku, `${after.status} ${plan1.lines.map((l) => l.description).join()}`);
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ partSku: p2.sku, description: "TEST v3 memory card", qty: 1, unit: "pcs", unitPrice: 280, unitCost: 50 }] });
  check("P0-07 a price change alone does not ask for a new PO", !(await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } })).poStaleAt);

  // ── V4-P0-10: what an order still needs from stock can always be read (the page behind 领料 crashed on a bad filter)
  { const need = await issueNeeds(o.no); check("V4-P0-10 issueNeeds answers for an order", !!need && Array.isArray(need.lines), JSON.stringify(need?.lines)); }

  // ── P1-03
  const asset = await prisma.asset.findFirst({ where: { customerId: { not: null }, status: { not: "RETIRED" } } });
  if (asset) check("P1-03 another customer's machine is refused", /ASSET_NOT_OF_CUSTOMER/.test(await msg(createServiceOrder({ createdByEmployeeCode: md.code, customerId: asset.customerId === c2.id ? c1.id : c2.id, mode: "REPAIR", assetCodes: [asset.code], faultSummary: "probe" } as never))));
  else console.log("(no asset in this database — P1-03 not probed)");

  await prisma.serviceOrder.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
