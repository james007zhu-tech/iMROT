/**
 * SCM purchasing (流程图 2026-11-07): INTH needs parts → PRTH inquiry → supplier quotes compared → costs flow back
 * into the QTTH (margin) → customer signs → POTH → goods arrive on an IBTH against the POTH.
 * PRTH and POTH can also be raised on their own (stock replenishment, parts sale) — serviceOrderNo is optional.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { totals, round2 } from "@/lib/money";
import { assertNotLocked } from "@/server/slm";
import { recomputeMargin } from "@/server/slm-docs";
import { recordStockDoc } from "@/server/scm";
import type { Prisma } from "@prisma/client";

const Att = z.object({ name: z.string(), url: z.string(), kind: z.string().optional() });

// ───────────── suppliers ─────────────
export const SupplierInput = z.object({
  name: z.string().min(1), nameLocal: z.string().optional(), taxId: z.string().optional(), branchCode: z.string().optional(),
  contactName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional(),
  currency: z.string().default("THB"), paymentTerms: z.string().optional(), leadTimeDays: z.number().int().optional(),
});
export async function createSupplier(input: z.input<typeof SupplierInput>) {
  const d = SupplierInput.parse(input);
  if (d.taxId && (await prisma.supplier.findUnique({ where: { taxId: d.taxId } }))) throw new Error(`SUPPLIER_EXISTS:${d.taxId}`);
  return prisma.supplier.create({ data: { ...d, taxId: d.taxId || undefined } });
}

// ───────────── PRTH ─────────────
export type InquiryLine = { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; assetCode?: string };
export const InquiryInput = z.object({
  actorCode: z.string(),
  serviceOrderNo: z.string().optional(),
  neededBy: z.coerce.date().optional(),
  note: z.string().optional(),
  lines: z.array(z.object({ partSku: z.string().optional(), vendorPartNo: z.string().optional(), description: z.string().min(1), qty: z.number().positive(), unit: z.string().default("pcs"), assetCode: z.string().optional() })).min(1, "INQUIRY_NEEDS_LINE"),
  attachments: z.array(Att).optional(),
});

/** Raise a PRTH. From a service order it carries the order's parts that are not in stock; or any lines by hand. */
export async function createInquiry(input: z.input<typeof InquiryInput>) {
  const d = InquiryInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { assets: true } }) : null;
  if (order) assertNotLocked(order);
  const lines: InquiryLine[] = d.lines.map((l, i) => ({ lineNo: i + 1, ...l }));
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "PR", createdByEmployeeCode: actor.code, entityId: order?.entityId ?? actor.entityId });
    const inq = await tx.purchaseInquiry.create({ data: { no, entityId: order?.entityId ?? actor.entityId, serviceOrderId: order?.id, requestedById: actor.id, neededBy: d.neededBy, note: d.note, lines: lines as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined } });
    await tx.document.create({ data: { no, type: "PR", entityId: inq.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id } });
    for (const a of order?.assets ?? []) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order!.id, sourceDocNo: no, summary: `${no} · ${lines.length} lines`, payload: { inquiry: no, lines: lines.length } as Prisma.InputJsonValue } });
    return inq;
  });
}

/** Lines a service order still needs to buy: quoted parts whose stock on hand is short. */
export async function inquiryLinesFromOrder(no: string): Promise<InquiryLine[]> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { lines: { include: { part: true }, orderBy: { lineNo: "asc" } } } });
  const out: InquiryLine[] = [];
  for (const l of o.lines) {
    if (!l.part) continue;
    const moves = await prisma.stockMovement.findMany({ where: { partId: l.part.id }, select: { direction: true, qty: true } });
    const onHand = moves.reduce((s, m) => s + (m.direction === "IN" ? 1 : -1) * Number(m.qty), 0);
    const short = Number(l.qty) - onHand;
    if (short > 0) out.push({ lineNo: out.length + 1, partSku: l.part.sku, vendorPartNo: l.part.vendorPartNo, description: l.description, qty: short, unit: l.unit, assetCode: l.assetCode ?? undefined });
  }
  return out;
}

