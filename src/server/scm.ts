/**
 * SCM Phase 1 slice: stock movements. An OUT movement into an asset writes PART_REPLACED on that asset.
 * Parts are keyed by brand + vendor part no, never by customer, so the same SKU can be matched across customers.
 */
import { can, hasRole } from "@/lib/caps";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertNotLocked } from "@/server/slm";
import { allocateNumber } from "@/lib/numbering-db";
import type { Prisma } from "@prisma/client";

const Line = z.object({
  partSku: z.string(),
  qty: z.number().positive(),
  batch: z.string().optional(),
  unitCost: z.number().optional(),
  oldPartDisposition: z.string().optional(),
});

export const StockDocInput = z.object({
  actorCode: z.string(),
  direction: z.enum(["IN", "OUT"]),
  warehouse: z.string().default("RAYONG"),
  assetCode: z.string().optional(),
  serviceOrderNo: z.string().optional(),
  supplierRef: z.string().optional(),
  costCurrency: z.string().optional(),
  movedAt: z.coerce.date().optional(),
  lines: z.array(Line).min(1, "a stock document needs at least one line"),
});

/** One spelling per part number: upper case, no spaces. */
export const normPartNo = (s: string) => s.normalize("NFKC").toUpperCase().replace(/\s+/g, "");

/**
 * Finds parts by whatever number people actually write (trial finding 2026-11-14: a purchase order carries the maker's
 * own number, the library's SKU is that number behind a brand prefix, and receiving answered "unknown part number").
 * A key matches, in this order: the SKU itself; the maker's part number; the SKU without its brand prefix.
 * A maker's number that two brands share is ambiguous and is refused rather than guessed.
 */
export async function resolveParts(keys: string[]) {
  const wanted = [...new Set(keys.map((k) => k.trim()).filter(Boolean))];
  const found = new Map<string, Awaited<ReturnType<typeof prisma.part.findMany>>[number]>();
  const unknown: string[] = [], ambiguous: string[] = [];
  for (const key of wanted) {
    const n = normPartNo(key);
    const hits = await prisma.$queryRaw<{ id: string; sku: string; vendor: string }[]>`
      SELECT id, sku, "vendorPartNo" AS vendor FROM "Part"
      WHERE upper(regexp_replace(sku, '\s+', '', 'g')) = ${n}
         OR upper(regexp_replace("vendorPartNo", '\s+', '', 'g')) = ${n}
         OR upper(regexp_replace(sku, '\s+', '', 'g')) LIKE ${"%-" + n.replace(/[\\%_]/g, "\\$&")}
      LIMIT 20`;
    const exact = hits.filter((h) => normPartNo(h.sku) === n);
    const pick = exact.length ? exact : hits;
    if (!pick.length) { unknown.push(key); continue; }
    if (pick.length > 1) { ambiguous.push(`${key} → ${pick.map((h) => h.sku).join(" / ")}`); continue; }
    found.set(key, (await prisma.part.findUniqueOrThrow({ where: { id: pick[0].id } })));
  }
  return { found, unknown, ambiguous };
}
/** One part by any of its numbers, or null. */
export async function findPart(key: string | null | undefined) {
  if (!key?.trim()) return null;
  return (await resolveParts([key])).found.get(key.trim()) ?? null;
}

/**
 * One IBTH / OBTH document = one number, any number of SKU lines (decision 2026-11-04).
 * Each line moves exactly one SKU, so stock on hand stays per SKU; an OUT line into an asset writes PART_REPLACED.
 */
