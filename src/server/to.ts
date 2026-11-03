/**
 * T&O / FIN Phase 1 slice: TITH tax invoice (local currency, Thai text, VAT separate), IVTH invoice (also the payment record),
 * BLTH monthly statement for credit customers. Every amount is booked in CNY at the BoC rate of the document date.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { expectedReceipt, round2, totals } from "@/lib/money";
import type { Prisma } from "@prisma/client";

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
  lines: z.array(z.object({ descriptionLocal: z.string().min(1), descriptionEn: z.string().optional(), qty: z.number().positive(), unitPrice: z.number().min(0) })).optional(),
  vatRate: z.number().optional(),
  buyerTaxId: z.string().optional(),
  buyerBranch: z.string().optional(),
});

/** Issue TITH from the accepted order. Order must be ACCEPTED. Lines default to the quote lines. */
export async function issueTaxInvoice(input: z.input<typeof TaxInvoiceInput>) {
  const d = TaxInvoiceInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { entity: true, customer: true, lines: true, assets: true } });
  if (order.status !== "ACCEPTED") throw new Error(`${order.no} must be ACCEPTED before invoicing (is ${order.status})`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const issuedAt = d.issuedAt ?? new Date();
  const currency = order.entity.localCurrency;
  if (order.currency !== currency) throw new Error(`tax invoice must be in ${currency}; order is in ${order.currency}`);

  const lines = d.lines ?? order.lines.map((l) => {
    if (!l.descriptionLocal) throw new Error(`quote line ${l.lineNo} has no Thai description (descriptionLocal)`);
    return { descriptionLocal: l.descriptionLocal, descriptionEn: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice) };
  });
  const vatRate = d.vatRate ?? Number(order.entity.vatRate);
  const t = totals(lines, vatRate);
  const fx = await bocRate(currency, issuedAt);

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "TI", createdByEmployeeCode: actor.code, entityId: order.entityId, date: issuedAt });
    const ti = await tx.taxInvoice.create({
      data: {
        no, serviceOrderId: order.id, issuedAt, currency,
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
});

/** Record payment on the IVTH. Full settlement (cash + WHT ≥ due) closes the order and writes PAID on each asset. */
export async function recordPayment(input: z.input<typeof PaymentInput>) {
  const d = PaymentInput.parse(input);
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no: d.invoiceNo }, include: { serviceOrder: { include: { assets: true } } } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const outstanding = expectedReceipt(Number(iv.amountDue), Number(iv.paidAmount ?? 0) + Number(iv.whtAmount ?? 0), 0);
  const settled = round2(d.paidAmount + d.whtAmount) >= outstanding;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: iv.id },
      data: { paidAmount: round2(Number(iv.paidAmount ?? 0) + d.paidAmount), whtAmount: round2(Number(iv.whtAmount ?? 0) + d.whtAmount), whtCertRef: d.whtCertRef ?? iv.whtCertRef, paidAt: d.paidAt, bankRef: d.bankRef ?? iv.bankRef },
    });
    if (settled) {
      await tx.serviceOrder.update({ where: { id: iv.serviceOrderId }, data: { status: "CLOSED", closedAt: d.paidAt } });
      for (const a of iv.serviceOrder.assets) {
        await tx.assetEvent.create({ data: { assetId: a.assetId, type: "PAID", actorId: actor.id, serviceOrderId: iv.serviceOrderId, sourceDocNo: iv.no, occurredAt: d.paidAt, summary: `${iv.currency} ${d.paidAmount.toFixed(2)}${d.whtAmount ? ` + WHT ${d.whtAmount.toFixed(2)}` : ""}`, payload: { paidAmount: d.paidAmount, whtAmount: d.whtAmount, whtCertRef: d.whtCertRef, bankRef: d.bankRef } as Prisma.InputJsonValue } });
      }
    }
    return updated;
  });
}

/** BLTH — monthly statement listing this customer's unpaid IVTH for a period (YYMM). Credit customers only. */
export async function issueMonthlyStatement(customerCode: string, period: string, actorCode: string) {
  const customer = await prisma.customer.findUniqueOrThrow({ where: { code: customerCode } });
  if (!customer.monthlyStatement) throw new Error(`${customerCode} is not a monthly-statement customer`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const invoices = await prisma.invoice.findMany({ where: { serviceOrder: { customerId: customer.id }, paidAt: null, statementId: null } });
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
