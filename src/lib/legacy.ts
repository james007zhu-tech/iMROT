import { can, hasRole, type Who } from "./caps";

/**
 * 历史单据 (朱总 2026-11-23): the old system's records, read-only. Who reads which kind follows what the same paper is
 * open to in this system: reports to the people of the reports, quotes to those who see prices, tax papers to those who
 * see invoicing, the cash book to finance.
 */
export const LEGACY_KINDS = ["INSPECTION", "REPAIR", "QUOTE", "TRADE_QUOTE", "TAX_INVOICE", "BILLING", "RECEIPT", "LEDGER"] as const;
export type LegacyKindKey = (typeof LEGACY_KINDS)[number];
export function legacyKinds(who: Who): LegacyKindKey[] {
  return LEGACY_KINDS.filter((k) => (k === "INSPECTION" || k === "REPAIR" ? can.reports(who) : k === "QUOTE" || k === "TRADE_QUOTE" ? can.price(who) : k === "LEDGER" ? can.finance(who) : can.invoiceStatus(who)));
}
/** Sales read the history of their own customers only, as with live orders (需求清单 v4 V4-P0-02). */
export const legacyOwnOnly = (who: Who) => hasRole(who, "SALES") && !hasRole(who, "MD", "FINANCE", "ENGINEER");
/** A field of an old record this reader may not see: cost and margin beside a price, prices on a report. */
export function legacyFieldHidden(who: Who, label: string): boolean {
  if (/毛利|margin|成本|cost/i.test(label)) return !can.margin(who);
  if (/价格|单价|金额|小计|price|amount|total|预扣税|增值税/i.test(label)) return !can.price(who);
  return false;
}
