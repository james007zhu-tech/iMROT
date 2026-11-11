"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { navMatch } from "@/lib/nav";

/**
 * 权限管理, client half: the layout does not re-render when a person moves between pages inside the app, so this
 * checks the page they arrived at — the menu entry it belongs to — against the entries their role may not open.
 */
export function MenuGuard({ items, message, children }: { items: { href: string; blocked: boolean }[]; message: string; children: React.ReactNode }) {
  const path = usePathname();
  const query = useSearchParams();
  let best = { blocked: false, score: 0 };
  for (const i of items) { const s = navMatch(i.href, path, query); if (s > best.score) best = { blocked: i.blocked, score: s }; }
  return best.blocked ? <div className="rounded-xl border bg-white p-8 text-center text-sm text-navy">{message}</div> : <>{children}</>;
}
