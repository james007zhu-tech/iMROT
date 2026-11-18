/**
 * Quote margin against the floor set in the repair-business flow (2026-11-07): gross margin must be ≥ 50 %,
 * otherwise the quote waits for the MD. Pure functions; the service layer stores the result on the order.
 *   margin = (subtotal − cost) / subtotal, cost = Σ qty × unitCost over the lines that have a cost.
 * A priced line without a cost has no margin at all (测试 2026-11-18): it used to count as zero cost and read 100 %.
 */
import { round2 } from "./money";

export const MIN_MARGIN_PCT = 0.5;

export interface CostLine { qty: number; unitPrice: number; unitCost?: number | null }

export function costTotal(lines: CostLine[]): number {
  return round2(lines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0));
}

/**
 * 测试 2026-11-18 (P1): the lines priced for the customer that carry no cost (none, or 0). A quote with any of them has
 * no margin — it used to show 「毛利 100%、达标」, which would mislead the MD approving it. Numbered from 1.
 */
export function missingCostLines(lines: CostLine[]): number[] {
  return lines.flatMap((l, i) => (l.qty > 0 && l.unitPrice > 0 && !(Number(l.unitCost ?? 0) > 0) ? [i + 1] : []));
}

/** null when there is no revenue to measure against (empty quote or all-zero prices), or when a priced line has no cost. */
export function marginPct(lines: CostLine[]): number | null {
  if (missingCostLines(lines).length) return null;
  const revenue = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  if (revenue <= 0) return null;
  return Math.round(((revenue - costTotal(lines)) / revenue) * 10000) / 10000;
}

export type MarginApproval = "NOT_NEEDED" | "PENDING" | "APPROVED" | "REJECTED" | "NO_COST";

/** What the approval state becomes when the lines change: a re-priced quote clears an old decision. */
export function marginApprovalFor(pct: number | null, floor = MIN_MARGIN_PCT, missing = 0): MarginApproval {
  if (missing > 0) return "NO_COST"; // 缺成本: neither 达标 nor 送审
  if (pct === null) return "NOT_NEEDED";
  return pct + 1e-9 >= floor ? "NOT_NEEDED" : "PENDING";
}

/** May the customer be asked to confirm this quote? */
export function quoteMayGoOut(approval: MarginApproval): boolean {
  return approval === "NOT_NEEDED" || approval === "APPROVED";
}

/** 派修单 v5 P0-2 (MD Q6): the lines priced under their 最低售价 = cost ÷ (1 − floor). Any of them sends the quote to the MD. */
export function belowMinLines(lines: { qty: number; unitPrice: number; unitCost?: number | null }[], floor = MIN_MARGIN_PCT): { n: number; min: number; price: number }[] {
  if (floor >= 1) return [];
  return lines.flatMap((l, i) => { const c = Number(l.unitCost ?? 0); if (!(l.qty > 0) || c <= 0) return []; const min = Math.round((c / (1 - floor)) * 100) / 100; return l.unitPrice < min - 0.005 ? [{ n: i + 1, min, price: l.unitPrice }] : []; });
}
