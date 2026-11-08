/**
 * Session: employee login (OPD) and portal contact login (CRM). Cookie-based, httpOnly, 7 days.
 * Phase 1 is deliberately simple: email + password (scrypt). SSO can replace signIn later without touching callers.
 */
import { cookies } from "next/headers";
import { createHmac } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";
export { hashPassword, verifyPassword };

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-me";
const COOKIE = "dcit_session";
const PORTAL_COOKIE = "dcit_portal";

function sign(payload: string): string {
  return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("hex")}`;
}
function verify(token: string | undefined): string | null {
  if (!token) return null;
  const i = token.lastIndexOf(".");
  if (i < 0) return null;
  const payload = token.slice(0, i);
  return sign(payload) === token ? payload : null;
}

export async function signInEmployee(email: string, password: string): Promise<boolean> {
  const e = await prisma.employee.findUnique({ where: { email } });
  if (!e || !e.active || !verifyPassword(password, e.passwordHash)) return false;
  (await cookies()).set(COOKIE, sign(`${e.code}|${Date.now()}`), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  await prisma.employee.update({ where: { id: e.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined); // shown on the ETH file
  return true;
}
export async function signOut() { (await cookies()).delete(COOKIE); }

/**
 * Dev-only login bypass. Off unless DEV_AUTH_BYPASS=on outside production, and never while a portal contact is signed in:
 * the old default (DEV_EMPLOYEE_CODE alone, copied from .env.example) made every request — portal ones included — act as the MD,
 * which broke portal isolation (trial 2026-11-05).
 */
async function devEmployeeCode(): Promise<string | null> {
  if (process.env.NODE_ENV === "production" || process.env.DEV_AUTH_BYPASS !== "on") return null;
  if (verify((await cookies()).get(PORTAL_COOKIE)?.value)) return null;
  return process.env.DEV_EMPLOYEE_CODE ?? null;
}

/** Signed-in employee code without redirecting (for API routes). */
export async function sessionEmployeeCode(): Promise<string | null> {
  const payload = verify((await cookies()).get(COOKIE)?.value);
  return payload?.split("|")[0] ?? (await devEmployeeCode());
}
/** Signed-in portal contact id without redirecting. */
export async function sessionContactId(): Promise<string | null> {
  const payload = verify((await cookies()).get(PORTAL_COOKIE)?.value);
  return payload?.split("|")[0] ?? null;
}

/** Signed-in employee, or redirect to /login. */
export async function currentEmployee() {
  const code = await sessionEmployeeCode();
  if (!code) redirect("/login");
  const e = await prisma.employee.findUnique({ where: { code } });
  if (!e || !e.active) redirect("/login");
  return e;
}

export async function signInContact(login: string, password: string): Promise<boolean> {
  const c = await prisma.contact.findUnique({ where: { portalLogin: login } });
  if (!c || !verifyPassword(password, c.portalPasswordHash)) return false;
  (await cookies()).set(PORTAL_COOKIE, sign(`${c.id}|${Date.now()}`), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 7 * 86400 });
  return true;
}
export async function signOutContact() { (await cookies()).delete(PORTAL_COOKIE); }

/** Portal: the contact and the customer whose data they may see — nothing else. */
export async function currentContact() {
  const payload = verify((await cookies()).get(PORTAL_COOKIE)?.value);
  const id = payload?.split("|")[0];
  if (!id) redirect("/portal/login");
  const c = await prisma.contact.findUnique({ where: { id }, include: { customer: true } });
  if (!c) redirect("/portal/login");
  return c;
}

const REVEAL_COOKIE = "dcit_reveal";
const REVEAL_MS = 5 * 60 * 1000;

/** After a password re-check: show this customer's contacts in full for five minutes. */
export async function grantReveal(employeeCode: string, customerCode: string) {
  (await cookies()).set(REVEAL_COOKIE, sign(`${employeeCode}|${customerCode}|${Date.now() + REVEAL_MS}`), { httpOnly: true, sameSite: "lax", path: "/", maxAge: REVEAL_MS / 1000 });
}
export async function revealActive(customerCode: string): Promise<boolean> {
  const p = verify((await cookies()).get(REVEAL_COOKIE)?.value);
  if (!p) return false;
  const [emp, cust, until] = p.split("|");
  return cust === customerCode && Number(until) > Date.now() && emp === (await sessionEmployeeCode());
}
