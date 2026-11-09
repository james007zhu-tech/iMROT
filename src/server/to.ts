/**
 * T&O / FIN Phase 1 slice: TITH tax invoice (local currency, Thai text, VAT separate), IVTH invoice (also the payment record),
 * BLTH monthly statement for credit customers. Every amount is booked in CNY at the BoC rate of the document date.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { expectedReceipt, round2, totals } from "@/lib/money";
import type { Prisma } from "@prisma/client";
import { assertBusinessClosure } from "@/lib/closure";
import { audit } from "@/server/audit";
import { declineInvoiceLines } from "@/server/decline";

async function bocRate(currency: string, onOrBefore: Date): Promise<number> {
  if (currency === "CNY") return 1;
  const r = await prisma.fxRate.findFirst({ where: { currency, rateDate: { lte: onOrBefore } }, orderBy: { rateDate: "desc" } });
  if (!r) throw new Error(`No Bank of China rate for ${currency} on or before ${onOrBefore.toISOString().slice(0, 10)} — run npm run fx:fetch`);
  return Number(r.rateToCny);
}

export const TaxInvoiceInput = z.object({
  serviceOrderNo: z.string(),
  actorCode: z.string(),
  issuedAt: z.coerce.date().optional(),
  /** Thai description is mandatory on a Thai tax invoice; defaults to the quote line's descriptionLocal. */
  lines: z.array(z.object({ descriptionLocal: z.string().min(1), descriptionEn: z.string().optional(), qty: z.number().positive(), unit: z.string().optional(), unitPrice: z.number().min(0) })).optional(),
  vatRate: z.number().optional(),
  buyerTaxId: z.string().optional(),
  buyerBranch: z.string().optional(),
});

/** Issue TITH from the accepted order. Order must be ACCEPTED. Lines default to the quote lines.
 *  A declined order (客户拒绝报价) is invoiced from DECLINED for its inspection fee — one line per charged machine. */
export async function issueTaxInvoice(input: z.input<typeof TaxInvoiceInput>) {
  assertBusinessClosure("TI");
  const d = TaxInvoiceInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { entity: true, customer: true, lines: true, assets: true, taxInvoices: true, decline: true } });
  // ACCEPTED for the first tax invoice; INVOICED is fine only when every earlier tax invoice of the order was voided (re-issue after a void).
  const reissue = order.status === "INVOICED" && order.taxInvoices.length > 0 && order.taxInvoices.every((t) => t.voidedAt);
  // 国际贸易: an export carries no TITH — the commercial invoice (IVTH 33) and the export entry stand in (src/lib/export.ts)
  if (order.mode === "INTERNATIONAL_TRADE") throw new Error(`EXPORT_NO_TAX_INVOICE:${order.no}`);
  const feeLines = order.decline ? await declineInvoiceLines(order.no) : null;
  if (order.decline && !feeLines?.length) throw new Error(`FEE_WAIVED:${order.no}`);
  const first = order.decline ? order.status === "DECLINED" : order.status === "ACCEPTED";
  if (!first && !reissue) throw new Error(order.status === "INVOICED" ? `TI_EXISTS:${order.taxInvoices.find((t) => !t.voidedAt)?.no ?? ""}` : `${order.no} must be ACCEPTED before invoicing (is ${order.status})`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const issuedAt = d.issuedAt ?? new Date();
  const currency = order.entity.localCurrency;
  if (order.currency !== currency) throw new Error(`tax invoice must be in ${currency}; order is in ${order.currency}`);

  const lines = d.lines ?? feeLines ?? order.lines.map((l) => {
    if (!l.descriptionLocal) throw new Error(`quote line ${l.lineNo} has no Thai description (descriptionLocal)`);
    return { descriptionLocal: l.descriptionLocal, descriptionEn: l.description, qty: Number(l.qty), unit: l.unit, unitPrice: Number(l.unitPrice) };
  });
  const vatRate = d.vatRate ?? Number(order.entity.vatRate);
  const t = totals(lines, vatRate);
  const fx = await bocRate(currency, issuedAt);

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "TI", createdByEmployeeCode: actor.code, entityId: order.entityId, date: issuedAt });
    // เล่มที่ / เลขที่ในเล่ม (朱总 2026-11-08): one running sequence per legal entity, books of `taxInvoiceBookSize`; a voided
    // tax invoice keeps its place in the book, exactly as a torn page in a paper book would.
    const last = await tx.taxInvoice.findFirst({ where: { serviceOrder: { entityId: order.entityId }, seq: { not: null } }, orderBy: { seq: "desc" }, select: { seq: true } });
    const seq = (last?.seq ?? 0) + 1;
    const bookSize = Math.max(1, order.entity.taxInvoiceBookSize);
    const bookNo = String(Math.ceil(seq / bookSize)).padStart(3, "0");
    const bookSeq = ((seq - 1) % bookSize) + 1;
    const ti = await tx.taxInvoice.create({
      data: {
        no, serviceOrderId: order.id, issuedAt, currency, seq, bookNo, bookSeq,
        lines: lines.map((l) => ({ ...l, amount: round2(l.qty * l.unitPrice) })) as Prisma.InputJsonValue,
        subtotal: t.subtotal, vatRate, vatAmount: t.vatAmount, total: t.total, fxRateToCny: fx, totalCny: round2(t.total * fx),
        buyerTaxId: d.buyerTaxId ?? order.customer.taxId, buyerBranch: d.buyerBranch ?? order.customer.branchCode,
      },
    });
    await tx.document.create({ data: { no, type: "TI", entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: actor.id, issuedAt } });
    await tx.serviceOrder.update({ where: { id: order.id }, data: { status: "INVOICED" } });
    for (const a of order.assets) {
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "INVOICED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: no, occurredAt: issuedAt, summary: `${currency} ${t.total.toFixed(2)} incl. VAT ${(vatRate * 100).toFixed(0)}%`, payload: { ...t, totalCny: round2(t.total * fx), fx } as Prisma.InputJsonValue } });
    }
    return ti;
  });
}

