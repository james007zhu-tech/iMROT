/**
 * Idempotent data fixes that follow a schema change. The dev container runs this after every `prisma db push`
 * (scripts/dev/container-entry.sh), so a merged PR brings old rows along without anyone running anything.
 */
import { prisma } from "../../src/lib/db";

async function main() {
  // 2026-11-09 business modes: orders created before modes existed take the mode their kind implies.
  const m = await prisma.serviceOrder.updateMany({ where: { mode: "REPAIR", kind: { in: ["MAINTENANCE", "OVERHAUL", "CONTRACT"] } }, data: { mode: "MAINTENANCE" } });
  const t = await prisma.serviceOrder.updateMany({ where: { mode: "REPAIR", kind: "PARTS_SALE" }, data: { mode: "DOMESTIC_TRADE" } });
  console.log(`backfill: ${m.count} orders → 维保, ${t.count} → 国内贸易`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
