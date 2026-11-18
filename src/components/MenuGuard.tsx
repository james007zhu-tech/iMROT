"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { navMatch } from "@/lib/nav";
import { pathOwners, ROLE_SHORT } from "@/lib/caps";

/**
 * 权限管理, client half: the layout does not re-render when a person moves between pages inside the app, so this
 * checks the page they arrived at — the menu entry it belongs to — against the entries their role may not open.
 */
export function MenuGuard({ items, message, children }: { items: { href: string; blocked: boolean; owners?: string }[]; message: string; children: React.ReactNode }) {
  const path = usePathname();
  const query = useSearchParams();
  let best = { blocked: false, score: 0, owners: "" };
  for (const i of items) { const s = navMatch(i.href, path, query); if (s > best.score) best = { blocked: i.blocked, score: s, owners: i.owners ?? "" }; }
  // 派修单 v5 P1-12: the same list the server gives — a page with a rule of its own (导入 is the MD's alone) names the
  // roles that pass both that rule and the menu entry, not the whole entry's roles.
  const q = query.toString(), own = pathOwners(q ? `${path}?${q}` : path), menu = (best.owners || "MD").split(" / ");
  const roles = own ? ["MD", ...own.map((r) => ROLE_SHORT[r]).filter((r) => menu.includes(r))].join(" / ") : best.owners || "MD";
  return best.blocked ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-navy">{message.replace("{roles}", roles)}</div> : <>{children}</>;
}