// ───────────── supplier quotes & comparison ─────────────
export const QuoteInput = z.object({
  inquiryNo: z.string(), actorCode: z.string(), supplierId: z.string(),
  quoteNo: z.string().optional(), quoteDate: z.coerce.date().optional(), validUntil: z.coerce.date().optional(),
  currency: z.string().default("THB"), vatRate: z.number().min(0).max(1).optional(), leadTimeDays: z.number().int().optional(), paymentTerms: z.string().optional(),
  lines: z.array(z.object({ lineNo: z.number().int().positive(), vendorPartNo: z.string().optional(), description: z.string().optional(), qty: z.number().positive(), unit: z.string().optional(), unitPrice: z.number().min(0) })).min(1, "QUOTE_NEEDS_LINE"),
  attachments: z.array(Att).optional(),
});
export async function addSupplierQuote(input: z.input<typeof QuoteInput>) {
  const d = QuoteInput.parse(input);
  const inq = await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: d.inquiryNo } });
  if (inq.status === "CANCELLED" || inq.status === "ORDERED") throw new Error(`INQUIRY_CLOSED:${inq.no}`);
  const lines = d.lines.map((l) => ({ ...l, amount: round2(l.qty * l.unitPrice) }));
  const sub = round2(lines.reduce((s, l) => s + l.amount, 0));
  const total = d.vatRate != null ? round2(sub * (1 + d.vatRate)) : undefined;
  return prisma.supplierQuote.create({ data: { inquiryId: inq.id, supplierId: d.supplierId, quoteNo: d.quoteNo, quoteDate: d.quoteDate, validUntil: d.validUntil, currency: d.currency, vatRate: d.vatRate, subtotal: sub, total, leadTimeDays: d.leadTimeDays, paymentTerms: d.paymentTerms, lines: lines as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined } });
}

/** Pick the winning quote; its prices become the costs on the service order's quote lines (margin recomputed). */
export async function selectSupplierQuote(input: { inquiryNo: string; quoteId: string; actorCode: string }) {
  const inq = await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: input.inquiryNo }, include: { quotes: true, serviceOrder: { include: { lines: { include: { part: true } } } } } });
  const q = inq.quotes.find((x) => x.id === input.quoteId);
  if (!q) throw new Error("QUOTE_NOT_FOUND");
  if (inq.serviceOrder) assertNotLocked(inq.serviceOrder);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const inqLines = inq.lines as InquiryLine[];
  const qLines = q.lines as { lineNo: number; unitPrice: number }[];
  return prisma.$transaction(async (tx) => {
    await tx.supplierQuote.updateMany({ where: { inquiryId: inq.id }, data: { selected: false } });
    await tx.supplierQuote.update({ where: { id: q.id }, data: { selected: true } });
    await tx.purchaseInquiry.update({ where: { id: inq.id }, data: { status: "COMPARED" } });
    // 比价结果回流报价单: the chosen supplier price is the cost of the matching quote line (by SKU, else by description)
    if (inq.serviceOrder) {
      for (const il of inqLines) {
        const price = qLines.find((x) => x.lineNo === il.lineNo)?.unitPrice;
        if (price == null) continue;
        const target = inq.serviceOrder.lines.find((l) => (il.partSku && l.part?.sku === il.partSku) || l.description === il.description);
        if (target) await tx.quoteLine.update({ where: { id: target.id }, data: { unitCost: price } });
      }
      await recomputeMargin(tx, inq.serviceOrder.id, actor.id, inq.no);
    }
    return q;
  });
}

// ───────────── POTH ─────────────
export type PoLineIn = { partSku?: string; vendorPartNo?: string; description: string; qty: number; unit?: string; unitPrice: number };
export const PurchaseOrderInput = z.object({
  actorCode: z.string(), supplierId: z.string(),
  inquiryNo: z.string().optional(), serviceOrderNo: z.string().optional(),
  expectedAt: z.coerce.date().optional(), currency: z.string().default("THB"), vatRate: z.number().min(0).max(1).optional(),
  supplierRef: z.string().optional(), paymentTerms: z.string().optional(),
  lines: z.array(z.object({ partSku: z.string().optional(), vendorPartNo: z.string().optional(), description: z.string().min(1), qty: z.number().positive(), unit: z.string().default("pcs"), unitPrice: z.number().min(0) })).min(1, "PO_NEEDS_LINE"),
  attachments: z.array(Att).optional(),
});
export async function createPurchaseOrder(input: z.input<typeof PurchaseOrderInput>) {
  const d = PurchaseOrderInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode }, include: { entity: true } });
  const inq = d.inquiryNo ? await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: d.inquiryNo }, include: { serviceOrder: true } }) : null;
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { assets: true } }) : inq?.serviceOrder ? await prisma.serviceOrder.findUniqueOrThrow({ where: { id: inq.serviceOrder.id }, include: { assets: true } }) : null;
  if (order) assertNotLocked(order);
  const vatRate = d.vatRate ?? Number(actor.entity.vatRate);
  const t = totals(d.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })), vatRate);
  const fx = d.currency === "CNY" ? 1 : Number((await prisma.fxRate.findFirst({ where: { currency: d.currency }, orderBy: { rateDate: "desc" } }))?.rateToCny ?? 0) || undefined;
  const lines = d.lines.map((l, i) => ({ lineNo: i + 1, ...l, amount: round2(l.qty * l.unitPrice), receivedQty: 0 }));
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "PO", createdByEmployeeCode: actor.code, entityId: order?.entityId ?? actor.entityId });
    const po = await tx.purchaseOrder.create({ data: { no, entityId: order?.entityId ?? actor.entityId, supplierId: d.supplierId, inquiryId: inq?.id, serviceOrderId: order?.id, expectedAt: d.expectedAt, currency: d.currency, fxRateToCny: fx, subtotal: t.subtotal, vatRate, vatAmount: t.vatAmount, total: t.total, totalCny: fx ? round2(t.total * fx) : undefined, supplierRef: d.supplierRef, paymentTerms: d.paymentTerms, lines: lines as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined, createdById: actor.id } });
    await tx.document.create({ data: { no, type: "PO", entityId: po.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id } });
    if (inq) await tx.purchaseInquiry.update({ where: { id: inq.id }, data: { status: "ORDERED" } });
    for (const a of order?.assets ?? []) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order!.id, sourceDocNo: no, summary: `${no} · ${d.currency} ${t.total.toFixed(2)}`, payload: { purchaseOrder: no, total: t.total } as Prisma.InputJsonValue } });
    return po;
  });
}

