/**
 * 合作维修 (partner repair) rules, decided by the MD on 2026-11-08. Pure functions; src/server/srm.ts applies them.
 *  - the partner never meets the customer: we carry the machine both ways, partner-facing documents hold no customer data
 *  - margin floor 33 % for partner work (50 % in-house); below it the MD approves
 *  - warranty back-to-back: the days we promise the customer are the days on the partner's POTH
 *  - payment: Thai partners monthly, 15 days after month end; everyone else per order
 *  - progress milestones are internal only
 */
import { MIN_MARGIN_PCT } from "./margin";

export const PARTNER_MIN_MARGIN_PCT = 0.33;
/** Hire-of-work / service paid by a juristic person to a Thai juristic person: 3 % (goods are not withheld). */
export const WHT_SERVICE_RATE_TH = 0.03;
export const MONTHLY_PAYMENT_DAYS = 15;

/** Default partner terms (decided 2026-11-08): Thai partners monthly, 15 days after month end; everyone else per order. */
export const defaultPaymentMode = (countryCode: string): "MONTHLY" | "PER_ORDER" => (countryCode.toUpperCase() === "TH" ? "MONTHLY" : "PER_ORDER");

export type FulfilmentKind = "IN_HOUSE" | "PARTNER";

export function marginFloorFor(fulfilment: FulfilmentKind | null | undefined): number {
  return fulfilment === "PARTNER" ? PARTNER_MIN_MARGIN_PCT : MIN_MARGIN_PCT;
}

/** MONTHLY: last day of the invoice month + days (月结 15 天); PER_ORDER: due on the invoice date. Dates in UTC days. */
export function payableDueDate(invoiceDate: Date, mode: "MONTHLY" | "PER_ORDER", days?: number | null): Date {
  const d = new Date(Date.UTC(invoiceDate.getUTCFullYear(), invoiceDate.getUTCMonth(), invoiceDate.getUTCDate()));
  if (mode === "PER_ORDER") return d;
  const monthEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return new Date(monthEnd.getTime() + (days ?? MONTHLY_PAYMENT_DAYS) * 86_400_000);
}

/** WHT on a supplier invoice: Thai partner doing a repair (SUBCONTRACT) → 3 % of the subtotal; parts and foreign partners → 0. */
export function whtRateFor(supplierCountry: string, kind: "PARTS" | "SUBCONTRACT"): number {
  return kind === "SUBCONTRACT" && supplierCountry === "TH" ? WHT_SERVICE_RATE_TH : 0;
}

/** Payment terms text printed on a SUBCONTRACT POTH when the quote gave none. */
export function paymentTermsText(mode: "MONTHLY" | "PER_ORDER", days?: number | null): string {
  return mode === "MONTHLY"
    ? `Monthly billing, payment ${days ?? MONTHLY_PAYMENT_DAYS} days after month end  วางบิลรายเดือน ชำระภายใน ${days ?? MONTHLY_PAYMENT_DAYS} วันหลังสิ้นเดือน`
    : "Per order, after our retest and acceptance  ชำระรายงาน หลังตรวจรับ";
}

export interface Rating { quality: number; onTime: number; price: number; cooperation: number }
export function ratingScore(r: Rating): number {
  return Math.round(((r.quality + r.onTime + r.price + r.cooperation) / 4) * 100) / 100;
}
export function averageScore(rs: Rating[]): number | null {
  if (!rs.length) return null;
  return Math.round((rs.reduce((s, r) => s + ratingScore(r), 0) / rs.length) * 100) / 100;
}

export interface Accessory { item: string; qty: number }
/** What went out with the machine but did not come back (by item name, case-insensitive). */
export function missingAccessories(sent: Accessory[], returned: Accessory[]): Accessory[] {
  const back = new Map<string, number>();
  for (const r of returned) back.set(r.item.trim().toLowerCase(), (back.get(r.item.trim().toLowerCase()) ?? 0) + r.qty);
  const out: Accessory[] = [];
  for (const s of sent) {
    const k = s.item.trim().toLowerCase();
    const got = back.get(k) ?? 0;
    if (got < s.qty) out.push({ item: s.item, qty: s.qty - got });
    back.set(k, Math.max(0, got - s.qty));
  }
  return out;
}

export const PARTNER_STAGES = ["SENT", "ARRIVED", "DISASSEMBLED", "REPAIRING", "TESTING", "COMPLETED", "RETURNED", "RETEST_PASSED", "RETEST_FAILED"] as const;
export type PartnerStageKind = (typeof PARTNER_STAGES)[number];
/** Stages a person records by hand while the machine is at the partner; the rest are written by documents or the retest. */
export const MANUAL_STAGES: PartnerStageKind[] = ["ARRIVED", "DISASSEMBLED", "REPAIRING", "TESTING", "COMPLETED"];

/** Where a machine is in one partner cycle, from its milestones in time order (latest cycle wins). */
export function custodyOf(stages: PartnerStageKind[]): "NONE" | "AT_PARTNER" | "RETURNED" | "PASSED" | "FAILED" {
  let state: "NONE" | "AT_PARTNER" | "RETURNED" | "PASSED" | "FAILED" = "NONE";
  for (const s of stages) {
    if (s === "SENT") state = "AT_PARTNER";
    else if (s === "RETURNED") state = "RETURNED";
    else if (s === "RETEST_PASSED") state = "PASSED";
    else if (s === "RETEST_FAILED") state = "FAILED";
  }
  return state;
}

/** A POTH change that costs more or lands later needs the customer's written consent first (flow: 变更 POTH 同步 QTTH). */
export function revisionNeedsConsent(from: { subtotal: number; expectedAt?: Date | null }, to: { subtotal: number; expectedAt?: Date | null }): boolean {
  if (to.subtotal > from.subtotal + 0.005) return true;
  if (to.expectedAt && (!from.expectedAt || to.expectedAt.getTime() > from.expectedAt.getTime())) return true;
  return false;
}
