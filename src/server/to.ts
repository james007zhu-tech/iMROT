import { actorWith } from "@/server/guard";
import { can } from "@/lib/caps";
import { countryOfNo, isTestNo } from "@/lib/numbering";
/**
 * T&O / FIN Phase 1 slice: TITH tax invoice (local currency, Thai text, VAT separate), IVTH invoice (also the payment record),
 * BLTH monthly statement for credit customers. Every amount is booked in CNY at the BoC rate of the document date.
 */
import { localIso } from "@/lib/dates";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { expectedReceipt, round2, totals } from "@/lib/money";
import type { Prisma } from "@prisma/client";
import { assertBusinessClosure } from "@/lib/closure";
import { audit } from "@/server/audit";
import { declineInvoiceLines } from "@/server/decline";

export async function bocRate(currency: string, onOrBefore: Date): Promise<number> {
  if (currency === "CNY") return 1;
  const r = await prisma.fxRate.findFirst({ where: { currency, rateDate: { lte: onOrBefore } }, orderBy: { rateDate: "desc" } });
  if (!r) throw new Error(`No Bank of China rate for ${currency} on or before ${localIso(onOrBefore)!.slice(0, 10)} — run npm run fx:fetch`);
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
  await actorWith(input.actorCode, can.invoice); // 统一角色权限表
  assertBusinessClosure("TI");
  const d = TaxInvoiceInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { entity: true, customer: true, lines: true, assets: true, taxInvoices: true, decline: true } });
  // ACCEPTED for the first tax invoice; INVOICED is fine only when every earlier tax invoice of the order was voided (re-issue after a void).
  const reissue = order.status === "INVOICED" && order.taxInvoices.length > 0 && order.taxInvoices.every((t) => t.voidedAt);
  // 国际贸易: an export carries no TITH — the commercial invoice (IVTH 33) and the export entry stand in (src/lib/export.ts)
  if (order.mode === "INTERNATIONAL_TRADE") throw new Error(`EXPORT_NO_TAX_INVOICE:${order.no}`);
  // 自动化项目: invoiced per milestone on the project page (src/server/project.ts)
  if (order.mode === "AUTOMATION_PROJECT") throw new Error(`USE_MILESTONE_INVOICE:${order.no}`);
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
    const ti = await writeTaxInvoice(tx, { order, actor, issuedAt, currency, lines, vatRate, fx, buyerTaxId: d.buyerTaxId, buyerBranch: d.buyerBranch });
    const no = ti.no;
    await tx.serviceOrder.update({ where: { id: order.id }, data: { status: "INVOICED" } });
    for (const a of order.assets) {
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "INVOICED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: no, occurredAt: issuedAt, summary: `${currency} ${t.total.toFixed(2)} incl. VAT ${(vatRate * 100).toFixed(0)}%`, payload: { ...t, totalCny: round2(t.total * fx), fx } as Prisma.InputJsonValue } });
    }
    return ti;
  });
}

type TiLineIn = { descriptionLocal: string; descriptionEn?: string; qty: number; unit?: string; unitPrice: number };
/**
 * The TITH itself: number, เล่มที่ / เลขที่ในเล่ม, lines, totals, Document. Shared by the order's tax invoice and the
 * instalments of an automation project (src/server/project.ts). Status changes and events stay with the caller.
 */
