/**
 * 国际贸易 — the shipment step (flow 国际贸易-流程图-v1, 2026-11-09). After the goods are issued from stock (OBTH):
 *  1. issueShipment: the packing data → one DNTH (packing list, template 34) and the commercial invoice → one IVTH
 *     (template 33, the order's currency, VAT 0 %) in one transaction. Customs and the forwarder work from these two,
 *     so the numbers exist before the export entry. Saving again before departure updates the same DNTH; the CI stays.
 *  2. confirmShipment: the B/L or AWB number and the actual departure. The carrier's document stands in for the
 *     customer's signature: the DNTH is signed, the order is accepted and locked (signDelivery, as for every trade
 *     order) and moves to INVOICED, because the CI already exists. Payment and "project complete" follow as usual.
 * No TITH for an export (src/lib/export.ts — the accountant confirms).
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { audit } from "@/server/audit";
import { deliveryPlan, signDelivery } from "@/server/delivery";
import { assertNotLocked, progressOrder } from "@/server/slm";
import { SHIP_MODES, shipmentProblems, shippedProblems, shipTotals, transportDoc, type ShipLine, type Shipping, type TradeTerms } from "@/lib/export";
import type { RequestLine } from "@/lib/modes";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function intlOrder(no: string) {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { lines: { orderBy: { lineNo: "asc" }, include: { part: { select: { sku: true } } } }, deliveries: { orderBy: { createdAt: "asc" } }, invoices: true, documents: true } });
  if (o.mode !== "INTERNATIONAL_TRADE") throw new Error(`NOT_INTL_TRADE:${no}`);
  return o;
}

/** The shipment of this order: the saved one, or lines prefilled from the PO, the quote prices and the inquiry's HS codes. */
export async function shipmentFor(no: string): Promise<{ dn: { no: string; status: string } | null; invoiceNo: string | null; shipping: Shipping; terms: TradeTerms }> {
  const o = await intlOrder(no);
  const terms = o.tradeTerms as unknown as TradeTerms;
  const dn = o.deliveries.find((d) => d.status !== "DRAFT" && d.shipping) ?? null;
  const ci = o.documents.find((d) => d.type === "IV" && d.templateCode === "33" && !d.voidedAt);
  if (dn) return { dn: { no: dn.no, status: dn.status }, invoiceNo: ci?.no ?? null, shipping: dn.shipping as unknown as Shipping, terms };
  const { lines } = await deliveryPlan(no);
  const asked = (o.requestLines as RequestLine[] | null) ?? [];
  const goods = lines.filter((l) => l.kind === "PO" && !l.isService);
  const shipLines: ShipLine[] = goods.map((l, i) => {
    const q = o.lines.find((x) => x.lineNo === l.poLineNo) ?? o.lines.find((x) => x.description === l.description);
    const r = asked.find((x) => x.sku && x.sku === (l.partSku ?? q?.part?.sku)) ?? asked[i];
    const qty = Math.max(0, l.expected - l.deliveredBefore), unitPrice = Number(q?.unitPrice ?? 0);
    return { key: l.key, lineNo: l.poLineNo ?? i + 1, sku: l.partSku ?? q?.part?.sku, description: l.description, hsCode: r?.hsCode ?? "", origin: r?.origin ?? "", qty, unit: q?.unit ?? "pcs", packages: 0, netKg: 0, grossKg: 0, unitPrice, amount: r2(qty * unitPrice) };
  });
  return { dn: null, invoiceNo: null, terms, shipping: { shipMode: terms?.shipMode ?? "SEA", portLoading: terms?.incoterm?.startsWith("F") || terms?.incoterm === "EXW" ? terms.place : "", portDischarge: terms?.destPort ?? "", packageKind: "carton", etd: "", lines: shipLines } };
}

/** Packing data per line; a field left out keeps what the shipment (or the inquiry line) already says. */
const LineIn = z.object({ key: z.string(), hsCode: z.string().optional(), origin: z.string().optional(), packages: z.coerce.number().optional(), netKg: z.coerce.number().optional(), grossKg: z.coerce.number().optional() });
export const ShipmentInput = z.object({
  no: z.string(), actorCode: z.string(),
  shipMode: z.enum(SHIP_MODES), portLoading: z.string(), portDischarge: z.string(), packageKind: z.string().default("carton"),
  marks: z.string().optional(), cbm: z.coerce.number().optional(), forwarder: z.string().optional(), vessel: z.string().optional(),
  etd: z.string(), eta: z.string().optional(), lines: z.array(LineIn),
});

