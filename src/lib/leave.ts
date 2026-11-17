/**
 * 请假 (需求清单 v4 V4-P0-12). The kinds and the days a year the company pays for, by the Labour Protection Act:
 *
 *   SICK       病假        30 paid days a year; three days or more need a medical certificate
 *   PERSONAL   事假        3 paid days a year (necessary business)
 *   ANNUAL     年假        6 paid days a year once the person has worked a full year
 *   MATERNITY  产假        98 days, 45 of them paid by the employer
 *   UNPAID     无薪假      never paid
 *
 * Days are working days: Sundays and company holidays inside the stretch are not counted. One day may be half a day.
 * What goes beyond the paid days of the year is unpaid, like 无薪假: the payroll takes off 月薪 ÷ 30 for each such day.
 */
export const LEAVE_TYPES = ["SICK", "PERSONAL", "ANNUAL", "MATERNITY", "UNPAID"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const SICK_CERT_FROM_DAYS = 3;
const QUOTA: Record<LeaveType, number> = { SICK: 30, PERSONAL: 3, ANNUAL: 6, MATERNITY: 45, UNPAID: 0 };

const utc = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Paid days of a kind in a calendar year. Annual leave starts after one full year of service (as of the year's end). */
export function quotaOf(type: LeaveType, year: number, joinedAt?: Date | null): number {
  if (type !== "ANNUAL") return QUOTA[type];
  if (!joinedAt) return 0;
  const oneYear = new Date(Date.UTC(joinedAt.getUTCFullYear() + 1, joinedAt.getUTCMonth(), joinedAt.getUTCDate()));
  return oneYear.getTime() <= Date.UTC(year, 11, 31) ? QUOTA.ANNUAL : 0;
}

/** The working days of a stretch (YYYY-MM-DD, both ends included), as a list. Maternity leave counts every calendar day. */
export function leaveDays(from: string, to: string, holidays: Iterable<string>, opts: { half?: boolean; calendar?: boolean; restDays?: number[] } = {}): { day: string; part: number }[] {
  const hol = new Set(holidays), rest = opts.restDays ?? [0], out: { day: string; part: number }[] = [];
  for (let d = utc(from); d.getTime() <= utc(to).getTime(); d = new Date(d.getTime() + 86_400_000)) {
    const iso = isoDay(d);
    if (!opts.calendar && (rest.includes(d.getUTCDay()) || hol.has(iso))) continue;
    out.push({ day: iso, part: 1 });
  }
  if (opts.half && from === to && out.length === 1) out[0].part = 0.5;
  return out;
}

export interface LeaveRow { type: LeaveType; days: { day: string; part: number }[] }
/**
 * Paid and unpaid days of one person, in the order the days fall: each kind's paid days of the year are used up first,
 * what comes after is unpaid. Returns per kind what was used and what is left, and the unpaid days by month (YYYY-MM).
 */
export function settleLeave(rows: LeaveRow[], year: number, joinedAt?: Date | null) {
  const used: Record<LeaveType, number> = { SICK: 0, PERSONAL: 0, ANNUAL: 0, MATERNITY: 0, UNPAID: 0 };
  const paid: Record<LeaveType, number> = { SICK: 0, PERSONAL: 0, ANNUAL: 0, MATERNITY: 0, UNPAID: 0 };
  const unpaidByMonth: Record<string, number> = {};
  const all = rows.flatMap((r) => r.days.filter((d) => d.day.startsWith(String(year))).map((d) => ({ ...d, type: r.type }))).sort((a, b) => a.day.localeCompare(b.day));
  for (const d of all) {
    const q = quotaOf(d.type, year, joinedAt), free = Math.max(0, q - paid[d.type]), p = Math.min(free, d.part);
    used[d.type] += d.part; paid[d.type] += p;
    if (d.part - p > 0) unpaidByMonth[d.day.slice(0, 7)] = (unpaidByMonth[d.day.slice(0, 7)] ?? 0) + (d.part - p);
  }
  const left = Object.fromEntries(LEAVE_TYPES.map((t) => [t, Math.max(0, quotaOf(t, year, joinedAt) - paid[t])])) as Record<LeaveType, number>;
  return { used, paid, left, unpaidByMonth };
}

/** 无薪假扣款: 月薪 ÷ 30 × days. */
export const leaveDeduction = (baseSalary: number, unpaidDays: number) => Math.round((baseSalary / 30) * unpaidDays * 100) / 100;
