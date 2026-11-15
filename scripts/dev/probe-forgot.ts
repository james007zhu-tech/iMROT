/**
 * 忘记密码, pinned: ask → MD notice → single-use 30-minute link → the owner sets the password.
 * Uses its own employee; leaves it inactive.  npx tsx scripts/dev/probe-forgot.ts
 */
import { prisma } from "../../src/lib/db";
import { changeOwnPassword, createEmployee } from "../../src/server/opd";
import { noticesFor } from "../../src/server/notify";
import { completeReset, issueResetLink, requestReset, resetTarget } from "../../src/server/password-reset";
import { verifyPassword } from "../../src/lib/password";

let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };
const refused = async (fn: () => Promise<unknown>) => { try { await fn(); return ""; } catch (e) { return (e as Error).message.split("\n")[0]; } };

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: process.env.PROBE_ACTOR ?? "ETH2611001" } });
  const stamp = Date.now().toString().slice(-6);
  const email = `forgot.${stamp}@probe.test`;
  const e = await createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `Forgot Probe ${stamp}`, email, role: "ENGINEER", password: `old-${stamp}-pw`, joinedAt: new Date() } as never);

  await requestReset("nobody@probe.test");
  await requestReset(email.toUpperCase()); await requestReset(email);
  const asked = await prisma.passwordReset.count({ where: { employeeId: e.id } });
  check("asking twice leaves one request; an unknown address leaves none", asked === 1);
  const n = (await noticesFor(md)).find((x) => x.kind === "resetAsked" && x.ref === e.code);
  check("every MD sees the request in the message centre", !!n && n.href === `/people/${e.code}#account`, n?.href);
  const notMine = (await noticesFor({ id: e.id, code: e.code, role: "ENGINEER" })).some((x) => x.kind === "resetAsked");
  check("nobody else does", !notMine);

  const eng = await refused(() => issueResetLink({ employeeCode: md.code, actorCode: e.code }));
  check("only an MD can issue a link", eng === "MD_ONLY", eng);
  const first = await issueResetLink({ employeeCode: e.code, actorCode: md.code });
  const second = await issueResetLink({ employeeCode: e.code, actorCode: md.code });
  check("a new link cancels the earlier one, and the request leaves the message centre", !(await resetTarget(first.token)) && !!(await resetTarget(second.token)) && !(await noticesFor(md)).some((x) => x.kind === "resetAsked" && x.ref === e.code));
  const stored = await prisma.passwordReset.findMany({ where: { employeeId: e.id } });
  check("only the hash of the token is kept", stored.length === 1 && !!stored[0].tokenHash && stored[0].tokenHash !== second.token && !JSON.stringify(stored).includes(second.token));

  check("a short password is refused", (await refused(() => completeReset(second.token, "short", "short"))) === "PASSWORD_SHORT");
  check("two different entries are refused", (await refused(() => completeReset(second.token, `new-${stamp}-pw`, `new-${stamp}-px`))) === "PASSWORD_MISMATCH");
  await completeReset(second.token, `new-${stamp}-pw`, `new-${stamp}-pw`);
  const after = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
  check("the owner's new password works and the old one does not", verifyPassword(`new-${stamp}-pw`, after.passwordHash) && !verifyPassword(`old-${stamp}-pw`, after.passwordHash));
  check("the link works once", (await refused(() => completeReset(second.token, `again-${stamp}-pw`, `again-${stamp}-pw`))) === "RESET_LINK_DEAD");

  const ops = await issueResetLink({ employeeCode: e.code });
  await prisma.passwordReset.updateMany({ where: { employeeId: e.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
  check("a link older than 30 minutes is dead", ops.minutes === 30 && !(await resetTarget(ops.token)));
  const log = await prisma.auditLog.findMany({ where: { target: e.code, action: { startsWith: "PASSWORD_RESET" } } });
  check("links and the reset are in the audit log", log.filter((l) => l.action === "PASSWORD_RESET_LINK").length === 3 && log.filter((l) => l.action === "PASSWORD_RESET").length === 1, log.map((l) => l.action).join(","));
  // 我的: the owner changes the password, proving the current one
  check("changing the password needs the current one", (await refused(() => changeOwnPassword(e.code, "not-it", `mine-${stamp}-pw`, `mine-${stamp}-pw`))) === "WRONG_PASSWORD");
  check("… and a new one of 8 characters, typed twice the same", (await refused(() => changeOwnPassword(e.code, `new-${stamp}-pw`, "short", "short"))) === "PASSWORD_SHORT" && (await refused(() => changeOwnPassword(e.code, `new-${stamp}-pw`, `mine-${stamp}-pw`, `mine-${stamp}-px`))) === "PASSWORD_MISMATCH");
  await changeOwnPassword(e.code, `new-${stamp}-pw`, `mine-${stamp}-pw`, `mine-${stamp}-pw`);
  const mine = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
  check("the owner's own change takes effect", verifyPassword(`mine-${stamp}-pw`, mine.passwordHash) && !verifyPassword(`new-${stamp}-pw`, mine.passwordHash));
  await prisma.employee.update({ where: { id: e.id }, data: { active: false } });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