export const InvoiceInput = z.object({
  serviceOrderNo: z.string(),
  actorCode: z.string(),
  taxInvoiceNo: z.string().optional(),
  issuedAt: z.coerce.date().optional(),
  dueDays: z.number().int().optional(),
  amountDue: z.number().optional(), // defaults to the tax invoice total
});

/** IVTH — what the customer pays against. */
export async function issueInvoice(input: z.input<typeof InvoiceInput>) {
  assertBusinessClosure("IV");
  const d = InvoiceInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { customer: true, taxInvoices: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const ti = d.taxInvoiceNo ? order.taxInvoices.find((t) => t.no === d.taxInvoiceNo) : order.taxInvoices.at(-1);
  const issuedAt = d.issuedAt ?? new Date();
  const amountDue = d.amountDue ?? (ti ? Number(ti.total) : Number(order.total ?? 0));
  const dueAt = new Date(issuedAt.getTime() + (d.dueDays ?? order.customer.paymentTermDays) * 86400000);

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "IV", createdByEmployeeCode: actor.code, entityId: order.entityId, date: issuedAt });
    const iv = await tx.invoice.create({ data: { no, serviceOrderId: order.id, taxInvoiceId: ti?.id, issuedAt, dueAt, currency: ti?.currency ?? order.currency, amountDue } });
    await tx.document.create({ data: { no, type: "IV", entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: actor.id, issuedAt } });
    return iv;
  });
}

export const PaymentInput = z.object({
  invoiceNo: z.string(),
  actorCode: z.string(),
  paidAt: z.coerce.date(),
  paidAmount: z.number().min(0),
  whtAmount: z.number().min(0).default(0),
  whtCertRef: z.string().optional(),
  bankRef: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).optional(),
});

