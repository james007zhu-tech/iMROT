/** A date picked in a form (YYYY-MM-DD) as that day at the current time, so documents keep their real order in timelines. */
export function dayNow(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v);
  const now = new Date();
  const d = new Date(`${v}T00:00:00`);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  return d;
}

/** Short date for tables and timelines: "11-03" within the current year, "2025-11-03" otherwise (work often spans days or years). */
export function shortDate(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}-${md}`;
}

/**
 * A moment as local wall-clock text, "2026-11-14T10:05:09" — what `toISOString()` would say if it did not switch to
 * Greenwich time (trial finding 2026-11-14: pages showed times seven hours behind Bangkok, and before 07:00 the
 * previous day). The server runs on Asia/Bangkok (TZ), so slices of this are the date and time people actually saw.
 */
export function localIso(d: Date | null | undefined): string | undefined {
  if (!d) return undefined;
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getFullYear(), 4)}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
