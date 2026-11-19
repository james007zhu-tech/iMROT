/**
 * 2026-11-19 真实库存导入（朱总 10:58）: the old system's stock list, counted on 2026-11-18 — column Y (Stock Checking)
 * is the real stock (朱总 10:59). Every row becomes a part number (<brand>-<spec>, GEN- when no brand is known); what
 * was counted goes in on one receipt (IBTH) per receiving date, so first-in-first-out starts from the right batches.
 * Unit prices are in CNY in the file: converted at the Bank of China rate of that date. The storage bin goes in "batch".
 * MODE=dry checks only. Refuses when the parts or the store are not empty.
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../../src/lib/db";
import { recordStockDoc } from "../../src/server/scm";

type P = { sku: string; brandCode: string | null; vendorPartNo: string; name: string; unit: string; note: string | null };
type L = { sku: string; qty: number; priceCny: number | null; date: string; bin: string | null; book: number; legacy: string; operator: string | null };
(async () => {
  const mode = process.env.MODE ?? "dry";
  const d = JSON.parse(await readFile(process.env.FILE ?? ".dev-ops/stock-1119.json", "utf8")) as { parts: P[]; lines: L[]; replace?: string[] };
  // a first run created the part numbers with descriptions in them and stopped before any stock: those (never moved, never quoted) go first
  if (d.replace?.length && mode === "run") { const gone = await prisma.part.deleteMany({ where: { sku: { in: d.replace }, movements: { none: {} }, quoteLines: { none: {} }, bomLines: { none: {} } } }); console.log(`removed ${gone.count} part numbers of the first run`); }
  if (((await prisma.part.count()) && !d.replace) || (await prisma.stockMovement.count({ where: { part: { sku: { in: d.parts.map((p) => p.sku) } } } }))) { if (process.env.FORCE !== "1") throw new Error(`not empty: ${await prisma.part.count()} parts, ${await prisma.stockMovement.count()} movements`); }
  const brands = new Map((await prisma.brand.findMany({ select: { id: true, code: true } })).map((b) => [b.code, b.id]));
  for (const p of d.parts) if (p.brandCode && !brands.has(p.brandCode)) throw new Error(`brand ${p.brandCode} missing`);
  // CNY → THB at the BOC rate of each receiving date (rateToCny of THB = CNY per 1 THB)
  const thb = async (on: string) => { const r = await prisma.fxRate.findFirst({ where: { currency: "THB", source: "BOC", rateDate: { lte: new Date(`${on}T23:59:59+07:00`) } }, orderBy: { rateDate: "desc" } })
    ?? await prisma.fxRate.findFirst({ where: { currency: "THB", source: "BOC" }, orderBy: { rateDate: "asc" } }); if (!r) throw new Error("no BOC THB rate"); return { cnyPerThb: Number(r.rateToCny), date: r.rateDate.toISOString().slice(0, 10) }; };
  const byDate = new Map<string, L[]>();
  for (const l of d.lines) byDate.set(l.date, [...(byDate.get(l.date) ?? []), l]);
  const rates = new Map<string, { cnyPerThb: number; date: string }>();
  for (const day of byDate.keys()) rates.set(day, await thb(day));
  const value = d.lines.reduce((s, l) => s + (l.priceCny ? (l.priceCny / rates.get(l.date)!.cnyPerThb) * l.qty : 0), 0);
  console.log(`parts ${d.parts.length} · receipts ${byDate.size} · lines ${d.lines.length} · qty ${d.lines.reduce((s, l) => s + l.qty, 0)} · value THB ${value.toFixed(2)} · rates ${[...rates].map(([k, v]) => `${k}:${(1 / v.cnyPerThb).toFixed(4)}`).join(" ")}`);
  if (mode !== "run") { console.log("DRY RUN"); process.exit(0); }
  await prisma.part.createMany({ data: d.parts.map((p) => ({ sku: p.sku, brandId: p.brandCode ? brands.get(p.brandCode) : undefined, vendorPartNo: p.vendorPartNo, name: p.name, unit: p.unit })) });
  const out: string[] = [];
  for (const [day, ls] of [...byDate].sort()) {
    const r = rates.get(day)!;
    const doc = await recordStockDoc({ actorCode: "ETH2611001", direction: "IN", movedAt: new Date(`${day}T09:00:00+07:00`), costCurrency: "THB", supplierRef: "期初库存 · 原系统 + 2026-11-18 盘点",
      lines: ls.map((l) => ({ partSku: l.sku, qty: l.qty, unitCost: l.priceCny ? Math.round((l.priceCny / r.cnyPerThb) * 100) / 100 : undefined, batch: l.bin ?? undefined })) });
    out.push(`${doc.no}(${ls.length})`);
  }
  await prisma.auditLog.create({ data: { actorId: (await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } })).id, action: "DATA_IMPORTED", target: "STOCK", detail: { by: "朱总 2026-11-19 10:58 · Y = 真实库存", parts: d.parts.length, receipts: out, qty: d.lines.reduce((s, l) => s + l.qty, 0), valueThb: Math.round(value * 100) / 100 } } });
  console.log(`done: ${out.join(" ")} · parts ${await prisma.part.count()} · movements ${await prisma.stockMovement.count()}`);
  process.exit(0);
})();
