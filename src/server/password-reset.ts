/**
 * 忘记密码 (decision 2026-11-14). The system sends no mail yet, so a forgotten password is recovered through a person:
 *   1. on the sign-in page the employee asks for a reset — every MD sees it in the message centre;
 *   2. an MD opens the ETH file and issues a link (single use, 30 minutes) and passes it on by LINE or WeChat;
 *   3. the employee opens the link and types a new password. Nobody else ever sees or types the password.
 * The operator can issue the same link from the server (scripts/dev/reset-link.ts) when no MD can sign in.
 */
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/password";

const LINK_MINUTES = 30, ASK_HOURS = 24;
const sha = (t: string) => createHash("sha256").update(t).digest("hex");
export const MIN_PASSWORD = 8;

/** Step 1. Says nothing about whether the address belongs to anyone. One open request per person is enough. */
export async function requestReset(email: string) {
  const e = await prisma.employee.findUnique({ where: { email: email.trim().toLowerCase() } }) ?? await prisma.employee.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } } });
  if (!e || !e.active) return;
  const open = await prisma.passwordReset.findFirst({ where: { employeeId: e.id, via: "SELF", tokenHash: null, requestedAt: { gte: new Date(Date.now() - ASK_HOURS * 3600_000) } } });
  if (!open) await prisma.passwordReset.create({ data: { employeeId: e.id, via: "SELF" } });
}

/** Requests still waiting for an MD (message centre and ETH file). */
export async function openResetRequests() {
  return prisma.passwordReset.findMany({ where: { via: "SELF", tokenHash: null, requestedAt: { gte: new Date(Date.now() - ASK_HOURS * 3600_000) }, employee: { active: true } }, select: { requestedAt: true, employee: { select: { code: true, name: true } } }, orderBy: { requestedAt: "asc" } });
}

/** Step 2. The token is returned once and never stored; issuing a new link cancels the earlier ones. */
export async function issueResetLink(input: { employeeCode: string; actorCode?: string }) {
  const e = await prisma.employee.findUniqueOrThrow({ where: { code: input.employeeCode } });
  if (!e.active) throw new Error(`EMPLOYEE_INACTIVE:${e.code}`);
  const actor = input.actorCode ? await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } }) : null;
  // the MD for anyone; HR for staff other than the MD (a new person sets their own password through this link)
  if (actor && !(actor.role === "MD" || (actor.role === "HR" && e.role !== "MD"))) throw new Error("MD_ONLY");
  const token = randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    await tx.passwordReset.deleteMany({ where: { employeeId: e.id, usedAt: null } }); // the request is answered, older links die
    await tx.passwordReset.create({ data: { employeeId: e.id, via: actor ? "MD" : "OPS", tokenHash: sha(token), expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000), issuedById: actor?.id } });
    await tx.auditLog.create({ data: { actorId: actor?.id ?? e.id, action: "PASSWORD_RESET_LINK", target: e.code, detail: { via: actor ? "MD" : "OPS", minutes: LINK_MINUTES } } });
  });
  return { token, minutes: LINK_MINUTES, employee: { code: e.code, name: e.name, email: e.email } };
}

/** Who a link belongs to, or null when it is unknown, used or expired. */
export async function resetTarget(token: string) {
  const r = await prisma.passwordReset.findUnique({ where: { tokenHash: sha(token) }, include: { employee: { select: { id: true, code: true, name: true, email: true, active: true } } } });
  if (!r || r.usedAt || !r.expiresAt || r.expiresAt < new Date() || !r.employee.active) return null;
  return { id: r.id, employee: r.employee };
}

/** Step 3. */
export async function completeReset(token: string, password: string, again: string) {
  if (password.length < MIN_PASSWORD) throw new Error("PASSWORD_SHORT");
  if (password !== again) throw new Error("PASSWORD_MISMATCH");
  const t = await resetTarget(token);
  if (!t) throw new Error("RESET_LINK_DEAD");
  await prisma.$transaction(async (tx) => {
    const used = await tx.passwordReset.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (used.count !== 1) throw new Error("RESET_LINK_DEAD"); // two tabs: the first one wins
    await tx.employee.update({ where: { id: t.employee.id }, data: { passwordHash: hashPassword(password), passwordChangedAt: new Date() } });
    await tx.passwordReset.deleteMany({ where: { employeeId: t.employee.id, usedAt: null } });
    await tx.auditLog.create({ data: { actorId: t.employee.id, action: "PASSWORD_RESET", target: t.employee.code, detail: { by: "link" } } });
  });
  return t.employee;
}
