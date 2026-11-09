/**
 * 法人收款银行信息 — stored on LegalEntity.bankDetails (Json). One bank per entity, one account per currency.
 * Printed on invoices and tax invoices (BANK_LINES): the bank, each account, the account name, SWIFT.
 * Currency keys are ISO codes; "RMB" (as written on Thai bank books) is stored as CNY so it matches CNY invoices.
 */
export interface BankDetails { bank?: string; branch?: string; bankCode?: string; branchCode?: string; accountName?: string; swift?: string; accounts?: Record<string, string> }

/** Currencies the form always offers, after the entity's own currency. */
export const BANK_CURRENCIES = ["THB", "USD", "CNY", "EUR"];

export const normCcy = (c: string) => { const x = c.trim().toUpperCase(); return x === "RMB" ? "CNY" : x; };

/** Accounts with normalised currency keys (an old "RMB" key reads as CNY). */
export function bankAccounts(b: BankDetails | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [c, a] of Object.entries(b?.accounts ?? {})) if (a?.trim()) out[normCcy(c)] = a.trim();
  return out;
}

/** Rows the form shows: the entity's currency first, the usual four, then any other currency already on file. */
export function bankCurrencies(localCurrency: string, b: BankDetails | null | undefined): string[] {
  return [...new Set([normCcy(localCurrency), ...BANK_CURRENCIES, ...Object.keys(bankAccounts(b))])];
}

/**
 * Cleans what the form sent. Empty → null (no bank on file). Errors: BAD_SWIFT (8 or 11 letters/digits),
 * BAD_ACCOUNT:<CCY> (letters, digits, spaces and dashes only — kept as text so leading zeros survive),
 * BAD_CURRENCY:<x>, BANK_ACCOUNT_NO_BANK (an account without the bank's name).
 */
export function cleanBankDetails(raw: BankDetails): BankDetails | null {
  const s = (v?: string) => v?.trim().replace(/\s+/g, " ") || undefined;
  const swift = s(raw.swift)?.toUpperCase().replace(/\s/g, "");
  if (swift && !/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(swift)) throw new Error(`BAD_SWIFT:${swift}`);
  const accounts: Record<string, string> = {};
  for (const [c, a] of Object.entries(raw.accounts ?? {})) {
    const acc = a?.trim();
    if (!acc) continue;
    const ccy = normCcy(c);
    if (!/^[A-Z]{3}$/.test(ccy)) throw new Error(`BAD_CURRENCY:${c}`);
    if (!/^[A-Z0-9][A-Z0-9 -]*$/i.test(acc)) throw new Error(`BAD_ACCOUNT:${ccy}`);
    accounts[ccy] = acc.toUpperCase();
  }
  const out: BankDetails = { bank: s(raw.bank), branch: s(raw.branch), bankCode: s(raw.bankCode), branchCode: s(raw.branchCode), accountName: s(raw.accountName), swift };
  for (const k of Object.keys(out) as (keyof BankDetails)[]) if (out[k] === undefined) delete out[k];
  if (Object.keys(accounts).length) out.accounts = accounts;
  if (!Object.keys(out).length) return null;
  if (out.accounts && !out.bank) throw new Error("BANK_ACCOUNT_NO_BANK");
  return out;
}

/** One line per item (rule: no " · " joins): bank + branch, each account, account name, SWIFT. With a currency: that account and THB. */
export function bankLines(b: BankDetails | null | undefined, currency?: string): string {
  if (!b) return "";
  const accounts = Object.entries(bankAccounts(b));
  const want = currency ? normCcy(currency) : undefined;
  const shown = want && accounts.some(([c]) => c === want) ? accounts.filter(([c]) => c === want || c === "THB") : accounts;
  const branch = b.branch ? `${b.branch}${b.bankCode ? ` (${b.bankCode}-${b.branchCode ?? ""})` : ""}` : "";
  return [[b.bank, branch].filter(Boolean).join(", "), ...shown.map(([c, a]) => `${c} ${a}`), b.accountName ? `Account name: ${b.accountName}` : "", b.swift ? `SWIFT ${b.swift}` : ""].filter(Boolean).join("\n");
}
