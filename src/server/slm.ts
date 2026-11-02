/**
 * SLM service layer. One service = one QTTH created at report time; everything else hangs below it.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { keepCustomerRef } from "@/lib/numbering";
import type { Prisma, ServiceOrderStatus } from "@prisma/client";
import { canTransitionOrder } from "@/lib/lifecycle";

export const CreateServiceOrderInput = z.object({
  createdByEmployeeCode: z.string(),
  customerId: z.string(),
  plantId: z.string().optional(),
  assetCodes: z.array(z.string()).min(1, "a service order must name at least one asset"),
  kind: z.enum(["REPAIR", "MAINTENANCE", "OVERHAUL", "CONTRACT", "PARTS_SALE"]).default("REPAIR"),
  reportedSymptom: z.string().optional(),
  reportedAlarm: z.string().optional(),
  productionImpact: z.string().optional(),
  reportedByContactId: z.string().optional(),
  customerRef: z.string().optional(),
  currency: z.string().default("THB"),
});

/** 报修 → QTTH draft (status RECEIVED) + SERVICE_REQUESTED event on every named asset. */
export async function createServiceOrder(input: z.infer<typeof CreateServiceOrderInput>) {
  const data = CreateServiceOrderInput.parse(input);
  const creator = await prisma.employee.findUniqueOrThrow({ where: { code: data.createdByEmployeeCode } });
  const assets = await prisma.asset.findMany({ where: { code: { in: data.assetCodes } } });
  if (assets.length !== data.assetCodes.length) throw new Error("unknown asset code in request");

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "QT", createdByEmployeeCode: creator.code, entityId: creator.entityId });
    const order = await tx.serviceOrder.create({
      data: {
        no,
        entityId: creator.entityId,
        customerId: data.customerId,
        plantId: data.plantId,
        kind: data.kind,
        status: "RECEIVED",
        reportedSymptom: data.reportedSymptom,
        reportedAlarm: data.reportedAlarm,
        productionImpact: data.productionImpact,
        reportedById: data.reportedByContactId,
        createdById: creator.id,
        customerRef: keepCustomerRef(data.customerRef),
        currency: data.currency,
        assets: { create: assets.map((a, i) => ({ assetId: a.id, isPrimary: i === 0 })) },
      },
    });
    await tx.document.create({ data: { no, type: "QT", entityId: creator.entityId, countryCode: no.slice(2, 4), customerId: data.customerId, serviceOrderId: order.id, createdById: creator.id } });
    for (const a of assets) {
      await tx.assetEvent.create({
        data: {
          assetId: a.id,
          type: "SERVICE_REQUESTED",
          actorId: creator.id,
          serviceOrderId: order.id,
          sourceDocNo: no,
          summary: `报修：${data.reportedSymptom ?? data.kind}${data.reportedAlarm ? `（${data.reportedAlarm}）` : ""}`,
          payload: { kind: data.kind, productionImpact: data.productionImpact } as Prisma.InputJsonValue,
        },
      });
    }
    return order;
  });
}

export async function advanceServiceOrder(no: string, to: ServiceOrderStatus, actorEmployeeCode: string, note?: string) {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { assets: true } });
  if (!canTransitionOrder(order.status, to)) throw new Error(`${no}: ${order.status} → ${to} not allowed`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorEmployeeCode } });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.serviceOrder.update({
      where: { id: order.id },
      data: {
        status: to,
        assigneeId: to === "ASSIGNED" ? actor.id : order.assigneeId,
        quoteSentAt: to === "QUOTE_PENDING" ? new Date() : order.quoteSentAt,
        quoteConfirmedAt: to === "IN_PROGRESS" && order.status === "QUOTE_PENDING" ? new Date() : order.quoteConfirmedAt,
        closedAt: to === "CLOSED" ? new Date() : order.closedAt,
      },
    });
    for (const link of order.assets) {
      await tx.assetEvent.create({
        data: { assetId: link.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: no, summary: note ?? `${no} ${order.status} → ${to}`, payload: { orderStatusFrom: order.status, orderStatusTo: to } },
      });
    }
    return updated;
  });
}

export async function getServiceOrder(no: string) {
  return prisma.serviceOrder.findUnique({
    where: { no },
    include: {
      customer: true,
      plant: true,
      assignee: { select: { code: true, name: true } },
      createdBy: { select: { code: true, name: true } },
      assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } },
      lines: { orderBy: { lineNo: "asc" } },
      inspections: true,
      repairJobs: true,
      acceptance: true,
      documents: true,
      taxInvoices: true,
      invoices: true,
    },
  });
}