/** Record payment on the IVTH. Full settlement (cash + WHT ≥ due) closes the order and writes PAID on each asset. */
export async function recordPayment(input: z.input<typeof PaymentInput>) {
  assertBusinessClosure("PAYMENT");
  const d = PaymentInput.parse(input);
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: d.invoiceNo }, include: { serviceOrder: { include: { assets: true } } } });
  if (iv.cancelledAt) throw new Error(`INVOICE_CANCELLED:${iv.no}`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const outstanding = expectedReceipt(Number(iv.amountDue), Number(iv.paidAmount ?? 0) + Number(iv.whtAmount ?? 0), 0);
  const settled = round2(d.paidAmount + d.whtAmount) >= outstanding;

  const taxInvoice = iv.taxInvoiceId ? await prisma.taxInvoice.findUnique({ where: { id: iv.taxInvoiceId }, select: { no: true } }) : null;
  const proofs = (d.attachments ?? []).map((a) => ({ ...a, kind: a.kind ?? "PAYMENT_PROOF" }));

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: iv.id },
      data: { paidAmount: round2(Number(iv.paidAmount ?? 0) + d.paidAmount), whtAmount: round2(Number(iv.whtAmount ?? 0) + d.whtAmount), whtCertRef: d.whtCertRef ?? iv.whtCertRef, paidAt: d.paidAt, bankRef: d.bankRef ?? iv.bankRef,
        attachments: [...((iv.attachments as unknown[] | null) ?? []), ...proofs] as Prisma.InputJsonValue },
    });
    // RCTH — one receipt per payment received (決定 2026-11-07): this payment's cash, WHT and settled amount against the TITH.
    const rcNo = await allocateNumber(tx, { prefix: "RC", createdByEmployeeCode: actor.code, entityId: iv.serviceOrder.entityId });
    const receipt = await tx.receipt.create({ data: { no: rcNo, invoiceId: iv.id, taxInvoiceNo: taxInvoice?.no, receivedAt: d.paidAt, currency: iv.currency, cashAmount: round2(d.paidAmount), whtAmount: round2(d.whtAmount), settledAmount: round2(d.paidAmount + d.whtAmount), bankRef: d.bankRef, whtCertRef: d.whtCertRef, attachments: proofs as Prisma.InputJsonValue } });
    await tx.document.create({ data: { no: rcNo, type: "RC", entityId: iv.serviceOrder.entityId, countryCode: rcNo.slice(2, 4), customerId: iv.serviceOrder.customerId, serviceOrderId: iv.serviceOrderId, createdById: actor.id, issuedAt: d.paidAt } });
    for (const a of iv.serviceOrder.assets) {
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "PAID", actorId: actor.id, serviceOrderId: iv.serviceOrderId, sourceDocNo: rcNo, occurredAt: d.paidAt, summary: `${iv.currency} ${d.paidAmount.toFixed(2)}${d.whtAmount ? ` + WHT ${d.whtAmount.toFixed(2)}` : ""} · ${iv.no}`, payload: { paidAmount: d.paidAmount, whtAmount: d.whtAmount, whtCertRef: d.whtCertRef, bankRef: d.bankRef, receiptNo: rcNo, settled } as Prisma.InputJsonValue, attachments: proofs as Prisma.InputJsonValue } });
    }
    // Settlement no longer closes the order by itself (decision 2026-11-08): the person presses "项目完成" on the QTTH (INVOICED → CLOSED).
    return { ...updated, receiptNo: receipt.no, settled };
  });
}

/** BLTH — monthly statement listing this customer's unpaid IVTH for a period (YYMM). Credit customers only. */
export async function issueMonthlyStatement(customerCode: string, period: string, actorCode: string) {
  assertBusinessClosure("BL");
  const customer = await prisma.customer.findUniqueOrThrow({ where: { code: customerCode } });
  if (!customer.monthlyStatement) throw new Error(`${customerCode} is not a monthly-statement customer`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const invoices = await prisma.invoice.findMany({ where: { serviceOrder: { customerId: customer.id }, paidAt: null, statementId: null, cancelledAt: null } });
  if (!invoices.length) throw new Error("nothing to bill");
  const currency = invoices[0].currency;
  const total = round2(invoices.reduce((s, i) => s + Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0), 0));
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "BL", createdByEmployeeCode: actor.code, entityId: customer.entityId });
    const bl = await tx.monthlyStatement.create({ data: { no, customerId: customer.id, period, issuedAt: new Date(), currency, total, invoices: { connect: invoices.map((i) => ({ id: i.id })) } } });
    await tx.document.create({ data: { no, type: "BL", entityId: customer.entityId, countryCode: no.slice(2, 4), customerId: customer.id, createdById: actor.id } });
    return bl;
  });
}