export async function recordStockDoc(input: z.input<typeof StockDocInput>) {
  const d = StockDocInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  if (!hasRole(actor, "MD", "PURCHASING", "ENGINEER")) throw new Error("NO_PERMISSION"); // 六角色: 出入库归 PUR; ENG 领料、退料
  const { found, unknown, ambiguous } = await resolveParts(d.lines.map((l) => l.partSku));
  if (ambiguous.length) throw new Error(`AMBIGUOUS_SKU:${ambiguous.join("; ")}`);
  if (unknown.length) throw new Error(`UNKNOWN_SKU:${unknown.join(",")}`);
  const asset = d.assetCode ? await prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }) : null;
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }) : null;
  if (order) assertNotLocked(order);
  if (d.direction === "OUT" && !asset && !order) throw new Error("an OUT movement must name the asset or the service order it serves");
  // nothing leaves the store that is not in it (trial finding 2026-11-14)
  // 一个库存数 (需求清单 v3 P0-07): stock is what came in minus what went out, counted over every warehouse — the
  // same figure on the list, the part page, the stock form and the delivery note. An issue is taken from the warehouse
  // named when it has the goods, else from the one that does; the movement records which.
  const takeFrom = new Map<string, string>();
  d.warehouse = d.warehouse.trim().toUpperCase() || "RAYONG";
  if (d.direction === "OUT") {
    const want = new Map<string, number>();
    for (const l of d.lines) { const p = found.get(l.partSku.trim())!; want.set(p.sku, (want.get(p.sku) ?? 0) + l.qty); }
    const short: string[] = [];
    for (const [sku, qty] of want) {
      const by = await stockByWarehouse(sku);
      const wh = (by.get(d.warehouse) ?? 0) >= qty - 1e-9 ? d.warehouse : [...by].find(([, n]) => n >= qty - 1e-9)?.[0];
      if (wh) takeFrom.set(sku, wh); else short.push(`${sku} ${qty}/${[...by.values()].reduce((a, b) => a + b, 0)}`);
    }
    if (short.length) throw new Error(`STOCK_SHORT:${short.join("; ")}`);
  }
  // 成本只给看得到成本的人填: a unit cost typed by anyone else is not taken (采购或财务补)
  if (!can.cost(actor)) for (const l of d.lines) l.unitCost = undefined;

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: d.direction === "IN" ? "IB" : "OB", createdByEmployeeCode: actor.code, entityId: actor.entityId, date: d.movedAt });
    const rows = [];
    for (const [i, l] of d.lines.entries()) {
      const part = found.get(l.partSku.trim())!;
      rows.push(await tx.stockMovement.create({
        data: { no, lineNo: i + 1, direction: d.direction, partId: part.id, qty: l.qty, warehouse: takeFrom.get(part.sku) ?? d.warehouse, batch: l.batch, assetId: asset?.id, serviceOrderId: order?.id, oldPartDisposition: l.oldPartDisposition, movedAt: d.movedAt, byName: actor.name, unitCost: d.direction === "IN" ? l.unitCost : undefined, supplierRef: d.supplierRef },
        include: { part: true },
      }));
      if (d.direction === "IN" && l.unitCost != null) await tx.part.update({ where: { id: part.id }, data: { lastCost: l.unitCost, lastCostCurrency: d.costCurrency ?? "THB" } });
      if (d.direction === "OUT" && asset) {
        await tx.assetEvent.create({
          data: { assetId: asset.id, type: "PART_REPLACED", actorId: actor.id, serviceOrderId: order?.id, sourceDocNo: no, occurredAt: d.movedAt,
            summary: `${part.name} (${part.sku}) ×${l.qty}${l.oldPartDisposition ? ` · old: ${l.oldPartDisposition}` : ""}`,
            payload: { partSku: part.sku, qty: l.qty, batch: l.batch, oldPartDisposition: l.oldPartDisposition, lineNo: i + 1 } as Prisma.InputJsonValue },
        });
      }
    }
    await tx.document.create({ data: { no, type: d.direction === "IN" ? "IB" : "OB", entityId: actor.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id, issuedAt: d.movedAt } });
    return { no, lines: rows };
  });
}

export const MovementInput = z.object({
  actorCode: z.string(),
  direction: z.enum(["IN", "OUT"]),
  partSku: z.string(),
  qty: z.number().positive(),
  warehouse: z.string().default("RAYONG"),
  batch: z.string().optional(),
  assetCode: z.string().optional(),
  serviceOrderNo: z.string().optional(),
  oldPartDisposition: z.string().optional(),
  unitCost: z.number().optional(),
  costCurrency: z.string().optional(),
  movedAt: z.coerce.date().optional(),
});

/** Single-SKU shortcut (part page, API): a one-line stock document. */
export async function recordMovement(input: z.input<typeof MovementInput>) {
  const d = MovementInput.parse(input);
  const r = await recordStockDoc({ actorCode: d.actorCode, direction: d.direction, warehouse: d.warehouse, assetCode: d.assetCode, serviceOrderNo: d.serviceOrderNo, costCurrency: d.costCurrency, movedAt: d.movedAt, lines: [{ partSku: d.partSku, qty: d.qty, batch: d.batch, unitCost: d.unitCost, oldPartDisposition: d.oldPartDisposition }] });
  return r.lines[0];
}

