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
import { recomputeMargin, partnerCostByAsset } from "@/server/slm-docs";
import { paymentTermsText } from "@/lib/srm";
import { findPart, normPartNo, recordStockDoc, resolveParts } from "@/server/scm";
import type { Prisma } from "@prisma/client";

const Att = z.object({ name: z.string(), url: z.string(), kind: z.string().optional() });

// ───────────── suppliers ─────────────
export const SupplierInput = z.object({
  name: z.string().min(1), nameLocal: z.string().optional(), taxId: z.string().optional(), branchCode: z.string().optional(),
  contactName: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), address: z.string().optional(),
  currency: z.string().default("THB"), paymentTerms: z.string().optional(), leadTimeDays: z.number().int().optional(),
});
export async function createSupplier(input: z.input<typeof SupplierInput> & { actorCode: string }) {
  const { actorCode, ...rest } = input;
  const d = SupplierInput.parse(rest);
  if (d.taxId && (await prisma.supplier.findUnique({ where: { taxId: d.taxId } }))) throw new Error(`SUPPLIER_EXISTS:${d.taxId}`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  return prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "S", createdByEmployeeCode: actor.code, entityId: actor.entityId });
    return tx.supplier.create({ data: { ...d, code, entityId: actor.entityId, taxId: d.taxId || undefined } });
  });
}

// ───────────── PRTH ─────────────
export type InquiryLine = { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; assetCode?: string };
export const InquiryInput = z.object({
  actorCode: z.string(),
  kind: z.enum(["PARTS", "SUBCONTRACT"]).default("PARTS"),
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
    const inq = await tx.purchaseInquiry.create({ data: { no, entityId: order?.entityId ?? actor.entityId, serviceOrderId: order?.id, kind: d.kind, requestedById: actor.id, neededBy: d.neededBy, note: d.note, lines: lines as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined } });
    await tx.document.create({ data: { no, type: "PR", entityId: inq.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id } });
    for (const a of order?.assets ?? []) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order!.id, sourceDocNo: no, summary: `${no} · ${lines.length} lines`, payload: { inquiry: no, lines: lines.length } as Prisma.InputJsonValue } });
    return inq;
  });
}

/** Lines a service order still needs to buy: quoted parts whose stock on hand is short. */
/**
 * Parts the order is short of, from the quote lines when they exist, otherwise from the INTH needs (flow step 3:
 * the inspection lists what the repair needs, the system checks stock, the short part goes to purchasing).
 */
export async function inquiryLinesFromOrder(no: string): Promise<InquiryLine[]> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { lines: { include: { part: true }, orderBy: { lineNo: "asc" } }, inspections: { where: { draft: false }, orderBy: { no: "desc" } } } });
  const wanted: { sku: string; vendorPartNo?: string; description: string; qty: number; unit: string; assetCode?: string }[] = [];
  if (o.lines.some((l) => l.part)) {
    for (const l of o.lines) if (l.part) wanted.push({ sku: l.part.sku, vendorPartNo: l.part.vendorPartNo, description: l.description, qty: Number(l.qty), unit: l.unit, assetCode: l.assetCode ?? undefined });
  } else if (o.inspections.length === 0 && Array.isArray(o.requestLines)) {
    // 贸易: the customer's inquiry lines; an item we have never stocked (no SKU match) is short in full
    for (const r of o.requestLines as { sku?: string; description: string; qty: number; unit: string }[]) wanted.push({ sku: r.sku ?? "", description: r.description, qty: Number(r.qty), unit: r.unit });
  } else {
    for (const insp of o.inspections) {
      const needs = (insp.needs as { kind: string; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit?: string }[] | null) ?? [];
      const asset = await prisma.asset.findUnique({ where: { id: insp.assetId }, select: { code: true } });
      for (const n of needs) if (n.kind === "PART" && n.partSku) wanted.push({ sku: n.partSku, vendorPartNo: n.vendorPartNo, description: n.description, qty: Number(n.qty), unit: n.unit ?? "pcs", assetCode: asset?.code });
    }
  }
  const out: InquiryLine[] = [];
  for (const w of wanted) {
    const part = await findPart(w.sku);
    const moves = part ? await prisma.stockMovement.findMany({ where: { partId: part.id }, select: { direction: true, qty: true } }) : [];
    const onHand = moves.reduce((s, m) => s + (m.direction === "IN" ? 1 : -1) * Number(m.qty), 0);
    const short = w.qty - onHand;
    if (short > 0) out.push({ lineNo: out.length + 1, partSku: w.sku || undefined, vendorPartNo: w.vendorPartNo ?? part?.vendorPartNo, description: w.description, qty: short, unit: w.unit, assetCode: w.assetCode });
  }
  return out;
}

