/**
 * 国际贸易 — the shipment step (flow 国际贸易-流程图-v1, 2026-11-09). After the goods are issued from stock (OBTH):
 *  0. issueProforma (at the customer's PO): the PFTH proforma invoice (template 35) — the order's only invoice.
 *  1. issueShipment: the packing data → one DNTH (packing list, template 34). For customs the same PFTH prints as a
 *     commercial invoice (template 33, same number and amounts, now with HS codes, weights and transport). Saving
 *     again before departure updates the same DNTH.
 *  2. confirmShipment: the B/L or AWB number and the actual departure. The carrier's document stands in for the
 *     customer's signature: the DNTH is signed, the order is accepted and locked (signDelivery, as for every trade
 *     order) and moves to INVOICED, because the PFTH already exists. Payment and "project complete" follow as usual.
 * No TITH and no IVTH for an export (src/lib/export.ts — the accountant confirms).
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { audit } from "@/server/audit";
import { deliveryPlan, signDelivery } from "@/server/delivery";
import { assertNotLocked, progressOrder } from "@/server/slm";
import { EXPORT_DOC_KINDS, exportCloseBlockers, SHIP_MODES, shipmentProblems, shippedProblems, shipTotals, transportDoc, type ShipLine, type Shipping, type TradeTerms } from "@/lib/export";
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
  const ci = o.documents.find((d) => d.type === "PF" && !d.voidedAt); // the proforma invoice issued with the customer's PO
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
  return { dn: null, invoiceNo: ci?.no ?? null, terms, shipping: { shipMode: terms?.shipMode ?? "SEA", portLoading: terms?.incoterm?.startsWith("F") || terms?.incoterm === "EXW" ? terms.place : "", portDischarge: terms?.destPort ?? "", packageKind: "carton", etd: "", lines: shipLines } };
}

/** Packing data per line; a field left out keeps what the shipment (or the inquiry line) already says. */
const LineIn = z.object({ key: z.string(), hsCode: z.string().optional(), origin: z.string().optional(), packages: z.coerce.number().optional(), netKg: z.coerce.number().optional(), grossKg: z.coerce.number().optional() });
export const ShipmentInput = z.object({
  no: z.string(), actorCode: z.string(),
  shipMode: z.enum(SHIP_MODES), portLoading: z.string(), portDischarge: z.string(), packageKind: z.string().default("carton"),
  marks: z.string().optional(), cbm: z.coerce.number().optional(), forwarder: z.string().optional(), vessel: z.string().optional(),
  etd: z.string(), eta: z.string().optional(), lines: z.array(LineIn),
});

/**
 * 形式发票 PFI (朱总 2026-11-10): the export order's invoice is a proforma invoice, PFTH, issued when the customer's PO
 * is confirmed — the whole quote in the order currency, VAT 0 %, due `paymentDays` later. The customer pays against it
 * (advance T/T, L/C); payments and the receipt hang on it like on any invoice. Idempotent.
 */
export async function issueProforma(no: string, actorCode: string): Promise<string> {
  const o = await intlOrder(no);
  const had = o.documents.find((d) => d.type === "PF" && !d.voidedAt);
  if (had) return had.no;
  if (!o.lines.length || o.total == null) throw new Error("QUOTE_NEEDS_LINE");
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const terms = o.tradeTerms as unknown as TradeTerms;
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const pfNo = await allocateNumber(tx, { prefix: "PF", createdByEmployeeCode: actor.code, entityId: o.entityId, date: now });
    await tx.invoice.create({ data: { no: pfNo, serviceOrderId: o.id, issuedAt: now, dueAt: new Date(now.getTime() + (terms?.paymentDays ?? 0) * 86_400_000), currency: o.currency, amountDue: Number(o.total) } });
    await tx.document.create({ data: { no: pfNo, type: "PF", entityId: o.entityId, countryCode: pfNo.slice(2, 4), customerId: o.customerId, serviceOrderId: o.id, createdById: actor.id, templateCode: "35", issuedAt: now } });
    await audit(actor.id, "PROFORMA_ISSUE", pfNo, { order: o.no, total: Number(o.total), currency: o.currency }, tx);
    return pfNo;
  });
}

/** PL (DNTH, template 34) for the whole order, or an update of the packing data before departure. The invoice is the PFTH. */
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
    const ivNo = current.invoiceNo; // the PFTH — issued with the customer's PO, nothing new is invoiced at shipment
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

/** 出口单证: add the uploaded copies (packing list, B/L, export entry, proof of delivery) to the order. Allowed on a locked order — they are evidence, not terms. */
export async function addExportDocs(input: { no: string; actorCode: string; kind: string; files: { name: string; url: string }[] }) {
  if (!(EXPORT_DOC_KINDS as readonly string[]).includes(input.kind)) throw new Error(`BAD_EXPORT_DOC:${input.kind}`);
  if (!input.files.length) throw new Error("FILE_REQUIRED");
  const o = await intlOrder(input.no);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const merged = [...((o.attachments as { name: string; url: string; kind: string }[] | null) ?? []), ...input.files.map((f) => ({ ...f, kind: input.kind }))];
  await prisma.serviceOrder.update({ where: { id: o.id }, data: { attachments: merged as unknown as Prisma.InputJsonValue } });
  await audit(actor.id, "EXPORT_DOC_ADD", o.no, { kind: input.kind, files: input.files.map((f) => f.name) });
  return merged.length;
}

/** What still stops "project complete" on this export order (src/lib/export.ts). */
export async function exportBlockersOf(no: string): Promise<string[]> {
  const o = await intlOrder(no);
  return exportCloseBlockers({ incoterm: (o.tradeTerms as unknown as TradeTerms | null)?.incoterm, shipped: o.deliveries.some((d) => d.status === "SIGNED" && d.shipping), unpaid: o.invoices.filter((i) => !i.paidAt && !i.cancelledAt).length, attachments: o.attachments as { kind?: string }[] | null });
}
