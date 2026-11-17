/**
 * 付款三步、两人 (MD 2026-11-17 18:29 — 派修单 v2 第 2 条; replaces "above THB 50,000 only").
 *
 *   1. 发起付款   finance chooses the invoice, the account the money leaves from and the amount (all of what is open, or
 *                 a part). The withholding tax of that part is worked out and, when there is any, a 50 ทวิ number is
 *                 taken. A PVTH is written: REQUESTED. Nothing is paid.
 *   2. MD 批准    every payment, whatever the amount — one baht too. The MD approves or refuses (with a reason).
 *   3. 确认付款   finance uploads the bank slip and the transfer reference. Only now is it PAID and the invoice reduced.
 *
 * Only finance asks and confirms; only the MD decides; nobody else has an entrance. A payment entered by mistake is
 * reversed (冲回) by finance or the MD with a reason: the invoice gets its amount back, the PVTH stays on file as VOID.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { audit } from "@/server/audit";
import { can, hasRole } from "@/lib/caps";

const r2 = (n: number) => Math.round(n * 100) / 100;
export const PAY_CASH = "CASH", PAY_PETTY = "PETTY_CASH";

/** Where a payment may leave from: the company's bank accounts (the invoicing bank by currency, and the other accounts on file), cash, petty cash. */
export async function payAccounts(entityId: string): Promise<{ id: string; label: string }[]> {
  const e = await prisma.legalEntity.findUniqueOrThrow({ where: { id: entityId }, select: { bankDetails: true, payAccounts: true } });
  const b = (e.bankDetails ?? {}) as { bank?: string; accounts?: Record<string, string> };
  const others = (Array.isArray(e.payAccounts) ? e.payAccounts : []) as { bank: string; branch?: string; currency: string; accountNo: string }[];
  const short = (bank: string) => (/china/i.test(bank) ? "BOC 中国银行" : /kasikorn|kbank/i.test(bank) ? "KBank 开泰" : bank);
  const out = Object.entries(b.accounts ?? {}).map(([cur, no]) => ({ id: `${short(b.bank ?? "BANK").split(" ")[0]}-${cur}-${no.slice(-4)}`, label: `${short(b.bank ?? "")} · ${cur} · …${no.slice(-4)}` }));
  for (const o of others) out.push({ id: `${short(o.bank).split(" ")[0]}-${o.currency}-${o.accountNo.replace(/\D/g, "").slice(-4)}`, label: `${short(o.bank)}${o.branch ? ` ${o.branch}` : ""} · ${o.currency} · ${o.accountNo}` });
  return [...out, { id: PAY_CASH, label: "现金 Cash เงินสด" }, { id: PAY_PETTY, label: "备用金 Petty cash เงินสดย่อย" }];
}

type Inv = { total: unknown; subtotal: unknown; payable: unknown; paidAmount: unknown; whtRate: unknown };
type Pay = { status: string; amount: unknown; whtAmount: unknown };
/** What is still to pay on an invoice (net of withholding tax), not counting payments that are asked but not paid. */
export const outstandingOf = (inv: { payable: unknown; paidAmount: unknown }) => r2(Number(inv.payable) - Number(inv.paidAmount));
const grossOf = (p: Pay) => Number(p.amount) + Number(p.whtAmount);
/** The part of the invoice total (VAT included, before withholding) that no payment — paid or under way — covers yet. */
export const grossOpenOf = (inv: Inv, payments: Pay[]) => r2(Number(inv.total) - payments.filter((p) => ["REQUESTED", "APPROVED", "PAID"].includes(p.status)).reduce((a, p) => a + grossOf(p), 0));
/** 预扣税 of a part: the rate on that part's share of the amount before VAT. 实付 = 应付 − 预扣税. */
export function whtOf(inv: { total: unknown; subtotal: unknown }, gross: number, rate: number) {
  const base = Number(inv.total) > 0 ? gross * (Number(inv.subtotal) / Number(inv.total)) : gross;
  const wht = r2(base * rate);
  return { base: r2(base), wht, net: r2(gross - wht) };
}
/** After a payment is paid or reversed: the invoice's withholding, what is payable net and what was paid follow the payments. */
async function resync(tx: Prisma.TransactionClient, invoiceId: string) {
  const inv = await tx.supplierInvoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { payments: { where: { status: "PAID" } } } });
  const paidNet = r2(inv.payments.reduce((a, p) => a + Number(p.amount), 0)), paidWht = r2(inv.payments.reduce((a, p) => a + Number(p.whtAmount), 0));
  const left = r2(Number(inv.total) - paidNet - paidWht), settled = inv.payments.length > 0 && left <= 0.005;
  const whtAmount = r2(paidWht + (left > 0.005 ? whtOf(inv, left, Number(inv.whtRate)).wht : 0));
  const last = [...inv.payments].sort((a, b) => (b.paidAt?.getTime() ?? 0) - (a.paidAt?.getTime() ?? 0))[0];
  await tx.supplierInvoice.update({ where: { id: inv.id }, data: { whtAmount, payable: r2(Number(inv.total) - whtAmount), paidAmount: paidNet, status: settled ? "PAID" : "OPEN", paidAt: settled ? (last?.paidAt ?? new Date()) : null, paymentNo: last?.no ?? null, paymentRef: last?.paymentRef ?? null } });
  return settled;
}

async function person(code: string) { return prisma.employee.findUniqueOrThrow({ where: { code } }); }

/**
 * Step 1 — finance asks: the account, the part of the invoice to settle (应付, VAT included; all that is open when not
 * given) and the withholding rate (the invoice's own when not given). 预扣税 = rate × that part before VAT; 实付 = 应付 −
 * 预扣税. With tax withheld a 50 ทวิ number is taken.
 */