/** 客户回签 → 按 PRTH 生成 POTH: one draft POTH per compared inquiry of the order (from its selected quote). */
export async function raisePurchaseOrdersForOrder(no: string, actorCode: string) {
  const inqs = await prisma.purchaseInquiry.findMany({ where: { serviceOrder: { no }, status: "COMPARED" }, include: { quotes: { where: { selected: true }, include: { supplier: true } } } });
  const made: string[] = [];
  for (const inq of inqs) {
    const q = inq.quotes[0];
    if (!q) continue;
    const il = inq.lines as InquiryLine[];
    const lines = (q.lines as { lineNo: number; vendorPartNo?: string; description?: string; qty: number; unit?: string; unitPrice: number }[]).map((l) => { const src = il.find((x) => x.lineNo === l.lineNo); return { partSku: src?.partSku, vendorPartNo: l.vendorPartNo ?? src?.vendorPartNo, description: l.description ?? src?.description ?? "", qty: l.qty, unit: l.unit ?? src?.unit ?? "pcs", unitPrice: l.unitPrice }; });
    const po = await createPurchaseOrder({ actorCode, supplierId: q.supplierId, inquiryNo: inq.no, currency: q.currency, vatRate: q.vatRate != null ? Number(q.vatRate) : undefined, paymentTerms: q.paymentTerms ?? undefined, supplierRef: q.quoteNo ?? undefined, lines });
    made.push(po.no);
  }
  return made;
}

/** Goods arrived: one IBTH (one or more lines) against the POTH; the PO goes PARTIAL or RECEIVED. */
export async function receivePurchaseOrder(input: { poNo: string; actorCode: string; supplierRef?: string; movedAt?: Date; received: { lineNo: number; qty: number; batch?: string }[]; attachments?: { name: string; url: string; kind?: string }[] }) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no: input.poNo }, include: { serviceOrder: true } });
  if (po.status === "CANCELLED" || po.status === "RECEIVED") throw new Error(`PO_CLOSED:${po.no}`);
  const lines = po.lines as { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; unitPrice: number; receivedQty: number }[];
  const take = input.received.filter((r) => r.qty > 0);
  if (!take.length) throw new Error("RECEIPT_EMPTY");
  for (const r of take) {
    const l = lines.find((x) => x.lineNo === r.lineNo);
    if (!l) throw new Error(`PO_LINE_NOT_FOUND:${r.lineNo}`);
    if (!l.partSku) throw new Error(`PO_LINE_NO_SKU:${r.lineNo}`); // parts must exist as SKUs before they can be stocked
    if (r.qty > l.qty - l.receivedQty + 1e-9) throw new Error(`RECEIPT_OVER:${r.lineNo}`);
  }
  const ib = await recordStockDoc({ actorCode: input.actorCode, direction: "IN", serviceOrderNo: po.serviceOrder?.no, supplierRef: input.supplierRef ?? po.supplierRef ?? undefined, costCurrency: po.currency, movedAt: input.movedAt, lines: take.map((r) => { const l = lines.find((x) => x.lineNo === r.lineNo)!; return { partSku: l.partSku!, qty: r.qty, batch: r.batch, unitCost: l.unitPrice }; }) });
  const updatedLines = lines.map((l) => { const r = take.find((x) => x.lineNo === l.lineNo); return r ? { ...l, receivedQty: round2(l.receivedQty + r.qty) } : l; });
  const complete = updatedLines.every((l) => l.receivedQty + 1e-9 >= l.qty);
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.updateMany({ where: { no: ib.no }, data: { purchaseOrderId: po.id } });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { lines: updatedLines as unknown as Prisma.InputJsonValue, status: complete ? "RECEIVED" : "PARTIAL", attachments: input.attachments?.length ? ([...((po.attachments as unknown[] | null) ?? []), ...input.attachments] as Prisma.InputJsonValue) : undefined } });
  });
  return { ibthNo: ib.no, status: complete ? "RECEIVED" : "PARTIAL" };
}
