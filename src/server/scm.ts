/**
 * SCM Phase 1 slice: stock movements. An OUT movement into an asset writes PART_REPLACED on that asset.
 * Parts are keyed by brand + vendor part no, never by customer, so the same SKU can be matched across customers.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
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

/**
 * One IBTH / OBTH document = one number, any number of SKU lines (decision 2026-11-04).
 * Each line moves exactly one SKU, so stock on hand stays per SKU; an OUT line into an asset writes PART_REPLACED.
 */
export async function recordStockDoc(input: z.input<typeof StockDocInput>) {
  const d = StockDocInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const skus = [...new Set(d.lines.map((l) => l.partSku))];
  const parts = await prisma.part.findMany({ where: { sku: { in: skus } } });
  const unknown = skus.filter((s) => !parts.some((p) => p.sku === s));
  if (unknown.length) throw new Error(`UNKNOWN_SKU:${unknown.join(",")}`);
  const asset = d.assetCode ? await prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }) : null;
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }) : null;
  if (d.direction === "OUT" && !asset && !order) throw new Error("an OUT movement must name the asset or the service order it serves");

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: d.direction === "IN" ? "IB" : "OB", createdByEmployeeCode: actor.code, entityId: actor.entityId, date: d.movedAt });
    const rows = [];
    for (const [i, l] of d.lines.entries()) {
      const part = parts.find((p) => p.sku === l.partSku)!;
      rows.push(await tx.stockMovement.create({
        data: { no, lineNo: i + 1, direction: d.direction, partId: part.id, qty: l.qty, warehouse: d.warehouse, batch: l.batch, assetId: asset?.id, serviceOrderId: order?.id, oldPartDisposition: l.oldPartDisposition, movedAt: d.movedAt, byName: actor.name, unitCost: d.direction === "IN" ? l.unitCost : undefined, supplierRef: d.supplierRef },
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

/** Stock on hand per part = IN − OUT (Phase 1 has one warehouse per entity). */
export async function stockOnHand(partSku: string, warehouse = "RAYONG") {
  const part = await prisma.part.findUniqueOrThrow({ where: { sku: partSku } });
  const rows = await prisma.stockMovement.groupBy({ by: ["direction"], where: { partId: part.id, warehouse }, _sum: { qty: true } });
  const sum = (dir: "IN" | "OUT") => Number(rows.find((r) => r.direction === dir)?._sum.qty ?? 0);
  return sum("IN") - sum("OUT");
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