/** Flow step 3: after an INTH is saved for real, raise one PRTH for the short parts — unless the order already has an open inquiry. Returns the PRTH number or null. */
export async function autoInquiryForOrder(no: string, actorCode: string): Promise<string | null> {
  const open = await prisma.purchaseInquiry.findFirst({ where: { serviceOrder: { no }, kind: "PARTS", status: { in: ["OPEN", "COMPARED"] } } });
  if (open) return null;
  const lines = await inquiryLinesFromOrder(no);
  if (!lines.length) return null;
  const inq = await createInquiry({ actorCode, serviceOrderNo: no, lines, note: "auto: short items from the inspection or the customer's inquiry" });
  return inq.no;
}

// ───────────── supplier quotes & comparison ─────────────
export const QuoteInput = z.object({
  inquiryNo: z.string(), actorCode: z.string(), supplierId: z.string(),
  quoteNo: z.string().optional(), quoteDate: z.coerce.date().optional(), validUntil: z.coerce.date().optional(),
  currency: z.string().default("THB"), vatRate: z.number().min(0).max(1).optional(), leadTimeDays: z.number().int().optional(), paymentTerms: z.string().optional(),
  warrantyDays: z.number().int().min(0).optional(), solution: z.string().optional(),
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
  return prisma.supplierQuote.create({ data: { inquiryId: inq.id, supplierId: d.supplierId, quoteNo: d.quoteNo, quoteDate: d.quoteDate, validUntil: d.validUntil, currency: d.currency, vatRate: d.vatRate, subtotal: sub, total, leadTimeDays: d.leadTimeDays, paymentTerms: d.paymentTerms, warrantyDays: d.warrantyDays, solution: d.solution, lines: lines as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined } });
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
  // 合作维修: warranty back-to-back — the partner must cover at least what we promise; with no promise yet, theirs becomes ours
  if (inq.kind === "SUBCONTRACT" && inq.serviceOrder?.warrantyDays != null && (q.warrantyDays ?? 0) < inq.serviceOrder.warrantyDays) throw new Error(`WARRANTY_SHORT:${q.warrantyDays ?? 0}<${inq.serviceOrder.warrantyDays}`);
  return prisma.$transaction(async (tx) => {
    await tx.supplierQuote.updateMany({ where: { inquiryId: inq.id }, data: { selected: false } });
    await tx.supplierQuote.update({ where: { id: q.id }, data: { selected: true } });
    await tx.purchaseInquiry.update({ where: { id: inq.id }, data: { status: "COMPARED" } });
    // 比价结果回流报价单: the chosen supplier price is the cost of the matching quote line (by SKU, else by description)
    if (inq.serviceOrder && inq.kind === "SUBCONTRACT") {
      if (inq.serviceOrder.warrantyDays == null && q.warrantyDays != null) await tx.serviceOrder.update({ where: { id: inq.serviceOrder.id }, data: { warrantyDays: q.warrantyDays } });
      const costs = await partnerCostByAsset(tx, inq.serviceOrder.id);
      for (const [assetCode, cost] of costs) {
        const target = inq.serviceOrder.lines.filter((l) => l.assetCode === assetCode).sort((a, b) => a.lineNo - b.lineNo)[0];
        if (target) await tx.quoteLine.update({ where: { id: target.id }, data: { unitCost: Math.round((cost / Number(target.qty)) * 100) / 100 } });
      }
      await recomputeMargin(tx, inq.serviceOrder.id, actor.id, inq.no);
    } else if (inq.serviceOrder) {
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
  kind: z.enum(["PARTS", "SUBCONTRACT"]).default("PARTS"), warrantyDays: z.number().int().min(0).optional(), scope: z.string().optional(),
  inquiryNo: z.string().optional(), serviceOrderNo: z.string().optional(),
  expectedAt: z.coerce.date().optional(), currency: z.string().default("THB"), vatRate: z.number().min(0).max(1).optional(),
  supplierRef: z.string().optional(), paymentTerms: z.string().optional(),
  /** the buyer has seen that the order already has these goods on another POTH and wants this one as well */
  allowRepeat: z.boolean().optional(),
  lines: z.array(z.object({ partSku: z.string().optional(), vendorPartNo: z.string().optional(), description: z.string().min(1), qty: z.number().positive(), unit: z.string().default("pcs"), unitPrice: z.number().min(0) })).min(1, "PO_NEEDS_LINE"),
  attachments: z.array(Att).optional(),
});
export async function createPurchaseOrder(input: z.input<typeof PurchaseOrderInput>) {
  const d = PurchaseOrderInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode }, include: { entity: true } });
  const inq = d.inquiryNo ? await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no: d.inquiryNo }, include: { serviceOrder: true } }) : null;
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { assets: true } }) : inq?.serviceOrder ? await prisma.serviceOrder.findUniqueOrThrow({ where: { id: inq.serviceOrder.id }, include: { assets: true } }) : null;
  if (order) assertNotLocked(order);
  const supplier = await prisma.supplier.findUniqueOrThrow({ where: { id: d.supplierId } });
  const kind = inq?.kind ?? d.kind;
  if (kind === "SUBCONTRACT") {
    if (!supplier.isPartner) throw new Error(`NOT_A_PARTNER:${supplier.code ?? supplier.name}`);
    // back-to-back (decided 2026-11-08): we promised the customer N days, the partner's POTH says N days
    if (order?.warrantyDays != null && d.warrantyDays !== order.warrantyDays) throw new Error(`WARRANTY_NOT_BACK_TO_BACK:${d.warrantyDays ?? "-"}≠${order.warrantyDays}`);
  }
  // The same goods bought twice for one order (trial finding 2026-11-14: three identical POTH tripled the purchase amount
  // and nothing said so). Per part number: what the order's other open POTH already buy, plus this one, against what the
  // customer ordered. More than that needs the buyer to say so.
  if (order && kind === "PARTS" && !d.allowRepeat) {
    const key = (l: { partSku?: string; vendorPartNo?: string; description?: string }) => normPartNo(l.partSku || l.vendorPartNo || l.description || "").replace(/^[A-Z0-9]{2,4}-/, "");
    const others = await prisma.purchaseOrder.findMany({ where: { serviceOrderId: order.id, kind: "PARTS", status: { not: "CANCELLED" } }, select: { no: true, lines: true } });
    const sold = ((order.poLines as { partSku?: string; description: string; qty: number; isService?: boolean }[] | null) ?? []).filter((l) => !l.isService);
    const repeats: string[] = [];
    for (const l of d.lines) {
      const k = key(l);
      const same = others.flatMap((o) => (o.lines as { partSku?: string; vendorPartNo?: string; description?: string; qty: number }[]).filter((x) => key(x) === k).map((x) => ({ no: o.no, qty: x.qty })));
      if (!same.length) continue;
      const already = same.reduce((s, x) => s + x.qty, 0);
      const need = sold.filter((x) => key(x) === k).reduce((s, x) => s + x.qty, 0);
      if (!need || already + l.qty > need + 1e-9) repeats.push(`${l.partSku || l.vendorPartNo || l.description} ${already}+${l.qty}${need ? `>${need}` : ""} (${[...new Set(same.map((x) => x.no))].join(", ")})`);
    }
    if (repeats.length) throw new Error(`PO_REPEAT:${repeats.join("; ")}`);
  }
  const paymentTerms = d.paymentTerms ?? (kind === "SUBCONTRACT" ? paymentTermsText(supplier.paymentMode, supplier.paymentDays) : undefined);
  const vatRate = d.vatRate ?? Number(actor.entity.vatRate);
  const t = totals(d.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })), vatRate);
  const fx = d.currency === "CNY" ? 1 : Number((await prisma.fxRate.findFirst({ where: { currency: d.currency }, orderBy: { rateDate: "desc" } }))?.rateToCny ?? 0) || undefined;
  const lines = d.lines.map((l, i) => ({ lineNo: i + 1, ...l, amount: round2(l.qty * l.unitPrice), receivedQty: 0 }));
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "PO", createdByEmployeeCode: actor.code, entityId: order?.entityId ?? actor.entityId });
    const po = await tx.purchaseOrder.create({ data: { no, entityId: order?.entityId ?? actor.entityId, supplierId: d.supplierId, inquiryId: inq?.id, serviceOrderId: order?.id, kind, warrantyDays: d.warrantyDays, scope: d.scope, expectedAt: d.expectedAt, currency: d.currency, fxRateToCny: fx, subtotal: t.subtotal, vatRate, vatAmount: t.vatAmount, total: t.total, totalCny: fx ? round2(t.total * fx) : undefined, supplierRef: d.supplierRef, paymentTerms, lines: lines as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined, createdById: actor.id } });
    await tx.document.create({ data: { no, type: "PO", entityId: po.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id } });
    if (inq) await tx.purchaseInquiry.update({ where: { id: inq.id }, data: { status: "ORDERED" } });
    for (const a of order?.assets ?? []) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order!.id, sourceDocNo: no, summary: `${no} · ${d.currency} ${t.total.toFixed(2)}`, payload: { purchaseOrder: no, total: t.total } as Prisma.InputJsonValue } });
    return po;
  });
}

