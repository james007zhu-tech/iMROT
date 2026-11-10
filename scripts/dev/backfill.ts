/**
 * Idempotent data fixes that follow a schema change. The dev container runs this after every `prisma db push`
 * (scripts/dev/container-entry.sh), so a merged PR brings old rows along without anyone running anything.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { ensureCategories } from "../../src/server/knowledge";
import { searchTextOf, slugify } from "../../src/lib/knowledge";

async function main() {
  // 2026-11-09 business modes: orders created before modes existed take the mode their kind implies.
  const m = await prisma.serviceOrder.updateMany({ where: { mode: "REPAIR", kind: { in: ["MAINTENANCE", "OVERHAUL", "CONTRACT"] } }, data: { mode: "MAINTENANCE" } });
  const t = await prisma.serviceOrder.updateMany({ where: { mode: "REPAIR", kind: "PARTS_SALE" }, data: { mode: "DOMESTIC_TRADE" } });
  console.log(`backfill: ${m.count} orders → 维保, ${t.count} → 国内贸易`);

  // 2026-11-10 knowledge base: categories, URL names for brands and series, and old fault codes into the review flow.
  await ensureCategories();
  for (const b of await prisma.brand.findMany({ where: { slug: null } })) await prisma.brand.update({ where: { id: b.id }, data: { slug: await freeSlug(slugify(b.name), (x) => prisma.brand.count({ where: { slug: x } })) } });
  for (const s of await prisma.series.findMany({ where: { slug: null } })) await prisma.series.update({ where: { id: s.id }, data: { slug: await freeSlug(slugify(s.name), (x) => prisma.series.count({ where: { brandId: s.brandId, slug: x } })) } });
  const old = await prisma.faultCode.findMany({ where: { publicText: { equals: Prisma.DbNull } } });
  for (const c of old) {
    await prisma.faultCode.update({ where: { id: c.id }, data: {
      status: c.reviewed ? "APPROVED" : "DRAFT",
      publicText: { zh: { title: c.title, ...(c.meaning ? { meaning: c.meaning } : {}), ...(c.firstChecks ? { checks: c.firstChecks.split(/\r?\n|；|;/).map((x) => x.trim()).filter(Boolean) } : {}) } },
      searchText: searchTextOf([c.code, c.title, c.meaning, c.firstChecks]),
    } });
  }
  console.log(`backfill: ${old.length} fault codes moved into the knowledge base`);
}

async function freeSlug(base: string, taken: (s: string) => Promise<number>) {
  for (let i = 1; ; i++) { const s = i === 1 ? base : `${base}-${i}`; if (!(await taken(s))) return s; }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