/** Stock on hand per warehouse = IN − OUT. Warehouses with nothing in them are left out. */
export async function stockByWarehouse(partSku: string): Promise<Map<string, number>> {
  const part = await prisma.part.findUniqueOrThrow({ where: { sku: partSku } });
  const rows = await prisma.stockMovement.groupBy({ by: ["warehouse", "direction"], where: { partId: part.id }, _sum: { qty: true } });
  const out = new Map<string, number>();
  for (const r of rows) out.set(r.warehouse, (out.get(r.warehouse) ?? 0) + (r.direction === "IN" ? 1 : -1) * Number(r._sum.qty ?? 0));
  for (const [k, v] of out) if (Math.abs(v) < 1e-9) out.delete(k);
  return out;
}

/** The one stock figure of a part: IN − OUT over every warehouse (or of one warehouse when it is named). */
export async function stockOnHand(partSku: string, warehouse?: string) {
  const by = await stockByWarehouse(partSku);
  return warehouse ? by.get(warehouse) ?? 0 : [...by.values()].reduce((a, b) => a + b, 0);
}

/** Shared-spare question: which assets (across all customers) use this part, via model BOM. */
export async function assetsUsingPart(partSku: string) {
  return prisma.asset.findMany({
    where: { model: { bom: { some: { part: { sku: partSku } } } } },
    select: { code: true, serialNumber: true, status: true, customer: { select: { code: true, name: true } }, model: { select: { code: true } } },
  });
}

/** New part number: SKU = brand code + vendor part no (so the same part matches across customers). */
export async function createPart(input: { brandCode?: string; vendorPartNo: string; name: string; nameLocal?: string; unit?: string; safetyStock?: number }) {
  const vendor = input.vendorPartNo.trim();
  if (!vendor) throw new Error("vendor part number is required");
  const brand = input.brandCode ? await prisma.brand.findUnique({ where: { code: input.brandCode } }) : null;
  const sku = `${brand?.code ?? "GEN"}-${vendor}`;
  return prisma.part.create({ data: { sku, brandId: brand?.id, vendorPartNo: vendor, name: input.name, nameLocal: input.nameLocal, unit: input.unit ?? "pcs", safetyStock: input.safetyStock } });
}


/**
 * 从工单出库 (需求清单 v3 P0-08): what an order still has to take from the store — its part lines (the customer's PO,
 * else the quote) minus what has already been issued for it — with the stock on hand of each, the order's machine
 * when there is exactly one, and the open PRTH if the missing parts are already being bought.
 */
export async function issueNeeds(orderNo: string) {
  const o = await prisma.serviceOrder.findUnique({ where: { no: orderNo }, include: { lines: { include: { part: { select: { sku: true } } } }, assets: { include: { asset: { select: { code: true } } } }, inquiries: { where: { status: { notIn: ["CANCELLED", "CLOSED"] as never[] } }, select: { no: true }, take: 1 } } });
  if (!o) return null;
  const want = new Map<string, number>();
  const po = (o.poLines as { sku?: string; qty: number; isService?: boolean }[] | null) ?? [];
  if (po.some((l) => l.sku)) { for (const l of po) if (l.sku && !l.isService) want.set(l.sku, (want.get(l.sku) ?? 0) + Number(l.qty)); }
  else for (const l of o.lines) if (l.part) want.set(l.part.sku, (want.get(l.part.sku) ?? 0) + Number(l.qty));
  const lines: { sku: string; qty: number; onHand: number }[] = [];
  for (const [key, qty] of want) {
    const part = await findPart(key).catch(() => null);
    if (!part) continue;
    const out = await prisma.stockMovement.aggregate({ _sum: { qty: true }, where: { partId: part.id, direction: "OUT", serviceOrderId: o.id } });
    const left = qty - Number(out._sum.qty ?? 0);
    if (left > 1e-9) lines.push({ sku: part.sku, qty: left, onHand: await stockOnHand(part.sku) });
  }
  const trade = o.mode === "DOMESTIC_TRADE" || o.mode === "INTERNATIONAL_TRADE";
  return { lines, hadParts: want.size > 0, assetCode: !trade && o.assets.length === 1 ? o.assets[0].asset.code : undefined, openInquiry: o.inquiries[0]?.no };
}
