/**
 * The operator's way to a password-reset link, for when nobody with the MD role can sign in.
 *   npx tsx scripts/dev/reset-link.ts someone@ducheng-industrial.com
 * Prints a single-use link valid for 30 minutes. The password itself is typed by its owner only.
 */
import { prisma } from "../../src/lib/db";
import { issueResetLink } from "../../src/server/password-reset";

(async () => {
  const email = process.argv[2];
  const e = email ? await prisma.employee.findFirst({ where: { email: { equals: email, mode: "insensitive" } } }) : null;
  if (!e) { console.log("no such employee"); process.exit(1); }
  const r = await issueResetLink({ employeeCode: e.code });
  console.log(`${e.code} ${e.name}: ${process.env.PUBLIC_BASE_URL ?? "http://localhost:3000"}/reset/${r.token}  (valid ${r.minutes} min, single use)`);
  process.exit(0);
})();
