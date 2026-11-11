/**
 * SLM service layer. One service = one QTTH created at report time; everything else hangs below it.
 */
import { createMilestones } from "@/server/project";
import { adoptLooseDocs } from "@/server/asset-first";
import { tradeTermsFrom } from "@/lib/export";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { keepCustomerRef } from "@/lib/numbering";
import type { Prisma, ServiceOrderStatus } from "@prisma/client";
import { canTransitionOrder } from "@/lib/lifecycle";
import { quoteMayGoOut } from "@/lib/margin";
import { autoInquiryForOrder, raisePurchaseOrdersForOrder } from "@/server/purchasing";
import { MODES, OPEN_MODES, TRADE_QUOTE_TEMPLATE, isTradeMode, quoteJustCancels, kindFor, modeFromKind, modeNeedsAsset, requestLinesFrom } from "@/lib/modes";
import { declineCloseBlockers } from "@/lib/decline";
import { declineShapeOf } from "@/server/decline";

/** Shortest path through the status chain, e.g. RECEIVED → ASSIGNED → DIAGNOSING. */
const CHAIN: ServiceOrderStatus[] = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING", "ACCEPTED", "INVOICED", "CLOSED"];

/**
 * Move an order forward to `to` inside a transaction, hop by hop, writing one STATUS_CHANGED event per hop.
 * Used by the documents that imply progress (an INTH means diagnosing, quote lines mean quote pending), so an order
 * that nobody assigned by hand still moves — it is assigned to whoever did the work. No-op when already at or past `to`.
 */
export async function progressOrder(tx: Prisma.TransactionClient, order: { id: string; no: string; status: ServiceOrderStatus; assigneeId: string | null }, to: ServiceOrderStatus, actorId: string, sourceDocNo?: string) {
  const from = CHAIN.indexOf(order.status), target = CHAIN.indexOf(to);
  if (from < 0 || target < 0 || from >= target) return order.status;
  const assets = await tx.serviceOrderAsset.findMany({ where: { serviceOrderId: order.id }, select: { assetId: true } });
  let cur = order.status;
  for (let i = from + 1; i <= target; i++) {
    const next = CHAIN[i];
    if (!canTransitionOrder(cur, next)) throw new Error(`${order.no}: ${cur} → ${next} not allowed`);
    await tx.serviceOrder.update({ where: { id: order.id }, data: { status: next, assigneeId: order.assigneeId ?? actorId, quoteSentAt: next === "QUOTE_PENDING" ? new Date() : undefined } });
    for (const a of assets) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId, serviceOrderId: order.id, sourceDocNo: sourceDocNo ?? order.no, summary: `${order.no} ${cur} → ${next}`, payload: { orderStatusFrom: cur, orderStatusTo: next } } });
    cur = next;
  }
  return cur;
}

/** After acceptance the order is frozen: no price, cost, stock or purchasing changes (流程图 验收锁定). */
export function assertNotLocked(order: { no: string; lockedAt: Date | null }) {
  if (order.lockedAt) throw new Error(`ORDER_LOCKED:${order.no}`);
}

/** MD decides on a quote whose margin is below the floor. Re-pricing the quote resets the decision. */
export async function approveMargin(input: { no: string; actorCode: string; decision: "APPROVED" | "REJECTED"; note?: string }) {
  const [order, actor] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, include: { assets: true } }),
    prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } }),
  ]);
  if (actor.role !== "MD") throw new Error("MD_ONLY");
  if (order.marginApproval !== "PENDING" && order.marginApproval !== "REJECTED") throw new Error(`MARGIN_NOT_PENDING:${order.no}`);
  return prisma.$transaction(async (tx) => {
    const u = await tx.serviceOrder.update({ where: { id: order.id }, data: { marginApproval: input.decision, marginApprovedById: actor.id, marginApprovedAt: new Date(), marginNote: input.note } });
    for (const l of order.assets) await tx.assetEvent.create({ data: { assetId: l.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: order.no, summary: `margin ${input.decision}${input.note ? ` · ${input.note}` : ""}`, payload: { marginApproval: input.decision, marginPct: order.marginPct, note: input.note } as Prisma.InputJsonValue } });
    return u;
  });
}

