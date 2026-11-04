/** A date picked in a form (YYYY-MM-DD) as that day at the current time, so documents keep their real order in timelines. */
export function dayNow(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(v);
  const now = new Date();
  const d = new Date(`${v}T00:00:00`);
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds());
  return d;
}
