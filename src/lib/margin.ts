/**
 * Quote margin against the floor set in the repair-business flow (2026-11-07): gross margin must be ≥ 50 %,
 * otherwise the quote waits for the MD. Pure functions; the service layer stores the result on the order.
 *   margin = (subtotal − cost) / subtotal, cost = Σ qty × unitCost over the lines that have a cost.
 * Lines without a cost (labour, travel) count as zero cost — that is the conservative reading sales asked for.
 */
import { round2 } from "./money";

export const MIN_MARGIN_PCT = 0.5;

export interface CostLine { qty: number; unitPrice: number; unitCost?: number | null }

export function costTotal(lines: CostLine[]): number {
  return round2(lines.reduce((s, l) => s + l.qty * (l.unitCost ?? 0), 0));
}

/** null when there is no revenue to measure against (empty quote or all-zero prices). */
export function marginPct(lines: CostLine[]): number | null {
  const revenue = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  if (revenue <= 0) return null;
  return Math.round(((revenue - costTotal(lines)) / revenue) * 10000) / 10000;
}

export type MarginApproval = "NOT_NEEDED" | "PENDING" | "APPROVED" | "REJECTED";

/** What the approval state becomes when the lines change: a re-priced quote clears an old decision. */
export function marginApprovalFor(pct: number | null, floor = MIN_MARGIN_PCT): MarginApproval {
  if (pct === null) return "NOT_NEEDED";
  return pct + 1e-9 >= floor ? "NOT_NEEDED" : "PENDING";
}

/** May the customer be asked to confirm this quote? */
export function quoteMayGoOut(approval: MarginApproval): boolean {
  return approval === "NOT_NEEDED" || approval === "APPROVED";
}
