/**
 * Session: employee login (OPD) and portal contact login (CRM). Cookie-based, httpOnly, 7 days.
 * Phase 1 is deliberately simple: email + password (scrypt). SSO can replace signIn later without touching callers.
 */
import { cookies, headers } from "next/headers";
import { overHttps } from "@/server/login-guard";
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

/** Why a sign-in failed is told to the person (an internal system: knowing "no such address" from "wrong password" ends the guessing). */
export type SignIn = "ok" | "no-account" | "inactive" | "wrong-password";
export async function signInEmployee(email: string, password: string): Promise<SignIn> {
  // a phone keyboard may capitalise the first letter or leave a space: the address is matched whatever its case
  const e = await prisma.employee.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
  // what a phone keyboard does to a password: a space after it, full-width letters from a Chinese input method.
  // The password as typed is tried first, then the same characters in their plain form.
  const plain = password.normalize("NFKC").trim();
  const good = !!e && e.active && (verifyPassword(password, e.passwordHash) || (plain !== password && verifyPassword(plain, e.passwordHash)));
  if (!good) {
    // why a sign-in failed, without the password itself (2026-11-15: "same name, same password" failed on a phone only)
    const h = await headers();
    console.warn(`[login-fail] ${new Date().toISOString()} why=${!e ? "no-account" : !e.active ? "inactive" : "wrong-password"} email=${JSON.stringify(email)} pw.len=${password.length} pw.plain.len=${plain.length} pw.nonAscii=${/[^\x20-\x7e]/.test(password)} ua=${JSON.stringify((h.get("user-agent") ?? "").slice(0, 140))}`);
    return !e ? "no-account" : !e.active ? "inactive" : "wrong-password";
  }
  (await cookies()).set(COOKIE, sign(`${e!.code}|${Date.now()}`), { httpOnly: true, sameSite: "lax", secure: await overHttps(), path: "/", maxAge: 7 * 86400 });
  await prisma.employee.update({ where: { id: e!.id }, data: { lastLoginAt: new Date() } }).catch(() => undefined); // shown on the ETH file
  return "ok";
}
/** Whether an address belongs to a member of staff (the portal door sends staff to their own sign-in). */
export async function isStaffEmail(email: string): Promise<boolean> {
  return !!(await prisma.employee.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true } }));
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
  if (!payload) return devEmployeeCode();
  // A session ends when its owner's password changes after it began, or the account is switched off
  // (朱总 2026-11-15: after a password change the other devices stayed signed in — the old password kept "working").
  const [code, at] = payload.split("|");
  const e = await prisma.employee.findUnique({ where: { code }, select: { active: true, passwordChangedAt: true } });
  if (!e || !e.active || (e.passwordChangedAt && Number(at) < e.passwordChangedAt.getTime())) return null;
  return code;
}
/** After its owner changed the password on this device: this device stays signed in, with a session newer than the change. */
export async function renewSession(code: string) {
  (await cookies()).set(COOKIE, sign(`${code}|${Date.now() + 1000}`), { httpOnly: true, sameSite: "lax", secure: await overHttps(), path: "/", maxAge: 7 * 86400 });
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
  (await cookies()).set(PORTAL_COOKIE, sign(`${c.id}|${Date.now()}`), { httpOnly: true, sameSite: "lax", secure: await overHttps(), path: "/", maxAge: 7 * 86400 });
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
  (await cookies()).set(REVEAL_COOKIE, sign(`${employeeCode}|${customerCode}|${Date.now() + REVEAL_MS}`), { httpOnly: true, sameSite: "lax", secure: await overHttps(), path: "/", maxAge: REVEAL_MS / 1000 });
}
export async function revealActive(customerCode: string): Promise<boolean> {
  const p = verify((await cookies()).get(REVEAL_COOKIE)?.value);
  if (!p) return false;
  const [emp, cust, until] = p.split("|");
  return cust === customerCode && Number(until) > Date.now() && emp === (await sessionEmployeeCode());
}