export const CreateServiceOrderInput = z.object({
  createdByEmployeeCode: z.string(),
  customerId: z.string(),
  plantId: z.string().optional(),
  /** 业务模式, picked first and never changed (2026-11-09). Callers that only name a kind get the kind's mode. */
  mode: z.enum(MODES).optional(),
  assetCodes: z.array(z.string()).default([]),
  /** sub-type inside the mode — only 维保 has a choice (MAINTENANCE / OVERHAUL / CONTRACT) */
  kind: z.enum(["REPAIR", "MAINTENANCE", "OVERHAUL", "CONTRACT", "PARTS_SALE"]).optional(),
  partnerReason: z.string().optional(),
  /** 贸易: the customer's inquiry lines (no ATH) */
  requestLines: z.array(z.object({ sku: z.string().optional(), description: z.string().optional(), qty: z.coerce.number().optional(), unit: z.string().optional(), neededBy: z.string().optional(), hsCode: z.string().optional(), origin: z.string().optional() })).optional(),
  /** 国际贸易: currency, Incoterms and place, destination, payment terms (src/lib/export.ts) — required for that mode */
  tradeTerms: z.record(z.unknown()).optional(),
  /** 自动化项目: {name, dueDate?, scope?} — the name is required for that mode */
  project: z.object({ name: z.string(), dueDate: z.string().optional(), scope: z.string().optional() }).optional(),
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
  const mode = data.mode ?? modeFromKind(data.kind ?? "REPAIR");
  if (!OPEN_MODES.includes(mode)) throw new Error(`MODE_NOT_OPEN:${mode}`);
  if (modeNeedsAsset(mode) && data.assetCodes.length === 0) throw new Error("ASSET_REQUIRED");
  const trade = isTradeMode(mode);
  const requestLines = trade ? requestLinesFrom(data.requestLines ?? []) : [];
  if (trade && !requestLines.length) throw new Error("ITEM_LINES_REQUIRED");
  if (trade && data.assetCodes.length) throw new Error("TRADE_HAS_NO_ASSET"); // decided 2026-11-09: SKUs only
  // 国际贸易 (2026-11-09): quoted in the terms' currency on Incoterms; the terms are fixed with the order
  const terms = mode === "INTERNATIONAL_TRADE" ? tradeTermsFrom(data.tradeTerms ?? {}) : undefined;
  // 自动化项目 (2026-11-09): a name and scope now; solution, BOM and milestones on the plan page
  const project = mode === "AUTOMATION_PROJECT" ? { name: data.project?.name.trim() ?? "", dueDate: data.project?.dueDate || undefined, scope: data.project?.scope?.trim() || undefined } : undefined;
  if (project && !project.name) throw new Error("PROJECT_NAME_REQUIRED");
  if (project && data.assetCodes.length) throw new Error("PROJECT_HAS_NO_ASSET");
  const kind = kindFor(mode, data.kind);
  const creator = await prisma.employee.findUniqueOrThrow({ where: { code: data.createdByEmployeeCode } });
  const assets = await prisma.asset.findMany({ where: { code: { in: data.assetCodes } } });
  if (assets.length !== data.assetCodes.length) throw new Error("unknown asset code in request");

  const created = await prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "QT", createdByEmployeeCode: creator.code, entityId: creator.entityId });
    const order = await tx.serviceOrder.create({
      data: {
        no,
        entityId: creator.entityId,
        customerId: data.customerId,
        plantId: data.plantId,
        mode,
        kind,
        partnerReason: mode === "PARTNER_REPAIR" ? data.partnerReason : undefined,
        status: "RECEIVED",
        reportedSymptom: data.reportedSymptom,
        reportedAlarm: data.reportedAlarm,
        productionImpact: data.productionImpact,
        reportedById: data.reportedByContactId,
        createdById: creator.id, salesId: creator.role === "SALES" ? creator.id : null,
        customerRef: keepCustomerRef(data.customerRef),
        currency: terms?.currency ?? data.currency,
        tradeTerms: terms as Prisma.InputJsonValue | undefined,
        project: project as Prisma.InputJsonValue | undefined,
        reportedAt: data.reportedAt,
        attachments: data.attachments as Prisma.InputJsonValue | undefined,
        requestLines: trade ? (requestLines as Prisma.InputJsonValue) : undefined,
        assets: { create: assets.map((a, i) => ({ assetId: a.id, isPrimary: i === 0 })) },
      },
    });
    await tx.document.create({ data: { no, type: "QT", entityId: creator.entityId, countryCode: no.slice(2, 4), customerId: data.customerId, serviceOrderId: order.id, createdById: creator.id, templateCode: trade || project ? TRADE_QUOTE_TEMPLATE : undefined } });
    if (project) await createMilestones(tx, order.id);
    // 设备优先: what these machines were received with or inspected for before any QTTH existed now belongs to this one
    const adopted = await adoptLooseDocs(tx, order, assets.map((a) => a.id));
    Object.assign(order, { adopted });
    for (const a of assets) {
      await tx.assetEvent.create({
        data: {
          assetId: a.id,
          type: "SERVICE_REQUESTED",
          actorId: creator.id,
          serviceOrderId: order.id,
          sourceDocNo: no,
          summary: `${data.reportedSymptom ?? kind}${data.reportedAlarm ? ` (${data.reportedAlarm})` : ""}`,
          payload: { mode, kind, productionImpact: data.productionImpact } as Prisma.InputJsonValue,
          attachments: data.attachments as Prisma.InputJsonValue | undefined,
          occurredAt: data.reportedAt,
        },
      });
    }
    return order;
  });
  // 贸易: what is not on the shelf goes out for supplier quotes at once (same rule as INTH needs, flow step 3)
  const adopted = (created as typeof created & { adopted?: Awaited<ReturnType<typeof adoptLooseDocs>> }).adopted;
  if (adopted?.inspected) {
    const eng = await prisma.employee.findUnique({ where: { id: adopted.inspected.engineerId }, select: { code: true } });
    await catchUpOrder(created.no, "DIAGNOSING", creator.code, eng?.code).catch((e) => console.error(`catch up ${created.no}:`, e));
  }
  if (trade) await autoInquiryForOrder(created.no, creator.code).catch((e) => console.error(`auto PRTH for ${created.no}:`, e));
  return created;
}

