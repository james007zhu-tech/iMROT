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
