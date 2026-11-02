/**
 * Session: employee login (OPD) and portal contact login (CRM). Cookie-based, httpOnly, 7 days.
 * Phase 1 is deliberately simple: email + password (scrypt). SSO can replace signIn later without touching callers.
 */
import { cookies } from "next/headers";
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

const SECRET = process.env.SESSION_SECRET ?? "dev-secret-change-me";
const COOKIE = "dcit_session";
const PORTAL_COOKIE = "dcit_portal";

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}
export function verifyPassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [salt, hash] = stored.split(":");
  const h = scryptSync(pw, salt, 32);
  return timingSafeEqual(h, Buffer.from(hash, "hex"));
}

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
  return true;
}
export async function signOut() { (await cookies()).delete(COOKIE); }

/** Signed-in employee code without redirecting (for API routes). Honours DEV_EMPLOYEE_CODE outside production. */
export async function sessionEmployeeCode(): Promise<string | null> {
  const payload = verify((await cookies()).get(COOKIE)?.value);
  return payload?.split("|")[0] ?? (process.env.NODE_ENV !== "production" ? process.env.DEV_EMPLOYEE_CODE ?? null : null);
}
/** Signed-in portal contact id without redirecting. */
export async function sessionContactId(): Promise<string | null> {
  const payload = verify((await cookies()).get(PORTAL_COOKIE)?.value);
  return payload?.split("|")[0] ?? null;
}

/** Dev fallback: DEV_EMPLOYEE_CODE lets the app run before login pages exist. Never set it in production. */
export async function currentEmployee() {
  const payload = verify((await cookies()).get(COOKIE)?.value);
  const code = payload?.split("|")[0] ?? process.env.DEV_EMPLOYEE_CODE;
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