export async function writeTaxInvoice(tx: Prisma.TransactionClient, a: {
  order: { id: string; entityId: string; customerId: string; entity: { taxInvoiceBookSize: number }; customer: { taxId: string | null; branchCode: string | null } };
  actor: { id: string; code: string }; issuedAt: Date; currency: string; lines: TiLineIn[]; vatRate: number; fx: number; buyerTaxId?: string; buyerBranch?: string;
}) {
  const { order, actor, issuedAt, currency, lines, vatRate, fx } = a;
  const t = totals(lines, vatRate);
  const no = await allocateNumber(tx, { prefix: "TI", createdByEmployeeCode: actor.code, entityId: order.entityId, date: issuedAt });
  // เล่มที่ / เลขที่ในเล่ม (朱总 2026-11-08): one running sequence per legal entity, books of `taxInvoiceBookSize`; a voided
  // tax invoice keeps its place in the book, exactly as a torn page in a paper book would.
  // A TEST- tax invoice takes no page in the book: the book starts with the first real one.
  const test = isTestNo(no);
  const last = test ? null : await tx.taxInvoice.findFirst({ where: { serviceOrder: { entityId: order.entityId }, seq: { not: null } }, orderBy: { seq: "desc" }, select: { seq: true } });
  const seq = test ? null : (last?.seq ?? 0) + 1;
  const bookSize = Math.max(1, order.entity.taxInvoiceBookSize);
  const bookNo = seq ? String(Math.ceil(seq / bookSize)).padStart(3, "0") : null;
  const bookSeq = seq ? ((seq - 1) % bookSize) + 1 : null;
  const ti = await tx.taxInvoice.create({
    data: {
      no, serviceOrderId: order.id, issuedAt, currency, seq, bookNo, bookSeq,
      lines: lines.map((l) => ({ ...l, amount: round2(l.qty * l.unitPrice) })) as Prisma.InputJsonValue,
      subtotal: t.subtotal, vatRate, vatAmount: t.vatAmount, total: t.total, fxRateToCny: fx, totalCny: round2(t.total * fx),
      buyerTaxId: a.buyerTaxId ?? order.customer.taxId, buyerBranch: a.buyerBranch ?? order.customer.branchCode,
    },
  });
  await tx.document.create({ data: { no, type: "TI", entityId: order.entityId, countryCode: countryOfNo(no), customerId: order.customerId, serviceOrderId: order.id, createdById: actor.id, issuedAt } });
  return ti;
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
  await actorWith(input.actorCode, can.invoice); // 统一角色权限表
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
    await tx.document.create({ data: { no, type: "IV", entityId: order.entityId, countryCode: countryOfNo(no), customerId: order.customerId, serviceOrderId: order.id, createdById: actor.id, issuedAt } });
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
  await actorWith(input.actorCode, can.invoice); // 统一角色权限表
  assertBusinessClosure("PAYMENT");
  const d = PaymentInput.parse(input);
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: d.invoiceNo }, include: { serviceOrder: { include: { assets: true } } } });
  if (iv.cancelledAt) throw new Error(`INVOICE_CANCELLED:${iv.no}`);
  if (round2(d.paidAmount + d.whtAmount) <= 0) throw new Error("PAYMENT_NEEDS_AMOUNT");
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
    await tx.document.create({ data: { no: rcNo, type: "RC", entityId: iv.serviceOrder.entityId, countryCode: countryOfNo(rcNo), customerId: iv.serviceOrder.customerId, serviceOrderId: iv.serviceOrderId, createdById: actor.id, issuedAt: d.paidAt } });
    for (const a of iv.serviceOrder.assets) {
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "PAID", actorId: actor.id, serviceOrderId: iv.serviceOrderId, sourceDocNo: rcNo, occurredAt: d.paidAt, summary: `${iv.currency} ${d.paidAmount.toFixed(2)}${d.whtAmount ? ` + WHT ${d.whtAmount.toFixed(2)}` : ""} · ${iv.no}`, payload: { paidAmount: d.paidAmount, whtAmount: d.whtAmount, whtCertRef: d.whtCertRef, bankRef: d.bankRef, receiptNo: rcNo, settled } as Prisma.InputJsonValue, attachments: proofs as Prisma.InputJsonValue } });
    }
    // Settlement no longer closes the order by itself (decision 2026-11-08): the person presses "项目完成" on the QTTH (INVOICED → CLOSED).
    return { ...updated, receiptNo: receipt.no, settled };
  });
}

/** BLTH — monthly statement listing this customer's unpaid IVTH for a period (YYMM). Credit customers only. */
export async function issueMonthlyStatement(customerCode: string, period: string, actorCode: string) {
  await actorWith(actorCode, can.invoice); // 统一角色权限表
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
    await tx.document.create({ data: { no, type: "BL", entityId: customer.entityId, countryCode: countryOfNo(no), customerId: customer.id, createdById: actor.id } });
    return bl;
  });
}

// ── TITH void (decision 2026-11-08: anyone may request, only the MD decides) ──────────────────────────────────

