/**
 * 国际贸易 (international trade, flow 2026-11-09). Pure rules shared by the new-order page, the quote, the shipment step
 * and the reports. The order is quoted in a foreign currency on Incoterms 2020; goods leave on one shipment (DNTH),
 * which carries the packing list (template 34); the commercial invoice is an IVTH (template 33) issued with it.
 *
 * VAT: an export of goods is zero-rated (Revenue Code s.80/1) and no TITH is issued — the export entry stands in for it.
 * That is how the system behaves until the accountant confirms (decision doc 2026-11-09, open point); the rate lives here.
 * No new number prefixes: the commercial invoice uses the IVTH number, the packing list the DNTH number.
 */
export const INCOTERMS = ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"] as const;
export type Incoterm = (typeof INCOTERMS)[number];
export const SHIP_MODES = ["SEA", "AIR", "ROAD", "COURIER"] as const;
export type ShipMode = (typeof SHIP_MODES)[number];
export const EXPORT_CURRENCIES = ["USD", "EUR", "CNY", "JPY", "THB"] as const;
export const EXPORT_VAT_RATE = 0;

export interface TradeTerms {
  currency: string; incoterm: Incoterm; place: string; destCountry: string; destPort?: string;
  shipMode: ShipMode; paymentTerms: string; paymentDays: number;
}

/** Validates what the new-order page sent. Errors: TRADE_TERMS_REQUIRED:<field>, BAD_INCOTERM, BAD_CURRENCY. */
export function tradeTermsFrom(raw: Partial<Record<keyof TradeTerms, unknown>>): TradeTerms {
  const s = (k: keyof TradeTerms) => String(raw[k] ?? "").trim();
  const need = (k: keyof TradeTerms) => { const v = s(k); if (!v) throw new Error(`TRADE_TERMS_REQUIRED:${k}`); return v; };
  const incoterm = need("incoterm").toUpperCase();
  if (!(INCOTERMS as readonly string[]).includes(incoterm)) throw new Error(`BAD_INCOTERM:${incoterm}`);
  const currency = need("currency").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`BAD_CURRENCY:${currency}`);
  const mode = (s("shipMode") || "SEA").toUpperCase();
  const days = Math.max(0, Math.round(Number(raw.paymentDays ?? 0)) || 0);
  return {
    currency, incoterm: incoterm as Incoterm, place: need("place"), destCountry: need("destCountry"), destPort: s("destPort") || undefined,
    shipMode: (SHIP_MODES as readonly string[]).includes(mode) ? (mode as ShipMode) : "SEA", paymentTerms: need("paymentTerms"), paymentDays: days,
  };
}

/** "FOB Laem Chabang (Incoterms 2020)" — the delivery term as printed. */
export const incotermLine = (t: Pick<TradeTerms, "incoterm" | "place">) => `${t.incoterm} ${t.place} (Incoterms® 2020)`;

/** One line of the shipment: a PO line with what customs and the forwarder need. */
export interface ShipLine {
  key: string; lineNo: number; sku?: string; description: string; hsCode: string; origin: string;
  qty: number; unit: string; packages: number; netKg: number; grossKg: number; unitPrice: number; amount: number;
}
export interface Shipping {
  shipMode: ShipMode; portLoading: string; portDischarge: string; packageKind: string; marks?: string; cbm?: number;
  forwarder?: string; vessel?: string; etd: string; eta?: string; blNo?: string; exportEntryNo?: string; shippedAt?: string;
  lines: ShipLine[];
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
export function shipTotals(lines: Pick<ShipLine, "packages" | "netKg" | "grossKg" | "amount">[]) {
  return {
    packages: lines.reduce((s, l) => s + (l.packages || 0), 0), netKg: r3(lines.reduce((s, l) => s + (l.netKg || 0), 0)),
    grossKg: r3(lines.reduce((s, l) => s + (l.grossKg || 0), 0)), amount: Math.round(lines.reduce((s, l) => s + (l.amount || 0), 0) * 100) / 100,
  };
}

/**
 * What stops the commercial invoice and packing list from being issued. Customs needs, per line, the HS code
 * (6–10 digits), the country of origin and the weights; gross weight is never below net.
 */
export function shipmentProblems(s: Pick<Shipping, "portLoading" | "portDischarge" | "etd" | "lines">): string[] {
  const out: string[] = [];
  if (!s.portLoading?.trim()) out.push("PORT_LOADING");
  if (!s.portDischarge?.trim()) out.push("PORT_DISCHARGE");
  if (!s.etd) out.push("ETD");
  if (!s.lines.length) out.push("NO_LINES");
  for (const l of s.lines) {
    if (!/^\d{4}(\.?\d{2}){1,3}$/.test(l.hsCode.trim())) out.push(`HS_CODE:${l.lineNo}`);
    if (!l.origin.trim()) out.push(`ORIGIN:${l.lineNo}`);
    if (!(l.packages > 0)) out.push(`PACKAGES:${l.lineNo}`);
    if (!(l.netKg > 0) || !(l.grossKg >= l.netKg)) out.push(`WEIGHT:${l.lineNo}`);
  }
  return out;
}

/** What still has to be filled before the shipment counts as gone: the B/L or AWB number and the actual departure. */
export function shippedProblems(s: Pick<Shipping, "blNo" | "shippedAt">): string[] {
  return [...(!s.blNo?.trim() ? ["BL_NO"] : []), ...(!s.shippedAt ? ["SHIPPED_AT"] : [])];
}

/** The carrier document's name by transport mode: bill of lading by sea, air waybill by air, CMR by road. */
export const transportDoc = (m: ShipMode) => (m === "AIR" || m === "COURIER" ? "AWB" : m === "ROAD" ? "CMR" : "B/L");
