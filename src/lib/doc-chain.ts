/**
 * 单据链 (朱总 2026-11-10: sales are L2C — "系统把单据链串起来"): the documents an order of each business mode
 * walks through, in order, and which of them exist. Pure; the order page draws it and tests pin the sequences.
 * "CPO" is the customer's own PO (a file, not a number of ours); "AC" is the acceptance record.
 */
import type { BusinessMode } from "@prisma/client";

export type ChainKey = "QT" | "ER" | "IN" | "CPO" | "PR" | "PO" | "IB" | "OB" | "RP" | "PM" | "PF" | "DN" | "AC" | "TI" | "IV" | "RC";
export interface ChainStep { key: ChainKey; optional?: boolean }

const s = (key: ChainKey, optional = false): ChainStep => ({ key, optional });
const MONEY: ChainStep[] = [s("TI"), s("IV"), s("RC")];

export const CHAINS: Record<BusinessMode, ChainStep[]> = {
  REPAIR: [s("QT"), s("ER", true), s("IN"), s("CPO"), s("PR", true), s("PO", true), s("RP"), s("DN", true), s("AC"), ...MONEY],
  PARTNER_REPAIR: [s("QT"), s("ER"), s("IN"), s("CPO"), s("PO"), s("OB"), s("IB"), s("DN"), s("AC"), ...MONEY],
  MAINTENANCE: [s("QT"), s("ER", true), s("IN", true), s("CPO"), s("PM"), s("DN", true), s("AC"), ...MONEY],
  AUTOMATION_PROJECT: [s("QT"), s("CPO"), s("PR", true), s("PO", true), s("DN"), s("AC"), ...MONEY],
  DOMESTIC_TRADE: [s("QT"), s("CPO"), s("PR", true), s("PO", true), s("IB", true), s("OB"), s("DN"), ...MONEY],
  // export: zero-rated, no TITH; the commercial invoice and packing list ride on the shipment (DNTH)
  INTERNATIONAL_TRADE: [s("QT"), s("CPO"), s("PR", true), s("PO", true), s("PF", true), s("OB"), s("DN"), s("IV"), s("RC")],
};

export interface ChainDoc { no: string; type: string; date?: string | null }
export interface ChainSlot extends ChainStep { docs: ChainDoc[]; done: boolean; next: boolean }

/**
 * `extra` carries what is not a numbered document: the customer's PO (reference or file) and the acceptance record.
 * `next` marks the first required step that is still empty — where the chain stands.
 */
export function chainOf(mode: BusinessMode, docs: ChainDoc[], extra: { customerPo?: string | null; acceptance?: string | null } = {}): ChainSlot[] {
  let found = false;
  return CHAINS[mode].map((step) => {
    const mine = step.key === "CPO" ? (extra.customerPo ? [{ no: extra.customerPo, type: "CPO" }] : [])
      : step.key === "AC" ? (extra.acceptance ? [{ no: extra.acceptance, type: "AC" }] : [])
      : docs.filter((d) => d.type === step.key);
    const done = mine.length > 0;
    const next = !done && !step.optional && !found;
    if (next) found = true;
    return { ...step, docs: mine, done, next };
  });
}
