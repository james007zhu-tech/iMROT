/**
 * 一个税号查全: fill what existing customer files are missing (addresses, phone, billing address) from their tax IDs.
 * Only empty fields are written.  npx tsx scripts/dev/complete-customers.ts [CTH…]
 */
import { prisma } from "../../src/lib/db";
import { completeCustomer } from "../../src/server/company-lookup";
import { isThaiTaxId } from "../../src/server/dbd";

(async () => {
  const only = process.argv[2];
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true }, orderBy: { code: "asc" } });
  const all = await prisma.customer.findMany({ where: only ? { code: only } : { OR: [{ addressLocal: null }, { addressEn: null }, { billingAddress: null }, { phone: null }] }, orderBy: { code: "asc" } });
  for (const c of all) {
    if (!c.taxId || !isThaiTaxId(c.taxId)) { console.log(`${c.code} ${c.name}: no valid tax ID — skipped`); continue; }
    try { const r = await completeCustomer(c.code, md.id); console.log(`${c.code} ${c.name}: filled ${r.filled.join(", ") || "nothing"} (DBD ${r.facts.dbdAnswered ? "ok" : "no answer"}, web ${r.facts.webAnswered ? "ok" : "not used"})`); }
    catch (e) { console.log(`${c.code} ${c.name}: ${(e as Error).message.slice(0, 120)}`); }
  }
  process.exit(0);
})();
