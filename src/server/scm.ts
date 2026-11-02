/**
 * SCM Phase 1 slice: stock movements. An OUT movement into an asset writes PART_REPLACED on that asset.
 * Parts are keyed by brand + vendor part no, never by customer, so the same SKU can be matched across customers.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import type { Prisma } from "@prisma/client";

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

export async function recordMovement(input: z.infer<typeof MovementInput>) {
  const d = MovementInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const part = await prisma.part.findUniqueOrThrow({ where: { sku: d.partSku } });
  const asset = d.assetCode ? await prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }) : null;
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }) : null;
  if (d.direction === "OUT" && !asset && !order) throw new Error("an OUT movement must name the asset or the service order it serves");

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: d.direction === "IN" ? "IB" : "OB", createdByEmployeeCode: actor.code, entityId: actor.entityId });
    const mv = await tx.stockMovement.create({
      data: { no, direction: d.direction, partId: part.id, qty: d.qty, warehouse: d.warehouse, batch: d.batch, assetId: asset?.id, serviceOrderId: order?.id, oldPartDisposition: d.oldPartDisposition, movedAt: d.movedAt, byName: actor.name },
    });
    await tx.document.create({ data: { no, type: d.direction === "IN" ? "IB" : "OB", entityId: actor.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId, serviceOrderId: order?.id, createdById: actor.id } });
    if (d.direction === "IN" && d.unitCost != null) {
      await tx.part.update({ where: { id: part.id }, data: { lastCost: d.unitCost, lastCostCurrency: d.costCurrency ?? "THB" } });
    }
    if (d.direction === "OUT" && asset) {
      await tx.assetEvent.create({
        data: { assetId: asset.id, type: "PART_REPLACED", actorId: actor.id, serviceOrderId: order?.id, sourceDocNo: no, occurredAt: d.movedAt,
          summary: `更换 ${part.name}（${part.sku}）×${d.qty}${d.oldPartDisposition ? `，旧件：${d.oldPartDisposition}` : ""}`,
          payload: { partSku: part.sku, qty: d.qty, batch: d.batch, oldPartDisposition: d.oldPartDisposition } as Prisma.InputJsonValue },
      });
    }
    return mv;
  });
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