export async function advanceServiceOrder(no: string, to: ServiceOrderStatus, actorEmployeeCode: string, note?: string, assigneeCode?: string) {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { assets: true } });
  if (order.status === to) return order; // documents may already have moved the order there (progressOrder)
  if (!canTransitionOrder(order.status, to)) throw new Error(`${no}: ${order.status} → ${to} not allowed`);
  // 客户拒绝报价 (2026-11-09) has its own form: a quote for machines is declined, not cancelled, so the machine goes back
  // on a DNTH and the inspection fee is invoiced or waived; undo goes through undoDecline.
  if (to === "DECLINED") throw new Error(`USE_DECLINE:${no}`);
  if (order.status === "DECLINED" && to === "QUOTE_PENDING") throw new Error(`USE_UNDO_DECLINE:${no}`);
  if (to === "CANCELLED" && order.status === "QUOTE_PENDING" && !quoteJustCancels(order.mode)) throw new Error(`USE_DECLINE:${no}`);
  if (to === "CLOSED") {
    const shape = await declineShapeOf(no);
    const open = shape ? declineCloseBlockers(shape) : [];
    if (open.length) throw new Error(`DECLINE_OPEN:${open.join(",")}`);
    // 国际贸易 (朱总 2026-11-10): delivered per Incoterm, every payment in, packing list + B/L + export entry uploaded
    if (order.mode === "INTERNATIONAL_TRADE") {
      const left = await (await import("@/server/export")).exportBlockersOf(no);
      if (left.length) throw new Error(`EXPORT_CLOSE_BLOCKED:${left.join(",")}`);
    }
  }
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
      transferredFrom: { select: { no: true } },
      transferredTo: { select: { no: true } },
      assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } },
      lines: { orderBy: { lineNo: "asc" } },
      inspections: { where: { draft: false }, include: { engineer: { select: { name: true } } } },
      repairJobs: { include: { engineer: { select: { name: true } } } },
      acceptance: true,
      decline: { include: { contact: { select: { name: true } }, actor: { select: { name: true } } } },
      documents: { include: { createdBy: { select: { name: true } } }, orderBy: { issuedAt: "asc" } },
      taxInvoices: true,
      invoices: { include: { taxInvoice: { select: { no: true } } } },
      deliveries: true,
      inquiries: { select: { no: true, status: true, lines: true } },
      purchaseOrders: { select: { no: true, status: true, currency: true, total: true } },
      reportedBy: true,
      events: { orderBy: { occurredAt: "desc" }, include: { actor: { select: { name: true } } } },
      stockMovements: { include: { part: true } },
      milestones: { orderBy: { seq: "asc" } },
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
  if (!quoteMayGoOut(o.marginApproval)) throw new Error(`MARGIN_APPROVAL_REQUIRED:${o.no}`);
  if (!input.poLines.length) throw new Error("PO_LINES_REQUIRED");
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const merged = [...((o.attachments as { name: string; url: string; kind: string }[] | null) ?? []), ...(input.attachments ?? [])];
  await prisma.$transaction(async (tx) => {
    await tx.serviceOrder.update({ where: { id: o.id }, data: { customerRef: keepCustomerRef(input.customerRef) ?? o.customerRef, poLines: input.poLines as unknown as Prisma.InputJsonValue, attachments: merged as Prisma.InputJsonValue } });
    for (const l of o.assets) await tx.assetEvent.create({ data: { assetId: l.assetId, type: "ORDER_CONFIRMED", actorId: actor.id, serviceOrderId: o.id, sourceDocNo: o.no, summary: input.customerRef ?? o.customerRef ?? "", payload: { customerRef: input.customerRef, lines: input.poLines.length } as Prisma.InputJsonValue, attachments: (input.attachments ?? []) as Prisma.InputJsonValue } });
  });
  const started = await advanceServiceOrder(o.no, "IN_PROGRESS", input.actorCode, input.note ?? input.customerRef);
  // 自动化项目: the PO is the contract milestone (its instalment is then invoiced on the project page)
  if (o.mode === "AUTOMATION_PROJECT") await prisma.projectMilestone.updateMany({ where: { serviceOrderId: o.id, phase: "CONTRACT", doneAt: null }, data: { doneAt: new Date(), doneById: actor.id, note: input.customerRef ?? o.customerRef ?? null } });
  // 国际贸易: the PO brings the proforma invoice PFTH — the export order's invoice (src/server/export.ts)
  if (o.mode === "INTERNATIONAL_TRADE") await (await import("@/server/export")).issueProforma(o.no, input.actorCode);
  // 流程图: 客户回签 → 按 PRTH 生成 POTH (one draft PO per compared inquiry; purchasing confirms and sends it)
  await raisePurchaseOrdersForOrder(o.no, input.actorCode);
  return started;
}

const EARLY = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING"] as const;
/**
 * Inspecting or quoting an order that was never dispatched still moves it on (trial 2026-11-05: it stayed "received"
 * and the customer never saw the quote). Walks RECEIVED → ASSIGNED → DIAGNOSING → QUOTE_PENDING up to `target`;
 * passing ASSIGNED assigns the engineer doing the work.
 */
export async function catchUpOrder(no: string, target: "DIAGNOSING" | "QUOTE_PENDING", actorCode: string, assigneeCode?: string) {
  let cur = (await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } })).status as string;
  const goal = EARLY.indexOf(target);
  for (let i = EARLY.indexOf(cur as (typeof EARLY)[number]); i >= 0 && i < goal; i++) {
    const next = EARLY[i + 1];
    await advanceServiceOrder(no, next, actorCode, undefined, next === "ASSIGNED" ? assigneeCode ?? actorCode : undefined);
    cur = next;
  }
  return cur;
}