export async function requestPayment(input: { invoiceId: string; actorCode: string; account: string; amount?: number; whtRate?: number; payDate?: Date }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "FINANCE")) throw new Error("FINANCE_PAYS");
  const inv = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: input.invoiceId }, include: { payments: true, supplier: { select: { name: true } } } });
  if (inv.status !== "OPEN") throw new Error(`PAYABLE_NOT_OPEN:${inv.status}`);
  if (inv.accrued) throw new Error("PAYABLE_ACCRUED");
  if (!input.account?.trim() || !(await payAccounts(inv.entityId)).some((a) => a.id === input.account)) throw new Error("PAY_ACCOUNT_REQUIRED");
  const open = grossOpenOf(inv, inv.payments);
  const gross = r2(input.amount ?? open);
  if (!(gross > 0)) throw new Error("PAY_AMOUNT_REQUIRED");
  if (gross > open + 0.005) throw new Error(`PAY_OVER:${open.toFixed(2)}`);
  const rate = input.whtRate ?? Number(inv.whtRate);
  if (!(rate >= 0 && rate <= 0.15)) throw new Error("PAY_WHT_RATE");
  const { wht, net } = whtOf(inv, gross, rate);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "PV", createdByEmployeeCode: actor.code, entityId: inv.entityId, date: input.payDate });
    await tx.document.create({ data: { no, type: "PV", entityId: inv.entityId, countryCode: no.slice(2, 4), createdById: actor.id, issuedAt: input.payDate } });
    const whtCertNo = wht > 0 ? await allocateNumber(tx, { prefix: "WT", createdByEmployeeCode: actor.code, entityId: inv.entityId, date: input.payDate }) : null;
    await audit(actor.id, "PAYMENT_REQUESTED", no, { invoice: inv.invoiceNo, supplier: inv.supplier.name, gross, whtRate: rate, wht, amount: net, account: input.account, currency: inv.currency }, tx);
    return tx.supplierPayment.create({ data: { no, entityId: inv.entityId, supplierInvoiceId: inv.id, account: input.account, gross, whtRate: rate, amount: net, whtAmount: wht, whtCertNo, payDate: input.payDate ?? new Date(), requestedBy: actor.code } });
  });
}

/** Step 2 — the MD decides. Every payment, whatever the amount. */
export async function decidePayment(input: { id: string; actorCode: string; approve: boolean; note?: string }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "MD")) throw new Error("MD_ONLY");
  const p = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: input.id } });
  if (p.status !== "REQUESTED") throw new Error(`PAY_NOT_WAITING:${p.no}`);
  if (p.requestedBy === actor.code) throw new Error("PAY_TWO_PEOPLE"); // 两人核对: never the person who asked
  if (!input.approve && !input.note?.trim()) throw new Error("REASON_REQUIRED");
  await audit(actor.id, input.approve ? "PAYMENT_APPROVED" : "PAYMENT_REFUSED", p.no, { amount: Number(p.amount), note: input.note });
  return prisma.supplierPayment.update({ where: { id: p.id }, data: { status: input.approve ? "APPROVED" : "REJECTED", decidedBy: actor.code, decidedAt: new Date(), decisionNote: input.note?.trim() || null } });
}

/** Step 3 — finance confirms with the bank slip. Only here is anything paid. */
export async function confirmPayment(input: { id: string; actorCode: string; paymentRef: string; slip: { name: string; url: string }[]; paidAt?: Date }) {
  const actor = await person(input.actorCode);
  if (!hasRole(actor, "FINANCE")) throw new Error("FINANCE_PAYS");
  const p = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: input.id }, include: { supplierInvoice: true } });
  if (p.status !== "APPROVED") throw new Error(p.status === "REQUESTED" ? `PAY_NEEDS_MD:${p.no}` : `PAY_NOT_WAITING:${p.no}`);
  if (!input.slip?.length) throw new Error("PAY_SLIP_REQUIRED");
  if (!input.paymentRef?.trim()) throw new Error("PAY_REF_REQUIRED");
  const inv = p.supplierInvoice;
  return prisma.$transaction(async (tx) => {
    const done = await tx.supplierPayment.update({ where: { id: p.id }, data: { status: "PAID", paidBy: actor.code, paidAt: input.paidAt ?? new Date(), paymentRef: input.paymentRef.trim(), slip: input.slip as unknown as Prisma.InputJsonValue } });
    const settled = await resync(tx, inv.id);
    await audit(actor.id, "PAYABLE_PAID", inv.invoiceNo, { no: p.no, amount: Number(p.amount), wht: Number(p.whtAmount), account: p.account, settled }, tx);
    return done;
  });
}

/** 冲回: a payment entered by mistake, or one not carried out. Finance or the MD, with a reason. */
export async function voidPayment(input: { id: string; actorCode: string; reason: string }) {
  const actor = await person(input.actorCode);
  if (!can.finance(actor)) throw new Error("NO_PERMISSION");
  if (!input.reason?.trim()) throw new Error("REASON_REQUIRED");
  const p = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: input.id }, include: { supplierInvoice: true } });
  if (p.status === "VOID") throw new Error(`PAY_NOT_WAITING:${p.no}`);
  return prisma.$transaction(async (tx) => {
    await audit(actor.id, "PAYMENT_VOIDED", p.no, { was: p.status, amount: Number(p.amount), reason: input.reason.trim() }, tx);
    const gone = await tx.supplierPayment.update({ where: { id: p.id }, data: { status: "VOID", voidedBy: actor.code, voidedAt: new Date(), voidReason: input.reason.trim() } });
    if (p.status === "PAID") await resync(tx, p.supplierInvoiceId);
    return gone;
  });
}
