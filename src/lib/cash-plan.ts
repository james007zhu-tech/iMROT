/**
 * 现金计划, the arithmetic (no database): what a month's lines add up to, day by day.
 * THB only in the totals — a line in another currency is listed with its own amount and left out of the sums.
 */
export type CashKind = "SUPPLIER" | "FIXED" | "PAYROLL" | "SSO" | "PND1" | "PND53" | "VAT" | "EXPENSE" | "RECEIVABLE";
export interface CashLine {
  date: string; /// YYYY-MM-DD, the day the money moves
  dir: "OUT" | "IN";
  kind: CashKind;
  party: string;
  what: string;
  amount: number;
  currency: string;
  ref?: string;
  href?: string;
  fixed?: boolean; /// the amount and day are known for certain
  estimate?: boolean; /// worked out, not yet a document
  overdue?: boolean; /// was due before this month began
}
export interface CashTotals { out: number; in: number; net: number; fixedOut: number; overdueOut: number; overdueIn: number; foreign: { currency: string; out: number; in: number }[] }

const r2 = (n: number) => Math.round(n * 100) / 100;
export const monthStart = (month: string) => `${month}-01`;
export const lastDay = (month: string) => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
export const dayIn = (month: string, day: number) => `${month}-${String(Math.min(Math.max(1, day), lastDay(month))).padStart(2, "0")}`;
export const prevMonth = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
export const nextMonth = (month: string) => { const [y, m] = month.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };

/** A fixed payment is in a month when the month is inside its span. */
export const recursIn = (r: { startMonth: string; endMonth?: string | null; active: boolean }, month: string) => r.active && r.startMonth <= month && (!r.endMonth || month <= r.endMonth);

export function sortLines(lines: CashLine[]): CashLine[] {
  return [...lines].sort((a, b) => a.date.localeCompare(b.date) || (a.dir === b.dir ? 0 : a.dir === "OUT" ? -1 : 1) || b.amount - a.amount);
}
export function totalsOf(lines: CashLine[]): CashTotals {
  const thb = lines.filter((l) => l.currency === "THB");
  const sum = (f: (l: CashLine) => boolean) => r2(thb.filter(f).reduce((s, l) => s + l.amount, 0));
  const foreign = [...new Set(lines.filter((l) => l.currency !== "THB").map((l) => l.currency))].map((currency) => ({ currency, out: r2(lines.filter((l) => l.currency === currency && l.dir === "OUT").reduce((s, l) => s + l.amount, 0)), in: r2(lines.filter((l) => l.currency === currency && l.dir === "IN").reduce((s, l) => s + l.amount, 0)) }));
  const out = sum((l) => l.dir === "OUT"), inn = sum((l) => l.dir === "IN");
  return { out, in: inn, net: r2(inn - out), fixedOut: sum((l) => l.dir === "OUT" && !!l.fixed), overdueOut: sum((l) => l.dir === "OUT" && !!l.overdue), overdueIn: sum((l) => l.dir === "IN" && !!l.overdue), foreign };
}
/** The balance after each day, from an opening balance: what is left if everything is paid and collected on its day. */
export function runningBalance(lines: CashLine[], opening: number): { date: string; out: number; in: number; balance: number }[] {
  const days = new Map<string, { out: number; in: number }>();
  for (const l of lines) { if (l.currency !== "THB") continue; const d = days.get(l.date) ?? { out: 0, in: 0 }; d[l.dir === "OUT" ? "out" : "in"] += l.amount; days.set(l.date, d); }
  let bal = opening;
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => { bal = r2(bal + d.in - d.out); return { date, out: r2(d.out), in: r2(d.in), balance: bal }; });
}
