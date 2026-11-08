/**
 * DCiT OS numbering rules (decided 2026-11-02).
 *
 * Two tiers:
 *   Master data (low frequency, core):  <1 letter><country><YYMM><serial>, serial resets monthly
 *     A = asset    ATH2610 + 4 digits  → ATH26100001
 *     C = customer CTH2610 + 3 digits  → CTH2610001
 *     E = employee ETH2610 + 3 digits  → ETH2610001
 *   Business documents (high frequency):  <2 letters><country><YYMMDD><serial>, serial resets daily
 *     IN RP PM ER TI IV BL PF DN CN DB TF RT SC PV TR PR PO → 2-digit serial  → INTH26110201; QT → 3-digit (QTTH261102001); IB OB → 3-digit
 *     IB OB (stock movements)                                  → 3-digit serial  → OBTH261102001
 *
 * The country code is never chosen by the user: it is the country of the employee who creates the record
 * (ETH… → TH, EVN… → VN, ECN… → CN). Voided numbers are kept and never reused.
 *
 * This module is pure (no I/O). `allocateNumber` in ./numbering-db.ts wraps it with the DocSequence table.
 */

export const MASTER_PREFIXES = {
  A: { name: "asset", digits: 4 },
  C: { name: "customer", digits: 3 },
  E: { name: "employee", digits: 3 },
  S: { name: "supplier", digits: 3 }, // STH2611001 — decided 2026-11-08, same tier as customers
} as const;

export const DOC_PREFIXES = {
  QT: { name: "quotation / service order", digits: 3 }, // 3 digits since 2026-11-08 (朱总): 99 a day was reachable in testing
  PR: { name: "purchase inquiry", digits: 2 },
  PO: { name: "purchase order", digits: 2 },
  IN: { name: "inspection", digits: 2 },
  RP: { name: "repair", digits: 2 },
  PM: { name: "preventive maintenance record", digits: 2 },
  ER: { name: "equipment receiving", digits: 2 },
  TI: { name: "tax invoice", digits: 2 },
  IV: { name: "invoice", digits: 2 },
  BL: { name: "monthly statement", digits: 2 },
  PF: { name: "proforma invoice", digits: 2 },
  IB: { name: "stock in", digits: 3 },
  OB: { name: "stock out", digits: 3 },
  DN: { name: "delivery note", digits: 2 },
  CN: { name: "credit note", digits: 2 },
  DB: { name: "debit note", digits: 2 },
  TF: { name: "spare transfer", digits: 2 },
  RT: { name: "return / send back", digits: 2 },
  SC: { name: "service contract", digits: 2 },
  PV: { name: "payment voucher", digits: 2 },
  TR: { name: "training", digits: 2 },
  RC: { name: "receipt", digits: 2 },
} as const;

export type MasterPrefix = keyof typeof MASTER_PREFIXES;
export type DocPrefix = keyof typeof DOC_PREFIXES;
export type Prefix = MasterPrefix | DocPrefix;

export const COUNTRY_CODES = ["TH", "VN", "CN"] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

const pad = (n: number, w: number) => String(n).padStart(w, "0");
const yy = (d: Date) => pad(d.getFullYear() % 100, 2);
const mm = (d: Date) => pad(d.getMonth() + 1, 2);
const dd = (d: Date) => pad(d.getDate(), 2);

export function isMasterPrefix(p: string): p is MasterPrefix {
  return p in MASTER_PREFIXES;
}
export function isDocPrefix(p: string): p is DocPrefix {
  return p in DOC_PREFIXES;
}

/** Period key for the DocSequence row: "2611" for master data, "261102" for documents. */
export function periodKey(prefix: Prefix, date: Date): string {
  return isMasterPrefix(prefix) ? `${yy(date)}${mm(date)}` : `${yy(date)}${mm(date)}${dd(date)}`;
}

export function serialDigits(prefix: Prefix): number {
  return isMasterPrefix(prefix) ? MASTER_PREFIXES[prefix].digits : DOC_PREFIXES[prefix].digits;
}

/** Country of everything an employee creates comes from their own code: ETH2610001 → TH. */
export function countryFromEmployeeCode(employeeCode: string): CountryCode {
  const m = /^E(TH|VN|CN)\d{7}$/.exec(employeeCode);
  if (!m) throw new Error(`Not a valid employee code: ${employeeCode}`);
  return m[1] as CountryCode;
}

/** Build the number for a given serial. Throws if the serial overflows the width. */
export function formatNumber(prefix: Prefix, country: CountryCode, date: Date, serial: number): string {
  const digits = serialDigits(prefix);
  if (serial < 1 || serial > 10 ** digits - 1) {
    throw new Error(`Serial ${serial} out of range for ${prefix}${country} (${digits} digits)`);
  }
  return `${prefix}${country}${periodKey(prefix, date)}${pad(serial, digits)}`;
}

export interface ParsedNumber {
  prefix: Prefix;
  country: CountryCode;
  period: string;
  serial: number;
  tier: "master" | "document";
}

/** Parse any DCiT number back into its parts; returns null when it does not match the rules. */
export function parseNumber(no: string): ParsedNumber | null {
  const master = /^([ACES])(TH|VN|CN)(\d{4})(\d{3,4})$/.exec(no);
  if (master) {
    const prefix = master[1] as MasterPrefix;
    const digits = MASTER_PREFIXES[prefix].digits;
    if (master[4].length !== digits) return null;
    return { prefix, country: master[2] as CountryCode, period: master[3], serial: Number(master[4]), tier: "master" };
  }
  const doc = /^([A-Z]{2})(TH|VN|CN)(\d{6})(\d{2,3})$/.exec(no);
  if (doc && isDocPrefix(doc[1])) {
    const prefix = doc[1];
    // QT moved from 2 to 3 digits on 2026-11-08: numbers issued before then stay valid.
    if (doc[4].length !== DOC_PREFIXES[prefix].digits && !(prefix === "QT" && doc[4].length === 2)) return null;
    return { prefix, country: doc[2] as CountryCode, period: doc[3], serial: Number(doc[4]), tier: "document" };
  }
  return null;
}

/** The number of the customer's own document is never rewritten — it is stored verbatim beside ours. */
export function keepCustomerRef(ref: string | null | undefined): string | null {
  const v = ref?.trim();
  return v ? v : null;
}