/** Ask to void a tax invoice. Refused when a payment was already recorded against it (then a credit note is the way, not a void). */
export async function requestTaxInvoiceVoid(input: { taxInvoiceNo: string; actorCode: string; reason: string }) {
  await actorWith(input.actorCode, can.invoiceStatus); // 统一角色权限表
  const ti = await prisma.taxInvoice.findUniqueOrThrow({ where: { no: input.taxInvoiceNo }, include: { invoices: { include: { receipts: true } }, serviceOrder: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (ti.voidedAt) throw new Error(`TI_ALREADY_VOID:${ti.no}`);
  if (ti.voidStatus === "REQUESTED") throw new Error(`TI_VOID_PENDING:${ti.no}`);
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
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const upd = await tx.taxInvoice.update({ where: { id: ti.id }, data: {
      voidStatus: input.decision, voidDecidedAt: now, voidDecidedById: actor.id, voidDecisionNote: input.note,
      ...(input.decision === "APPROVED" ? { voidedAt: now, voidReason: ti.voidRequestReason ?? input.note ?? "void" } : {}),
    } });
    if (input.decision === "APPROVED") {
      // 应收和回款跟着改回去: its IVTH is cancelled, the receipts against it are voided with it, the money shows as not received
      const rcs = ti.invoices.flatMap((iv) => iv.receipts).filter((r) => !r.voidedAt);
      await tx.receipt.updateMany({ where: { id: { in: rcs.map((r) => r.id) } }, data: { voidedAt: now, voidStatus: "APPROVED", voidDecidedById: actor.id, voidDecidedAt: now, voidRequestReason: `${ti.no} voided` } });
      await tx.document.updateMany({ where: { no: { in: [ti.no, ...ti.invoices.map((i) => i.no), ...rcs.map((r) => r.no)] } }, data: { voidedAt: now } });
      await tx.invoice.updateMany({ where: { taxInvoiceId: ti.id }, data: { paidAmount: null, whtAmount: null, paidAt: null } });
      await tx.invoice.updateMany({ where: { taxInvoiceId: ti.id, cancelledAt: null }, data: { cancelledAt: now, cancelReason: `TITH ${ti.no} voided` } });
      await tx.creditNote.updateMany({ where: { taxInvoiceId: ti.id, voidedAt: null }, data: { voidedAt: now, voidReason: `${ti.no} voided` } });
      if (ti.serviceOrder.status === "CLOSED") await tx.serviceOrder.update({ where: { id: ti.serviceOrderId }, data: { status: "INVOICED" } });
      for (const a of ti.serviceOrder.assets) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "INVOICED", actorId: actor.id, serviceOrderId: ti.serviceOrderId, sourceDocNo: ti.no, occurredAt: now, summary: `VOID ${ti.no}: ${ti.voidRequestReason ?? ""}`, payload: { void: true, reason: ti.voidRequestReason, invoicesCancelled: ti.invoices.map((i) => i.no) } as Prisma.InputJsonValue } });
    }
    await audit(actor.id, input.decision === "APPROVED" ? "TI_VOID_APPROVE" : "TI_VOID_REJECT", ti.no, { note: input.note, invoices: ti.invoices.map((i) => i.no) }, tx);
    return upd;
  });
}


// ── RCTH void (朱总 2026-11-15: every money document can be voided; anyone asks, the MD decides) ─────────────────

