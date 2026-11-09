/**
 * Overtime (加班) rules — Thailand, Labour Protection Act B.E. 2541:
 *   s.61 overtime on a working day ≥ 1.5 × the hourly wage
 *   s.62 work on a holiday ≥ 1 × the hourly wage for staff paid for holidays (all our staff are monthly-paid; 2 × would apply to daily staff)
 *   s.63 overtime on a holiday ≥ 3 × the hourly wage
 *   overtime + holiday overtime ≤ 36 hours a week (ministerial regulation); each occasion needs the employee's consent (the request is it)
 * Hourly wage of a monthly employee = monthly wage ÷ 30 ÷ 8 (the usual LPA method). The basis is the base salary; whether fixed
 * allowances count as "wage" is the accountant's call — the multipliers and the basis are stored on every month-end line,
 * so a later change never rewrites a closed month.
 */
export type OvertimeKind = "WORKDAY_OT" | "HOLIDAY_WORK" | "HOLIDAY_OT";
export const OT_KINDS: OvertimeKind[] = ["WORKDAY_OT", "HOLIDAY_WORK", "HOLIDAY_OT"];
export const OT_MULTIPLIER: Record<OvertimeKind, number> = { WORKDAY_OT: 1.5, HOLIDAY_WORK: 1, HOLIDAY_OT: 3 };
export const WEEKLY_OT_CAP_HOURS = 36; /// WORKDAY_OT + HOLIDAY_OT; holiday work within normal hours does not count
export const DAYS_PER_MONTH = 30;
export const HOURS_PER_DAY = 8;
export const OT_TIME_ZONE = "Asia/Bangkok";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** "18:00"–"21:30" minus break → hours; an end at or before the start runs past midnight. Quarter-hour precision. */
export function overtimeHours(start: string, end: string, breakMinutes = 0): number {
  const m = (t: string) => { const x = /^(\d{1,2}):(\d{2})$/.exec(t.trim()); if (!x || +x[1] > 23 || +x[2] > 59) throw new Error(`BAD_TIME:${t}`); return +x[1] * 60 + +x[2]; };
  let mins = m(end) - m(start);
  if (mins <= 0) mins += 24 * 60;
  mins -= breakMinutes;
  if (mins <= 0) throw new Error("OT_NO_HOURS");
  return Math.round((mins / 60) * 4) / 4;
}

export function hourlyWage(monthlyBase: number): number {
  return r2(monthlyBase / DAYS_PER_MONTH / HOURS_PER_DAY);
}

/** Month key "2026-11" of a work date (stored as UTC midnight of the local date). */
export function monthKeyOf(workDate: Date): string {
  return workDate.toISOString().slice(0, 7);
}

/** First and last+1 day of a month key, as UTC midnights — the same convention as work dates. */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number);
  return { from: new Date(Date.UTC(y, m - 1, 1)), to: new Date(Date.UTC(y, m, 1)) };
}

/** Monday 00:00 and next Monday of the week holding a work date (UTC-midnight convention). */
export function weekRange(workDate: Date): { from: Date; to: Date } {
  const d = new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), workDate.getUTCDate()));
  const back = (d.getUTCDay() + 6) % 7;
  const from = new Date(d.getTime() - back * 86_400_000);
  return { from, to: new Date(from.getTime() + 7 * 86_400_000) };
}

/** Today's date and the month before it in Bangkok — month end is judged on local time, not the server's. */
export function localToday(now = new Date()): { date: string; month: string; previousMonth: string } {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: OT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m] = date.split("-").map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return { date, month: date.slice(0, 7), previousMonth: prev };
}

export interface OtLineInput { hours: Partial<Record<OvertimeKind, number>>; baseSalary: number }
export interface OtLine { hourlyRate: number; hours: Record<OvertimeKind, number>; amounts: Record<OvertimeKind, number>; totalHours: number; total: number }

/** One employee's month: hours by kind × multiplier × hourly wage. */
export function overtimePay(i: OtLineInput): OtLine {
  const hourlyRate = hourlyWage(i.baseSalary);
  const hours = { WORKDAY_OT: 0, HOLIDAY_WORK: 0, HOLIDAY_OT: 0 } as Record<OvertimeKind, number>;
  const amounts = { WORKDAY_OT: 0, HOLIDAY_WORK: 0, HOLIDAY_OT: 0 } as Record<OvertimeKind, number>;
  for (const k of OT_KINDS) {
    hours[k] = r2(i.hours[k] ?? 0);
    amounts[k] = r2(hours[k] * hourlyRate * OT_MULTIPLIER[k]);
  }
  return { hourlyRate, hours, amounts, totalHours: r2(OT_KINDS.reduce((s, k) => s + hours[k], 0)), total: r2(OT_KINDS.reduce((s, k) => s + amounts[k], 0)) };
}

/** Hours that count against the 36-hour weekly cap. */
export function capHours(kind: OvertimeKind, hours: number): number {
  return kind === "HOLIDAY_WORK" ? 0 : hours;
}
