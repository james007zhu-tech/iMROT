/**
 * 消息中心 (朱总 2026-11-10) — what the system reminds a person of, without being asked. Pure date rules here;
 * the queries are in src/server/notify.ts. Every message carries the record it is about and a link to act on it.
 */
export type NoticeLevel = "late" | "soon";
export interface Notice { id: string; kind: string; level: NoticeLevel; days: number; ref: string; who?: string; href: string }

const DAY = 86_400_000;
const utcDay = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());

/** Whole days from today to `due` (negative = overdue), by calendar day. */
export function daysUntil(due: Date, today = new Date()): number {
  return Math.round((Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate()) - utcDay(today)) / DAY);
}

/** Days to the next birthday for "MM-DD" (or a birth date); null when unparseable. 29 Feb counts as 28 Feb in common years. */
export function daysToBirthday(b: string | Date | null | undefined, today = new Date()): number | null {
  if (!b) return null;
  const [m, d] = b instanceof Date ? [b.getUTCMonth() + 1, b.getUTCDate()] : (/^(\d{1,2})-(\d{1,2})$/.exec(b.trim())?.slice(1).map(Number) ?? [0, 0]);
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const at = (y: number) => { const leap = new Date(Date.UTC(y, 1, 29)).getUTCMonth() === 1; return Date.UTC(y, m - 1, m === 2 && d === 29 && !leap ? 28 : d); };
  const t = utcDay(today);
  const next = at(today.getFullYear()) >= t ? at(today.getFullYear()) : at(today.getFullYear() + 1);
  return Math.round((next - t) / DAY);
}

/** "MM-DD" from what a person typed (11-25, 11/25, 25 Nov is not accepted); "" clears; throws BAD_BIRTHDAY. */
export function cleanBirthday(v: string | undefined | null): string | null {
  const s = v?.trim();
  if (!s) return null;
  const m = /^(?:\d{4}[-/.])?(\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (!m || daysToBirthday(`${m[1]}-${m[2]}`) == null) throw new Error(`BAD_BIRTHDAY:${s}`);
  return `${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

/** The earliest date a customer needs something on an order: project due date, or the first needed-by of its lines. */
export function orderDue(o: { project?: unknown; requestLines?: unknown }): Date | null {
  const dates: string[] = [];
  const p = o.project as { dueDate?: string } | null;
  if (p?.dueDate) dates.push(p.dueDate);
  if (Array.isArray(o.requestLines)) for (const l of o.requestLines as { neededBy?: string }[]) if (l?.neededBy) dates.push(l.neededBy);
  const ts = dates.map((d) => Date.parse(d)).filter((n) => !Number.isNaN(n));
  return ts.length ? new Date(Math.min(...ts)) : null;
}

/** Late first, then the nearest date. */
export const sortNotices = (n: Notice[]) => [...n].sort((a, b) => a.days - b.days || a.kind.localeCompare(b.kind));

/** Kinds the assistant can take further in one tap (messages "msg" namespace: ask_<kind>). */
export const ASKABLE = new Set(["delivery", "quoteWaiting", "maintenanceDue", "receivable", "milestone"]);