export async function requestReceiptVoid(input: { receiptNo: string; actorCode: string; reason: string }) {
  await actorWith(input.actorCode, can.invoice); // 统一角色权限表
  const rc = await prisma.receipt.findUniqueOrThrow({ where: { no: input.receiptNo } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (rc.voidedAt) throw new Error(`RC_ALREADY_VOID:${rc.no}`);
  if (rc.voidStatus === "REQUESTED") throw new Error(`RC_VOID_PENDING:${rc.no}`);
  if (!input.reason.trim()) throw new Error("VOID_REASON_REQUIRED");
  await audit(actor.id, "RC_VOID_REQUEST", rc.no, { reason: input.reason.trim() });
  return prisma.receipt.update({ where: { id: rc.id }, data: { voidStatus: "REQUESTED", voidRequestedById: actor.id, voidRequestReason: input.reason.trim(), voidDecidedAt: null, voidDecidedById: null, voidDecisionNote: null } });
}

/** MD decision. APPROVED voids the receipt (number kept) and gives its cash and WHT back to the IVTH: the receivable is open again. */
export async function decideReceiptVoid(input: { receiptNo: string; actorCode: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (actor.role !== "MD") throw new Error("MD_ONLY");
  const rc = await prisma.receipt.findUniqueOrThrow({ where: { no: input.receiptNo }, include: { invoice: { include: { receipts: true } } } });
  if (rc.voidStatus !== "REQUESTED") throw new Error(`RC_VOID_NOT_REQUESTED:${rc.no}`);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const upd = await tx.receipt.update({ where: { id: rc.id }, data: { voidStatus: input.decision, voidDecidedAt: now, voidDecidedById: actor.id, voidDecisionNote: input.note, ...(input.decision === "APPROVED" ? { voidedAt: now } : {}) } });
    if (input.decision === "APPROVED") {
      const left = rc.invoice.receipts.filter((r) => r.id !== rc.id && !r.voidedAt);
      const cash = round2(left.reduce((s, r) => s + Number(r.cashAmount), 0)), wht = round2(left.reduce((s, r) => s + Number(r.whtAmount), 0));
      const lastAt = left.map((r) => r.receivedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      await tx.invoice.update({ where: { id: rc.invoiceId }, data: { paidAmount: left.length ? cash : null, whtAmount: left.length ? wht : null, paidAt: lastAt } });
      await tx.document.updateMany({ where: { no: rc.no }, data: { voidedAt: now } });
    }
    await audit(actor.id, input.decision === "APPROVED" ? "RC_VOID_APPROVE" : "RC_VOID_REJECT", rc.no, { note: input.note, invoice: rc.invoice.no }, tx);
    return upd;
  });
}

// ── CNTH credit note ─────────────────────────────────────────────────────────────────────────────────────────

export const CreditNoteInput = z.object({ taxInvoiceNo: z.string(), actorCode: z.string(), reason: z.string().trim().min(1, "CREDIT_REASON_REQUIRED"), subtotal: z.number().positive("CREDIT_NEEDS_AMOUNT"), issuedAt: z.coerce.date().optional() });

/**
 * 开贷项单: lowers a tax invoice by an amount before VAT (a price correction, a return, a discount given afterwards).
 * Finance or the MD. Never more than what is left of the tax invoice. The IVTH's amount due goes down by the same
 * total; where the customer had already paid more than what is left, the difference shows as owed back to them.
 */
export async function issueCreditNote(input: z.input<typeof CreditNoteInput>) {
  assertBusinessClosure("TI");
  const d = CreditNoteInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  if (actor.role !== "MD" && actor.role !== "FINANCE") throw new Error("FINANCE_ONLY");
  const ti = await prisma.taxInvoice.findUniqueOrThrow({ where: { no: d.taxInvoiceNo }, include: { serviceOrder: true, creditNotes: { where: { voidedAt: null } }, invoices: { where: { cancelledAt: null }, orderBy: { issuedAt: "desc" } } } });
  if (ti.voidedAt) throw new Error(`TI_ALREADY_VOID:${ti.no}`);
  const left = round2(Number(ti.subtotal) - ti.creditNotes.reduce((s, c) => s + Number(c.subtotal), 0));
  if (d.subtotal > left + 0.005) throw new Error(`CREDIT_EXCEEDS_TI:${d.subtotal.toFixed(2)}>${left.toFixed(2)}`);
  const vatAmount = round2(d.subtotal * Number(ti.vatRate)), total = round2(d.subtotal + vatAmount);
  const iv = ti.invoices[0] ?? null;
  const issuedAt = d.issuedAt ?? new Date();
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "CN", createdByEmployeeCode: actor.code, entityId: ti.serviceOrder.entityId, date: issuedAt });
    const cn = await tx.creditNote.create({ data: { no, taxInvoiceId: ti.id, invoiceId: iv?.id, issuedAt, reason: d.reason, currency: ti.currency, subtotal: d.subtotal, vatAmount, total, createdById: actor.id } });
    await tx.document.create({ data: { no, type: "CN", entityId: ti.serviceOrder.entityId, countryCode: countryOfNo(no), customerId: ti.serviceOrder.customerId, serviceOrderId: ti.serviceOrderId, createdById: actor.id, issuedAt } });
    if (iv) await tx.invoice.update({ where: { id: iv.id }, data: { amountDue: round2(Number(iv.amountDue) - total) } });
    await audit(actor.id, "CREDIT_NOTE", no, { taxInvoice: ti.no, invoice: iv?.no, subtotal: d.subtotal, total, reason: d.reason }, tx);
    return cn;
  });
}

/** A wrong credit note is voided by the MD: the amount goes back onto the IVTH. */
export async function voidCreditNote(input: { no: string; actorCode: string; reason: string }) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  if (actor.role !== "MD") throw new Error("MD_ONLY");
  if (!input.reason.trim()) throw new Error("VOID_REASON_REQUIRED");
  const cn = await prisma.creditNote.findUniqueOrThrow({ where: { no: input.no } });
  if (cn.voidedAt) throw new Error(`CN_ALREADY_VOID:${cn.no}`);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    if (cn.invoiceId) { const iv = await tx.invoice.findUniqueOrThrow({ where: { id: cn.invoiceId } }); if (!iv.cancelledAt) await tx.invoice.update({ where: { id: iv.id }, data: { amountDue: round2(Number(iv.amountDue) + Number(cn.total)) } }); }
    await tx.document.updateMany({ where: { no: cn.no }, data: { voidedAt: now } });
    await audit(actor.id, "CREDIT_NOTE_VOID", cn.no, { reason: input.reason.trim() }, tx);
    return tx.creditNote.update({ where: { id: cn.id }, data: { voidedAt: now, voidReason: input.reason.trim() } });
  });
}
