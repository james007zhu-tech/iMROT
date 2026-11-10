/**
 * 客户拒绝报价 (朱总 2026-11-09, mockup docs/mockups/quote-decline-v0.1.html). Pure rules shared by the server, the pages
 * and the tests:
 *  - only orders with machines (维修 / 合作维修 / 维保) are declined; a trade quote that is turned down is simply cancelled;
 *  - the inspection fee is charged by default, per machine, before VAT; waiving it needs a reason (internal only);
 *  - the order closes once the machine is back with the customer (a signed DNTH, when an ERTH took it into our workshop)
 *    and the fee is invoiced (TITH) or waived;
 *  - undo (the customer changes their mind) only while no DNTH or TITH has been issued after the decline.
 */
import { quoteJustCancels } from "./modes";

export const DECLINE_REASONS = ["PRICE", "REPLACE", "LEAD_TIME", "SELF", "OTHER"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export type DeclineFee = { assetCode: string; amount: number };

export function feeTotal(fees: DeclineFee[] | null | undefined): number {
  return Math.round((fees ?? []).reduce((s, f) => s + (Number(f.amount) || 0), 0) * 100) / 100;
}

/** Why this order cannot be declined now, or null. */
export function declineBlocker(o: { mode: string; status: string }): string | null {
  if (quoteJustCancels(o.mode)) return "TRADE_QUOTE_CANCEL";
  if (o.status !== "QUOTE_PENDING") return "DECLINE_NEEDS_QUOTE_PENDING";
  return null;
}

/** Validates the decline form: a reason, the customer's reply, and either a fee for every machine or a waiver reason. */
export function declineInputError(d: { reason?: string; attachments: number; waived: boolean; waivedReason?: string; fees: DeclineFee[]; assetCodes: string[] }): string | null {
  if (!d.reason || !DECLINE_REASONS.includes(d.reason as DeclineReason)) return "DECLINE_REASON_REQUIRED";
  if (d.attachments < 1) return "DECLINE_REPLY_REQUIRED";
  if (d.waived) return d.waivedReason?.trim() ? null : "FEE_WAIVE_REASON_REQUIRED";
  for (const code of d.assetCodes) {
    const f = d.fees.find((x) => x.assetCode === code);
    if (!f || !(Number(f.amount) > 0)) return `FEE_REQUIRED:${code}`;
  }
  return null;
}

export interface DeclineShape {
  status: string;
  feeDue: boolean; /// a fee was charged (not waived)
  invoiced: boolean; /// a valid (not voided) TITH exists
  returnNeeded: boolean; /// an ERTH took the machine into our workshop
  returnSigned: boolean; /// a DNTH of this order is signed
  returnIssued: boolean; /// a DNTH was issued (signed or not)
}

/** What still stands between a declined order and closing it. Empty = may close. */
export function declineCloseBlockers(o: DeclineShape): string[] {
  const out: string[] = [];
  if (o.returnNeeded && !o.returnSigned) out.push("RETURN_DNTH");
  if (o.feeDue && !o.invoiced) out.push("FEE_TITH");
  return out;
}

/** Undo only before anything went to the customer. */
export function undoDeclineBlocker(o: DeclineShape): string | null {
  if (o.status !== "DECLINED") return "NOT_DECLINED";
  if (o.returnIssued || o.invoiced) return "DECLINE_DOCS_ISSUED";
  return null;
}

/** The tax-invoice line for one machine's inspection fee: Thai first (mandatory on a Thai tax invoice), English below. */
export function feeLineText(machine: { brand?: string; model?: string; serial?: string; code: string }): { descriptionLocal: string; descriptionEn: string } {
  const what = [[machine.brand, machine.model].filter(Boolean).join(" "), machine.serial ? `S/N ${machine.serial}` : machine.code].filter(Boolean).join(" ");
  return { descriptionLocal: `ค่าตรวจเช็คและวิเคราะห์อาการเสีย — ${what}`, descriptionEn: `Inspection & diagnosis fee — ${what}` };
}

/** Printed on the return DNTH: the machine line and the remark. */
export const RETURN_UNREPAIRED = "ส่งคืนโดยไม่ได้ซ่อม\nReturned unrepaired";
export function returnRemark(toldAt: Date): string {
  const d = toldAt.toISOString().slice(0, 10);
  return `ส่งคืนโดยไม่ได้ซ่อม ลูกค้าไม่อนุมัติใบเสนอราคา (${d}) อุปกรณ์อยู่ในสภาพเดียวกับที่รับไว้\nReturned unrepaired: quotation not approved (${d}); equipment in the condition received.`;
}