/** 客户回签 → 按 PRTH 生成 POTH: one draft POTH per compared inquiry of the order (from its selected quote). */
export async function raisePurchaseOrdersForOrder(no: string, actorCode: string) {
  const inqs = await prisma.purchaseInquiry.findMany({ where: { serviceOrder: { no }, status: "COMPARED" }, include: { quotes: { where: { selected: true }, include: { supplier: true } }, serviceOrder: { select: { warrantyDays: true } } } });
  const made: string[] = [];
  for (const inq of inqs) {
    const q = inq.quotes[0];
    if (!q) continue;
    const il = inq.lines as InquiryLine[];
    const lines = (q.lines as { lineNo: number; vendorPartNo?: string; description?: string; qty: number; unit?: string; unitPrice: number }[]).map((l) => { const src = il.find((x) => x.lineNo === l.lineNo); return { partSku: src?.partSku, vendorPartNo: l.vendorPartNo ?? src?.vendorPartNo, description: l.description ?? src?.description ?? "", qty: l.qty, unit: l.unit ?? src?.unit ?? "pcs", unitPrice: l.unitPrice }; });
    const sub = inq.kind === "SUBCONTRACT";
    const expectedAt = sub && q.leadTimeDays ? new Date(Date.now() + q.leadTimeDays * 86_400_000) : undefined;
    // goods the order already buys on another POTH are not bought again by this automatic step
    const po = await createPurchaseOrder({ actorCode, supplierId: q.supplierId, inquiryNo: inq.no, kind: inq.kind, warrantyDays: sub ? (inq.serviceOrder?.warrantyDays ?? q.warrantyDays ?? undefined) : undefined, scope: sub ? (q.solution ?? undefined) : undefined, expectedAt, currency: q.currency, vatRate: q.vatRate != null ? Number(q.vatRate) : undefined, paymentTerms: q.paymentTerms ?? undefined, supplierRef: q.quoteNo ?? undefined, lines }).catch((e: Error) => { if (/^PO_REPEAT/.test(e.message)) return null; throw e; });
    if (po) made.push(po.no);
  }
  return made;
}

