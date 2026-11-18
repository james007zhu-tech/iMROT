/**
 * 班次、午休、假日日历 (需求清单 v3 P1-35, P0-09). The employee types when they started and stopped; this module says what
 * that day was — normal hours and overtime by the Labour Protection Act — so nobody picks a multiplier by hand.
 *
 *   working day   hours inside the shift are normal; before the shift starts and after it ends = WORKDAY_OT ×1.5
 *   rest day / public holiday (monthly-paid staff)   inside the shift = HOLIDAY_WORK ×1; before and after it = HOLIDAY_OT ×3
 *
 * The lunch break of the shift is taken off a day that runs across it. A rest during overtime is taken off only when the
 * employee recorded it (the law asks for 20 minutes before more than 2 hours of overtime; the system never deducts time
 * the person did not report). Company standard shift, MD 2026-11-16: 08:30–17:30, lunch 1 h.
 */
import type { OvertimeKind } from "./overtime";

export interface Shift { start: string; end: string; breakMinutes: number }
export const DEFAULT_SHIFT: Shift = { start: "08:30", end: "17:30", breakMinutes: 60 };
export const DEFAULT_REST_DAYS = [0]; // Sunday (0 = Sunday … 6 = Saturday)
export type DayKind = "WORKDAY" | "REST" | "HOLIDAY";
export interface Segment { kind: OvertimeKind; start: string; end: string; breakMinutes: number; hours: number }
export interface DaySplit { dayKind: DayKind; worked: number; normal: number; lunch: number; segments: Segment[]; overtime: number }

const mins = (t: string) => { const x = /^(\d{1,2}):(\d{2})$/.exec(t.trim()); if (!x || +x[1] > 23 || +x[2] > 59) throw new Error(`BAD_TIME:${t}`); return +x[1] * 60 + +x[2]; };
const hhmm = (m: number) => { const d = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(d % 60).padStart(2, "0")}`; };
const q = (m: number) => Math.round((m / 60) * 4) / 4; // quarter hours, as overtime is counted everywhere else

/** What kind of day a date (YYYY-MM-DD) is for this company. */
export function dayKindOf(dateIso: string, holidays: Iterable<string>, restDays: number[] = DEFAULT_REST_DAYS): DayKind {
  if (new Set(holidays).has(dateIso)) return "HOLIDAY";
  const [y, m, d] = dateIso.split("-").map(Number);
  return restDays.includes(new Date(Date.UTC(y, m - 1, d)).getUTCDay()) ? "REST" : "WORKDAY";
}

/**
 * Split one stretch of work. `otBreakMinutes` is rest the employee recorded during overtime (taken off the last
 * overtime stretch). An end at or before the start runs past midnight and stays with the day it started on.
 */
export function splitWork(i: { dayKind: DayKind; shift?: Shift; start: string; end: string; otBreakMinutes?: number }): DaySplit {
  const shift = i.shift ?? DEFAULT_SHIFT;
  const s = mins(i.start); let e = mins(i.end); if (e <= s) e += 1440;
  const ss = mins(shift.start), se = mins(shift.end), rest = Math.max(0, i.otBreakMinutes ?? 0);
  const segments: Segment[] = [];
  const add = (kind: OvertimeKind, from: number, to: number, brk = 0) => { const h = q(to - from - brk); if (h > 0) segments.push({ kind, start: hhmm(from), end: hhmm(to), breakMinutes: brk, hours: h }); };
  // lunch comes off a day that runs across the shift's middle (more than 5 hours on site)
  const lunch = e - s > 300 ? shift.breakMinutes : 0;
  if (i.dayKind === "WORKDAY") {
    const inShift = Math.max(0, Math.min(e, se) - Math.max(s, ss));
    const normal = q(Math.max(0, inShift - (inShift > 300 ? shift.breakMinutes : 0)));
    if (s < ss) add("WORKDAY_OT", s, Math.min(e, ss));
    if (e > se) add("WORKDAY_OT", Math.max(s, se), e, Math.min(rest, Math.max(0, e - Math.max(s, se))));
    return { dayKind: i.dayKind, worked: q(e - s - (inShift > 300 ? shift.breakMinutes : 0) - rest), normal, lunch: inShift > 300 ? shift.breakMinutes : 0, segments, overtime: segments.reduce((a, x) => a + x.hours, 0) };
  }
  // rest day or holiday (H-R69, 派修单 v3 第 3 条): inside the normal working hours = holiday work ×1; before the shift
  // starts and after it ends = holiday overtime ×3 — also when the person only came in the evening.
  const inShift = Math.max(0, Math.min(e, se) - Math.max(s, ss)), lunchIn = inShift > 300 ? shift.breakMinutes : 0;
  if (s < ss) add("HOLIDAY_OT", s, Math.min(e, ss));
  if (inShift > 0) add("HOLIDAY_WORK", Math.max(s, ss), Math.min(e, se), lunchIn);
  if (e > se) add("HOLIDAY_OT", Math.max(s, se), e, Math.min(rest, Math.max(0, e - Math.max(s, se))));
  return { dayKind: i.dayKind, worked: q(e - s - lunchIn - rest), normal: 0, lunch: lunchIn, segments, overtime: segments.reduce((a, x) => a + x.hours, 0) };
}

/** Do two stretches of the same day overlap? (for "already requested — not generated twice") */
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const a0 = mins(aStart); let a1 = mins(aEnd); if (a1 <= a0) a1 += 1440;
  const b0 = mins(bStart); let b1 = mins(bEnd); if (b1 <= b0) b1 += 1440;
  return a0 < b1 && b0 < a1;
}