// ── TITH void (decision 2026-11-08: anyone may request, only the MD decides) ──────────────────────────────────

/** Ask to void a tax invoice. Refused when a payment was already recorded against it (then a credit note is the way, not a void). */
export async function requestTaxInvoiceVoid(input: { taxInvoiceNo: string; actorCode: string; reason: string }) {
  const ti = await prisma.taxInvoice.findUniqueOrThrow({ where: { no: input.taxInvoiceNo }, include: { invoices: { include: { receipts: true } }, serviceOrder: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (ti.voidedAt) throw new Error(`TI_ALREADY_VOID:${ti.no}`);
  if (ti.voidStatus === "REQUESTED") throw new Error(`TI_VOID_PENDING:${ti.no}`);
  if (ti.invoices.some((iv) => iv.receipts.length > 0 || Number(iv.paidAmount ?? 0) > 0)) throw new Error(`TI_HAS_PAYMENTS:${ti.no}`);
  if (!input.reason.trim()) throw new Error("VOID_REASON_REQUIRED");
  const upd = await prisma.taxInvoice.update({ where: { id: ti.id }, data: { voidStatus: "REQUESTED", voidRequestedAt: new Date(), voidRequestedById: actor.id, voidRequestReason: input.reason.trim(), voidDecidedAt: null, voidDecidedById: null, voidDecisionNote: null } });
  await audit(actor.id, "TI_VOID_REQUEST", ti.no, { reason: input.reason.trim(), order: ti.serviceOrder.no });
  return upd;
}

/**
 * MD decision. APPROVED voids the tax invoice (number kept, never reused), cancels its unpaid IVTH so nothing is
 * receivable against it, and lets the order take a new TITH + IVTH. REJECTED leaves everything as it was.
 */
export async function decideTaxInvoiceVoid(input: { taxInvoiceNo: string; actorCode: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (actor.role !== "MD") throw new Error("MD_ONLY");
  const ti = await prisma.taxInvoice.findUniqueOrThrow({ where: { no: input.taxInvoiceNo }, include: { invoices: { include: { receipts: true } }, serviceOrder: { include: { assets: true } } } });
  if (ti.voidStatus !== "REQUESTED") throw new Error(`TI_VOID_NOT_REQUESTED:${ti.no}`);
  if (input.decision === "APPROVED" && ti.invoices.some((iv) => iv.receipts.length > 0 || Number(iv.paidAmount ?? 0) > 0)) throw new Error(`TI_HAS_PAYMENTS:${ti.no}`);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const upd = await tx.taxInvoice.update({ where: { id: ti.id }, data: {
      voidStatus: input.decision, voidDecidedAt: now, voidDecidedById: actor.id, voidDecisionNote: input.note,
      ...(input.decision === "APPROVED" ? { voidedAt: now, voidReason: ti.voidRequestReason ?? input.note ?? "void" } : {}),
    } });
    if (input.decision === "APPROVED") {
      await tx.invoice.updateMany({ where: { taxInvoiceId: ti.id, cancelledAt: null }, data: { cancelledAt: now, cancelReason: `TITH ${ti.no} voided` } });
      for (const a of ti.serviceOrder.assets) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "INVOICED", actorId: actor.id, serviceOrderId: ti.serviceOrderId, sourceDocNo: ti.no, occurredAt: now, summary: `VOID ${ti.no}: ${ti.voidRequestReason ?? ""}`, payload: { void: true, reason: ti.voidRequestReason, invoicesCancelled: ti.invoices.map((i) => i.no) } as Prisma.InputJsonValue } });
    }
    await audit(actor.id, input.decision === "APPROVED" ? "TI_VOID_APPROVE" : "TI_VOID_REJECT", ti.no, { note: input.note, invoices: ti.invoices.map((i) => i.no) }, tx);
    return upd;
  });
}