/** Goods arrived: one IBTH (one or more lines) against the POTH; the PO goes PARTIAL or RECEIVED. */
export async function receivePurchaseOrder(input: { poNo: string; actorCode: string; supplierRef?: string; movedAt?: Date; received: { lineNo: number; qty: number; batch?: string }[]; attachments?: { name: string; url: string; kind?: string }[] }) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no: input.poNo }, include: { serviceOrder: true } });
  if (po.status === "CANCELLED" || po.status === "RECEIVED") throw new Error(`PO_CLOSED:${po.no}`);
  if (po.kind === "SUBCONTRACT") throw new Error(`PO_IS_SUBCONTRACT:${po.no}`); // the machine comes back on a 外协返回 IBTH (srm.returnFromPartner)
  const lines = po.lines as { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; unitPrice: number; receivedQty: number }[];
  const take = input.received.filter((r) => r.qty > 0);
  if (!take.length) throw new Error("RECEIPT_EMPTY");
  for (const r of take) {
    const l = lines.find((x) => x.lineNo === r.lineNo);
    if (!l) throw new Error(`PO_LINE_NOT_FOUND:${r.lineNo}`);
    if (!l.partSku && !l.vendorPartNo) throw new Error(`PO_LINE_NO_SKU:${r.lineNo}`); // a line needs a part number — ours or the maker's — before it can be stocked
    if (r.qty > l.qty - l.receivedQty + 1e-9) throw new Error(`RECEIPT_OVER:${r.lineNo}`);
  }
  const ib = await recordStockDoc({ actorCode: input.actorCode, direction: "IN", serviceOrderNo: po.serviceOrder?.no, supplierRef: input.supplierRef ?? po.supplierRef ?? undefined, costCurrency: po.currency, movedAt: input.movedAt, lines: take.map((r) => { const l = lines.find((x) => x.lineNo === r.lineNo)!; return { partSku: (l.partSku || l.vendorPartNo)!, qty: r.qty, batch: r.batch, unitCost: l.unitPrice }; }) });
  // the line keeps the library's SKU from now on, so the next receipt and the stock page agree on the part
  const skuOf = new Map(take.map((r, i) => [r.lineNo, ib.lines[i]?.part?.sku]));
  const updatedLines = lines.map((l) => { const r = take.find((x) => x.lineNo === l.lineNo); return r ? { ...l, partSku: skuOf.get(l.lineNo) ?? l.partSku, receivedQty: round2(l.receivedQty + r.qty) } : l; });
  const complete = updatedLines.every((l) => l.receivedQty + 1e-9 >= l.qty);
  await prisma.$transaction(async (tx) => {
    await tx.stockMovement.updateMany({ where: { no: ib.no }, data: { purchaseOrderId: po.id } });
    await tx.purchaseOrder.update({ where: { id: po.id }, data: { lines: updatedLines as unknown as Prisma.InputJsonValue, status: complete ? "RECEIVED" : "PARTIAL", attachments: input.attachments?.length ? ([...((po.attachments as unknown[] | null) ?? []), ...input.attachments] as Prisma.InputJsonValue) : undefined } });
  });
  return { ibthNo: ib.no, status: complete ? "RECEIVED" : "PARTIAL" };
}
