/**
 * 权限管理: which menu entries a role may open. No row = allowed; the MD is never restricted, and a few entries can
 * never be switched off for anyone (home, one's own file) or on for anyone but the MD (this page itself).
 * This governs the menu and the page behind it. What a person may do inside a page (approve, see salary, void a
 * tax invoice) stays with the fixed rules in the code — shown on the permissions page so nothing is hidden.
 */
import type { EmployeeRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { NAV, navMatch } from "@/lib/nav";

export const ROLES: EmployeeRole[] = ["MD", "ADMIN", "MANAGER", "ENGINEER", "SALES", "FINANCE", "WAREHOUSE"];
export const ALWAYS_ON = new Set(["dash", "shortcuts", "documents", "talent", "overtime", "expenses", "training"]);
export const MD_ONLY = new Set(NAV.flatMap((g) => g.items).filter((i) => i.mdOnly).map((i) => i.key).concat(["permissions"]));

export async function hiddenFor(role: EmployeeRole): Promise<Set<string>> {
  if (role === "MD") return new Set();
  const rows = await prisma.roleMenu.findMany({ where: { role } });
  return new Set([...rows.map((r) => r.key).filter((k) => !ALWAYS_ON.has(k)), ...MD_ONLY]);
}

/** The menu entry a path belongs to, if any. */
export function menuKeyOf(pathWithQuery: string): string | null {
  const [path, q = ""] = pathWithQuery.split("?");
  const query = new URLSearchParams(q);
  let best: { key: string; score: number } | null = null;
  for (const g of NAV) for (const i of g.items) { const s = navMatch(i.href, path, query); if (s > (best?.score ?? 0)) best = { key: i.key, score: s }; }
  return best?.key ?? null;
}

export async function setRoleMenu(actorCode: string, role: EmployeeRole, allowed: string[]) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (a.role !== "MD") throw new Error("MD_ONLY");
  if (role === "MD") throw new Error("MD_ALWAYS_ALL");
  const keys = NAV.flatMap((g) => g.items.map((i) => i.key)).filter((k) => !ALWAYS_ON.has(k) && !MD_ONLY.has(k));
  const hide = keys.filter((k) => !allowed.includes(k));
  await prisma.$transaction([prisma.roleMenu.deleteMany({ where: { role } }), prisma.roleMenu.createMany({ data: hide.map((key) => ({ role, key })) })]);
  await audit(a.id, "ROLE_MENU", role, { hidden: hide });
}

export async function setRole(actorCode: string, code: string, role: EmployeeRole) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (a.role !== "MD") throw new Error("MD_ONLY");
  const e = await prisma.employee.findUniqueOrThrow({ where: { code } });
  // the last MD cannot demote themselves: nobody could then reach this page
  if (e.role === "MD" && role !== "MD" && (await prisma.employee.count({ where: { role: "MD", active: true } })) <= 1) throw new Error("LAST_MD");
  await prisma.employee.update({ where: { id: e.id }, data: { role } });
  await audit(a.id, "ROLE_CHANGE", code, { from: e.role, to: role });
}