/** CI (IVTH, template 33) + PL (DNTH, template 34) for the whole order, or an update of the packing data before departure. */
export async function issueShipment(input: z.input<typeof ShipmentInput>) {
  const d = ShipmentInput.parse(input);
  const o = await intlOrder(d.no);
  assertNotLocked(o);
  if (!["IN_PROGRESS", "ACCEPTANCE_PENDING"].includes(o.status)) throw new Error(`SHIPMENT_TOO_EARLY:${o.status}`);
  if (!o.lines.length || o.total == null) throw new Error("QUOTE_NEEDS_LINE");
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const current = await shipmentFor(d.no);
  if (current.dn?.status === "SIGNED") throw new Error(`SHIPMENT_DONE:${current.dn.no}`);
  // only the packing data comes from the form; SKU, description, quantity and price come from the PO and the quote
  const lines: ShipLine[] = current.shipping.lines.map((l) => {
    const f = d.lines.find((x) => x.key === l.key);
    return { ...l, hsCode: (f?.hsCode ?? l.hsCode).trim(), origin: (f?.origin ?? l.origin).trim().toUpperCase(), packages: f?.packages ?? l.packages, netKg: f?.netKg ?? l.netKg, grossKg: f?.grossKg ?? l.grossKg };
  });
  const shipping: Shipping = { ...current.shipping, shipMode: d.shipMode, portLoading: d.portLoading.trim(), portDischarge: d.portDischarge.trim(), packageKind: d.packageKind.trim() || "carton",
    marks: d.marks?.trim() || undefined, cbm: d.cbm || undefined, forwarder: d.forwarder?.trim() || undefined, vessel: d.vessel?.trim() || undefined, etd: d.etd, eta: d.eta || undefined, lines };
  const problems = shipmentProblems(shipping);
  if (problems.length) throw new Error(`SHIPMENT_INCOMPLETE:${problems.join(",")}`);
  const etd = new Date(`${d.etd}T00:00:00Z`);
  const terms = current.terms;

  return prisma.$transaction(async (tx) => {
    if (current.dn) {
      const dn = await tx.deliveryNote.update({ where: { no: current.dn.no }, data: { shipping: shipping as unknown as Prisma.InputJsonValue, deliverOn: etd } });
      await audit(actor.id, "SHIPMENT_UPDATE", dn.no, { totals: shipTotals(lines) }, tx);
      return { dnNo: dn.no, invoiceNo: current.invoiceNo };
    }
    const { lines: plan } = await deliveryPlan(o.no);
    const dnNo = await allocateNumber(tx, { prefix: "DN", createdByEmployeeCode: actor.code, entityId: o.entityId, date: etd });
    await tx.deliveryNote.create({ data: {
      no: dnNo, serviceOrderId: o.id, status: "ISSUED", deliverOn: etd, plantId: o.plantId,
      address: [shipping.portDischarge, terms.destCountry].filter(Boolean).join(", "),
      lines: plan.map((l) => ({ ...l, delivered: l.kind === "PO" && !l.isService ? Math.max(0, l.expected - l.deliveredBefore) : 0 })) as unknown as Prisma.InputJsonValue,
      shipping: shipping as unknown as Prisma.InputJsonValue,
    } });
    await tx.document.create({ data: { no: dnNo, type: "DN", entityId: o.entityId, countryCode: dnNo.slice(2, 4), customerId: o.customerId, serviceOrderId: o.id, createdById: actor.id, templateCode: "34" } });
    // the commercial invoice: the whole quote (freight or insurance lines of a CIF/CIP quote included), VAT 0 %
    let ivNo = current.invoiceNo;
    if (!ivNo) {
      const now = new Date();
      ivNo = await allocateNumber(tx, { prefix: "IV", createdByEmployeeCode: actor.code, entityId: o.entityId, date: now });
      await tx.invoice.create({ data: { no: ivNo, serviceOrderId: o.id, issuedAt: now, dueAt: new Date(now.getTime() + (terms.paymentDays ?? 0) * 86_400_000), currency: o.currency, amountDue: Number(o.total) } });
      await tx.document.create({ data: { no: ivNo, type: "IV", entityId: o.entityId, countryCode: ivNo.slice(2, 4), customerId: o.customerId, serviceOrderId: o.id, createdById: actor.id, templateCode: "33", issuedAt: now } });
    }
    await audit(actor.id, "SHIPMENT_ISSUE", dnNo, { invoiceNo: ivNo, totals: shipTotals(lines), incoterm: terms.incoterm }, tx);
    return { dnNo, invoiceNo: ivNo };
  });
}

export const ShippedInput = z.object({
  no: z.string(), actorCode: z.string(), blNo: z.string(), shippedAt: z.string(), vessel: z.string().optional(), exportEntryNo: z.string().optional(), eta: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).optional(),
});

/** The goods left: B/L or AWB and the departure date. Signs the DNTH for the carrier, accepts and locks the order. */
export async function confirmShipment(input: z.input<typeof ShippedInput>) {
  const d = ShippedInput.parse(input);
  const cur = await shipmentFor(d.no);
  if (!cur.dn) throw new Error("SHIPMENT_NOT_ISSUED");
  if (cur.dn.status === "SIGNED") throw new Error(`SHIPMENT_DONE:${cur.dn.no}`);
  const shipping: Shipping = { ...cur.shipping, blNo: d.blNo.trim(), shippedAt: d.shippedAt, vessel: d.vessel?.trim() || cur.shipping.vessel, exportEntryNo: d.exportEntryNo?.trim() || cur.shipping.exportEntryNo, eta: d.eta || cur.shipping.eta };
  const missing = shippedProblems(shipping);
  if (missing.length) throw new Error(`SHIPMENT_INCOMPLETE:${missing.join(",")}`);
  const at = new Date(`${d.shippedAt}T00:00:00Z`);
  await prisma.deliveryNote.update({ where: { no: cur.dn.no }, data: { shipping: shipping as unknown as Prisma.InputJsonValue } });
  await signDelivery({ no: cur.dn.no, actorCode: d.actorCode, signedBy: `${transportDoc(shipping.shipMode)} ${shipping.blNo}${shipping.vessel ? `\n${shipping.vessel}` : ""}`, signedAt: at, attachments: (d.attachments ?? []).map((a) => ({ ...a, kind: a.kind ?? "SHIPPING" })) });
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.no } });
  if (o.status === "ACCEPTED") {
    const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
    await prisma.$transaction((tx) => progressOrder(tx, o, "INVOICED", actor.id, cur.dn!.no));
  }
  return { dnNo: cur.dn.no, blNo: shipping.blNo };
}
