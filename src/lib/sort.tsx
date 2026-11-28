import Link from "next/link";

/**
 * 列表排序 (朱总 2026-11-28: "表单的排序方式无法调整，例如 CTH 的排序只能升序排列"). A list reads `?sort=code` (ascending) or
 * `?sort=-code` (descending); a click on a column head sorts by it, a second click turns it round. Only the columns a
 * page names can be sorted, so the parameter never reaches the database unchecked.
 */
export function sortOf<O>(raw: string | undefined, cols: Record<string, (dir: "asc" | "desc") => O>, def: string, base: Record<string, string | undefined> = {}) {
  const want = raw && (raw.startsWith("-") ? raw.slice(1) : raw) in cols ? raw : def;
  const desc = want.startsWith("-"), field = desc ? want.slice(1) : want;
  const href = (s: string) => `?${new URLSearchParams({ ...Object.fromEntries(Object.entries(base).filter(([, v]) => v) as [string, string][]), ...(s === def ? {} : { sort: s }) })}`;
  return {
    /** the value to carry in page links and search forms ("" when it is the list's own order) */
    key: want === def ? "" : want,
    orderBy: cols[field](desc ? "desc" : "asc"),
    /** a column head that sorts */
    th: (f: string, label: React.ReactNode) => {
      const on = f === field;
      return <Link href={href(on && !desc ? `-${f}` : f)} scroll={false} className={`inline-flex items-center gap-1 whitespace-nowrap hover:text-blue ${on ? "text-blue" : ""}`} title="↑↓">{label}<span aria-hidden className={on ? "" : "text-navy/30"}>{on ? (desc ? "▼" : "▲") : "↕"}</span></Link>;
    },
  };
}
