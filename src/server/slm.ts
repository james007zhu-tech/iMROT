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
  reportedAt: z.coerce.date().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string() })).optional(),
});

/** 报修 → QTTH draft (status RECEIVED) + SERVICE_REQUESTED event on every named asset. */
export async function createServiceOrder(input: z.input<typeof CreateServiceOrderInput>) {
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
        reportedAt: data.reportedAt,
        attachments: data.attachments as Prisma.InputJsonValue | undefined,
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
          summary: `${data.reportedSymptom ?? data.kind}${data.reportedAlarm ? ` (${data.reportedAlarm})` : ""}`,
          payload: { kind: data.kind, productionImpact: data.productionImpact } as Prisma.InputJsonValue,
          attachments: data.attachments as Prisma.InputJsonValue | undefined,
          occurredAt: data.reportedAt,
        },
      });
    }
    return order;
  });
}

export async function advanceServiceOrder(no: string, to: ServiceOrderStatus, actorEmployeeCode: string, note?: string, assigneeCode?: string) {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { assets: true } });
  if (!canTransitionOrder(order.status, to)) throw new Error(`${no}: ${order.status} → ${to} not allowed`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorEmployeeCode } });
  const assignee = assigneeCode ? await prisma.employee.findUniqueOrThrow({ where: { code: assigneeCode } }) : null;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.serviceOrder.update({
      where: { id: order.id },
      data: {
        status: to,
        assigneeId: assignee ? assignee.id : to === "ASSIGNED" ? actor.id : order.assigneeId,
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
      inspections: { include: { engineer: { select: { name: true } } } },
      repairJobs: { include: { engineer: { select: { name: true } } } },
      acceptance: true,
      documents: { include: { createdBy: { select: { name: true } } }, orderBy: { issuedAt: "asc" } },
      taxInvoices: true,
      invoices: true,
      deliveries: true,
      reportedBy: true,
      events: { orderBy: { occurredAt: "desc" }, include: { actor: { select: { name: true } } } },
      stockMovements: { include: { part: true } },
    },
  });
}

export type PoLine = { lineNo: number; description: string; qty: number; unit: string; isService: boolean; assetCode?: string; partSku?: string };
const SERVICE_UNITS = /^(h|hr|hrs|hour|hours|ชม\.?|小时|lot|job|ครั้ง|次)$/i;

/** The PO lines a quote implies — what the customer is expected to order. Labour and other service items are not delivered. */
export async function poLinesFromQuote(no: string): Promise<PoLine[]> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { lines: { orderBy: { lineNo: "asc" }, include: { part: true } } } });
  return o.lines.map((l) => ({ lineNo: l.lineNo, description: l.description, qty: Number(l.qty), unit: l.unit, isService: !l.partId && SERVICE_UNITS.test(l.unit.trim()) || /labou?r|service|ค่าแรง|ค่าบริการ|工时|人工|服务费/i.test(l.description), assetCode: l.assetCode ?? undefined, partSku: l.part?.sku }));
}

/** Customer confirmed the quote with a PO: keep the PO number verbatim, the PO lines and the scan, then start the work. */
export async function confirmCustomerPo(input: { no: string; actorCode: string; customerRef?: string; poLines: PoLine[]; attachments?: { name: string; url: string; kind: string }[]; note?: string }) {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, include: { assets: true } });
  if (o.status !== "QUOTE_PENDING") throw new Error(`${o.no} is ${o.status}; PO confirmation needs QUOTE_PENDING`);
  if (!input.poLines.length) throw new Error("PO_LINES_REQUIRED");
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const merged = [...((o.attachments as { name: string; url: string; kind: string }[] | null) ?? []), ...(input.attachments ?? [])];
  await prisma.$transaction(async (tx) => {
    await tx.serviceOrder.update({ where: { id: o.id }, data: { customerRef: keepCustomerRef(input.customerRef) ?? o.customerRef, poLines: input.poLines as unknown as Prisma.InputJsonValue, attachments: merged as Prisma.InputJsonValue } });
    for (const l of o.assets) await tx.assetEvent.create({ data: { assetId: l.assetId, type: "ORDER_CONFIRMED", actorId: actor.id, serviceOrderId: o.id, sourceDocNo: o.no, summary: input.customerRef ?? o.customerRef ?? "", payload: { customerRef: input.customerRef, lines: input.poLines.length } as Prisma.InputJsonValue, attachments: (input.attachments ?? []) as Prisma.InputJsonValue } });
  });
  return advanceServiceOrder(o.no, "IN_PROGRESS", input.actorCode, input.note ?? input.customerRef);
}
