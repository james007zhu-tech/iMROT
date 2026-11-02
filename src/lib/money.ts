/**
 * Money helpers. Rules (DCiT template system + decisions 2026-11-02):
 *  - invoice total = subtotal + VAT; VAT is one rate per document (7% default in Thailand).
 *  - withholding tax never reduces the invoice's subtotal or VAT; it reduces what we expect to receive.
 *  - every amount is kept in its original currency and converted to CNY (book currency) at the BoC rate of the document date.
 * All functions round half-up to 2 dp.
 */

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface Line { qty: number; unitPrice: number }

export function lineAmount(l: Line): number {
  return round2(l.qty * l.unitPrice);
}

export function subtotal(lines: Line[]): number {
  return round2(lines.reduce((s, l) => s + lineAmount(l), 0));
}

export function vatOf(sub: number, rate: number): number {
  return round2(sub * rate);
}

export interface Totals { subtotal: number; vatRate: number; vatAmount: number; total: number }

export function totals(lines: Line[], vatRate: number): Totals {
  const sub = subtotal(lines);
  const vat = vatOf(sub, vatRate);
  return { subtotal: sub, vatRate, vatAmount: vat, total: round2(sub + vat) };
}

/** 拟收款 = 发票总额 − 已结算金额 − 本次预扣税 */
export function expectedReceipt(invoiceTotal: number, settled: number, whtThisTime: number): number {
  return round2(invoiceTotal - settled - whtThisTime);
}

export function toBookCurrency(amount: number, rateToCny: number): number {
  return round2(amount * rateToCny);
}
