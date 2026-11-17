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
import { menuAllows, menuOwners, pathOwners, rolesOf, hasRole, ROLE_SHORT, type Who } from "@/lib/caps";

export const ROLES: EmployeeRole[] = ["MD", "HR", "FINANCE", "PURCHASING", "SALES", "ENGINEER"];
export const ALWAYS_ON = new Set(["dash", "shortcuts", "documents", "talent", "overtime", "leave", "expenses", "training"]);
export const MD_ONLY = new Set(NAV.flatMap((g) => g.items).filter((i) => i.mdOnly).map((i) => i.key).concat(["permissions"]));

/** Entries only the people who handle the company's money may open, whatever the table says (the page refuses the rest). */
export const MONEY_ONLY: Record<string, EmployeeRole[]> = { cashPlan: ["MD", "FINANCE"] };
const ALL_KEYS = NAV.flatMap((g) => g.items.map((i) => i.key));

/** Menu entries this person may not open. Several roles: an entry is hidden only when every one of their roles hides it. */
export async function hiddenFor(who: Who): Promise<Set<string>> {
  const roles = rolesOf(who);
  if (roles.includes("MD")) return new Set();
  const rows = await prisma.roleMenu.findMany({ where: { role: { in: roles as EmployeeRole[] } } });
  const off = (role: string, key: string) => !menuAllows(role, key) || (!ALWAYS_ON.has(key) && rows.some((r) => r.role === role && r.key === key)) || MD_ONLY.has(key) || (MONEY_ONLY[key] && !MONEY_ONLY[key].includes(role as EmployeeRole));
  return new Set(ALL_KEYS.filter((k) => roles.every((r) => off(r, k))));
}

/** 「无权限，此功能属于 XX 角色」: the roles a page belongs to, as written on screen. */
export function ownersOf(pathWithQuery: string): string {
  const key = menuKeyOf(pathWithQuery);
  const byPath = pathOwners(pathWithQuery.split("?")[0]);
  const byMenu = key ? (MD_ONLY.has(key) ? [] : menuOwners(key)) : null;
  const owners = byPath.length && byMenu ? byPath.filter((r) => byMenu.includes(r)) : byPath.length ? byPath : byMenu ?? [];
  return ["MD", ...owners.map((r) => ROLE_SHORT[r])].join(" / ");
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
  if (!hasRole(a, "MD")) throw new Error("MD_ONLY");
  if (role === "MD") throw new Error("MD_ALWAYS_ALL");
  const keys = ALL_KEYS.filter((k) => !ALWAYS_ON.has(k) && !MD_ONLY.has(k) && menuAllows(role, k));
  const hide = keys.filter((k) => !allowed.includes(k));
  await prisma.$transaction([prisma.roleMenu.deleteMany({ where: { role } }), prisma.roleMenu.createMany({ data: hide.map((key) => ({ role, key })) })]);
  await audit(a.id, "ROLE_MENU", role, { hidden: hide });
}

export async function setRole(actorCode: string, code: string, role: EmployeeRole, extraRoles?: EmployeeRole[], approver?: boolean) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (!hasRole(a, "MD")) throw new Error("MD_ONLY");
  if (!ROLES.includes(role) || extraRoles?.some((x) => !ROLES.includes(x))) throw new Error("ROLE_UNKNOWN");
  const e = await prisma.employee.findUniqueOrThrow({ where: { code } });
  // the last MD cannot demote themselves: nobody could then reach this page
  if (e.role === "MD" && role !== "MD" && (await prisma.employee.count({ where: { role: "MD", active: true } })) <= 1) throw new Error("LAST_MD");
  const extra = extraRoles ? [...new Set(extraRoles)].filter((x) => x !== role && x !== "MD") : undefined;
  await prisma.employee.update({ where: { id: e.id }, data: { role, extraRoles: extra, approver } });
  await audit(a.id, "ROLE_CHANGE", code, { from: [e.role, ...e.extraRoles], to: [role, ...(extra ?? e.extraRoles)], approver: approver ?? e.approver });
}
