/**
 * SRM — 合作维修 (partner repair), flow v4 confirmed by the MD on 2026-11-08 (docs: project 《合作维修业务闭环》).
 *   合作维修 order (mode PARTNER_REPAIR, picked at creation — or reopenAsPartner from a REPAIR order after its INTH)
 *   → recommendPartners → PRTH (SUBCONTRACT, no customer data) to several partners
 *   → partner quotes (plan, price, lead time, warranty) → select → cost flows into the QTTH (floor 33 %) → customer signs
 *   → POTH to the chosen partner (warranty back-to-back) → dispatchToPartner = OBTH 外协送修 (外送维修单)
 *   → milestones (internal only) → revisions need customer consent → returnFromPartner = IBTH 外协返回 → our retest
 *   → DNTH / acceptance / TITH as usual → supplier invoice (月结 15 天 TH, else per order; 3 % WHT TH) → rating.
 * Principle: the partner never meets the customer — we carry the machine both ways, no direct delivery exists.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { round2 } from "@/lib/money";
import { assertNotLocked, progressOrder } from "@/server/slm";
import { recomputeMargin, parseAccessories } from "@/server/slm-docs";
import { createInquiry } from "@/server/purchasing";
import { averageScore, custodyOf, defaultPaymentMode, MANUAL_STAGES, missingAccessories, payableDueDate, revisionNeedsConsent, whtRateFor, type PartnerStageKind } from "@/lib/srm";
import { canTransitionAsset, canTransitionOrder } from "@/lib/lifecycle";
import { reopenBlocker } from "@/lib/modes";
import type { Prisma } from "@prisma/client";

const Att = z.object({ name: z.string(), url: z.string(), kind: z.string().optional() });
type AttT = z.infer<typeof Att>;

async function actorOf(code: string) {
  return prisma.employee.findUniqueOrThrow({ where: { code } });
}

// ───────────── 转合作维修: close the repair order, reopen as 合作维修 (decided 2026-11-09) ─────────────

/**
 * A REPAIR order whose INTH shows we cannot repair it ourselves is closed (CANCELLED, reason kept) and a new
 * PARTNER_REPAIR order takes over: the machines, the INTH and ERTH documents with their events, the customer's files,
 * contact and reference. The mode of an order never changes; only before the quote went out and before the lock.
 */
export async function reopenAsPartner(input: { no: string; actorCode: string; reason: string }) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("PARTNER_REASON_REQUIRED");
  const [old, actor] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, include: { assets: true, transferredTo: { select: { no: true } }, documents: { where: { type: { in: ["IN", "ER"] } }, select: { id: true, no: true } } } }),
    actorOf(input.actorCode),
  ]);
  const blocker = reopenBlocker(old);
  if (blocker) throw new Error(`${blocker}:${old.no}`);
  if (!canTransitionOrder(old.status, "CANCELLED")) throw new Error(`TRANSFER_TOO_LATE:${old.no}`);
  const moved = old.documents.map((d) => d.no);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "QT", createdByEmployeeCode: actor.code, entityId: old.entityId });
    const order = await tx.serviceOrder.create({
      data: {
        no, entityId: old.entityId, customerId: old.customerId, plantId: old.plantId, mode: "PARTNER_REPAIR", kind: "REPAIR", partnerReason: reason, transferredFromId: old.id,
        status: old.status, reportedSymptom: old.reportedSymptom, reportedAlarm: old.reportedAlarm, productionImpact: old.productionImpact, reportedById: old.reportedById, reportedAt: old.reportedAt,
        assigneeId: old.assigneeId ?? actor.id, createdById: actor.id, customerRef: old.customerRef, currency: old.currency, warrantyDays: old.warrantyDays,
        poLines: old.poLines ?? undefined, attachments: old.attachments ?? undefined,
        assets: { create: old.assets.map((a) => ({ assetId: a.assetId, isPrimary: a.isPrimary })) },
      },
    });
    await tx.document.create({ data: { no, type: "QT", entityId: old.entityId, countryCode: no.slice(2, 4), customerId: old.customerId, serviceOrderId: order.id, createdById: actor.id } });
    // The inspection and the machine's intake travel with the machine; in-house parts inquiries no longer apply.
    await tx.inspection.updateMany({ where: { serviceOrderId: old.id }, data: { serviceOrderId: order.id } });
    await tx.document.updateMany({ where: { id: { in: old.documents.map((d) => d.id) } }, data: { serviceOrderId: order.id } });
    if (moved.length) await tx.assetEvent.updateMany({ where: { serviceOrderId: old.id, sourceDocNo: { in: moved } }, data: { serviceOrderId: order.id } });
    await tx.purchaseInquiry.updateMany({ where: { serviceOrderId: old.id, status: { in: ["OPEN", "COMPARED"] } }, data: { status: "CANCELLED" } });
    await tx.serviceOrder.update({ where: { id: old.id }, data: { status: "CANCELLED", closedAt: new Date() } });
    for (const a of old.assets) {
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: old.id, sourceDocNo: old.no, summary: `转合作维修 → ${no} · ${reason}`, payload: { to: no, reason } as Prisma.InputJsonValue } });
      await tx.assetEvent.create({ data: { assetId: a.assetId, type: "SERVICE_REQUESTED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: no, summary: `合作维修 ← ${old.no} · ${reason}`, payload: { mode: "PARTNER_REPAIR", from: old.no, reason, moved } as Prisma.InputJsonValue } });
    }
    return order;
  });
}

/** Partners able to repair the order's machines: capability match on asset type, best rating first, then experience. */
export async function recommendPartners(no: string) {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } } } });
  const types = [...new Set(order.assets.map((a) => a.asset.type as string))];
  const partners = await prisma.supplier.findMany({ where: { isPartner: true, active: true }, include: { ratings: true, orders: { where: { kind: "SUBCONTRACT", status: { not: "CANCELLED" } }, select: { id: true } } } });
  return partners
    .map((p) => ({ id: p.id, code: p.code, name: p.name, countryCode: p.countryCode, capabilities: p.capabilities, paymentMode: p.paymentMode, match: types.filter((t) => p.capabilities.includes(t)).length, score: averageScore(p.ratings), ratings: p.ratings.length, jobs: p.orders.length, leadTimeDays: p.leadTimeDays }))
    .sort((a, b) => b.match - a.match || (b.score ?? 0) - (a.score ?? 0) || b.jobs - a.jobs || a.name.localeCompare(b.name));
}

/**
 * PRTH for partner work: one line per machine, carrying only what the partner needs to quote — make, model, S/N,
 * symptom and our INTH findings. No customer name, plant, PO or contact (principle: the partner never meets the customer).
 */
export async function createSubcontractInquiry(input: { no: string; actorCode: string; neededBy?: Date; note?: string; attachments?: AttT[] }) {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: input.no }, include: { assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } }, inspections: { where: { draft: false }, orderBy: { inspectedAt: "desc" } } } });
  if (order.mode !== "PARTNER_REPAIR") throw new Error(`NOT_PARTNER_ORDER:${order.no}`);
  const open = await prisma.purchaseInquiry.findFirst({ where: { serviceOrderId: order.id, kind: "SUBCONTRACT", status: { in: ["OPEN", "COMPARED"] } } });
  if (open) throw new Error(`SUBCONTRACT_INQUIRY_OPEN:${open.no}`);
  const lines = order.assets.map((l) => {
    const a = l.asset, insp = order.inspections.find((i) => i.assetId === a.id);
    const make = a.model ? `${a.model.series.brand.name} ${a.model.code}` : a.type;
    const detail = [insp?.symptoms ?? order.reportedSymptom, insp?.findings, insp?.probableCause].filter(Boolean).join(" / ");
    return { description: `Repair ${make} · S/N ${a.serialNumber}${detail ? ` — ${detail}` : ""}`, qty: 1, unit: "set", assetCode: a.code };
  });
  return createInquiry({ actorCode: input.actorCode, serviceOrderNo: order.no, kind: "SUBCONTRACT", neededBy: input.neededBy, note: input.note, lines, attachments: input.attachments });
}

// ───────────── custody: 外送 OBTH · 返回 IBTH ─────────────

async function poForCustody(poNo: string) {
  const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no: poNo }, include: { serviceOrder: { include: { assets: { include: { asset: true } } } }, supplier: true, milestones: { orderBy: { at: "asc" } } } });
  if (po.kind !== "SUBCONTRACT") throw new Error(`NOT_SUBCONTRACT_PO:${po.no}`);
  if (po.status === "CANCELLED") throw new Error(`PO_CLOSED:${po.no}`);
  if (!po.serviceOrder) throw new Error(`PO_WITHOUT_ORDER:${po.no}`);
  assertNotLocked(po.serviceOrder);
  return po as typeof po & { serviceOrder: NonNullable<typeof po.serviceOrder> };
}

function assetStages(po: { milestones: { assetId: string | null; stage: string }[] }, assetId: string): PartnerStageKind[] {
  return po.milestones.filter((m) => m.assetId === assetId).map((m) => m.stage as PartnerStageKind);
}

/** Where one machine of the order is in the partner cycle, across all of the order's subcontract POTHs. */
export async function custodyForOrder(no: string) {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { assets: { include: { asset: true } } } });
  const ms = await prisma.subcontractMilestone.findMany({ where: { purchaseOrder: { serviceOrderId: order.id } }, orderBy: { at: "asc" }, select: { assetId: true, stage: true } });
  return order.assets.map((a) => ({ assetId: a.assetId, code: a.asset.code, state: custodyOf(ms.filter((m) => m.assetId === a.assetId).map((m) => m.stage as PartnerStageKind)) }));
}

export const DispatchInput = z.object({
  poNo: z.string(), actorCode: z.string(), assetCode: z.string(),
  accessories: z.string().optional(), /// one per line "item × qty" — checked back on the return
  condition: z.string().optional(), carriedBy: z.string().optional(), partnerSigned: z.string().optional(),
  movedAt: z.coerce.date().optional(), attachments: z.array(Att).optional(),
});

/** 整机外送: OBTH of kind SUBCONTRACT_OUT, printed as 外送维修单 (template 28). Parts stock is untouched. */
export async function dispatchToPartner(input: z.input<typeof DispatchInput>) {
  const d = DispatchInput.parse(input);
  const [po, actor] = await Promise.all([poForCustody(d.poNo), actorOf(d.actorCode)]);
  const link = po.serviceOrder.assets.find((a) => a.asset.code === d.assetCode);
  if (!link) throw new Error(`ASSET_NOT_ON_ORDER:${d.assetCode}`);
  const state = custodyOf(assetStages(po, link.assetId));
  if (state === "AT_PARTNER") throw new Error(`ALREADY_AT_PARTNER:${d.assetCode}`);
  if (state === "RETURNED") throw new Error(`RETEST_FIRST:${d.assetCode}`);
  if (state === "PASSED") throw new Error(`ALREADY_PASSED:${d.assetCode}`);
  const accessories = parseAccessories(d.accessories);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "OB", createdByEmployeeCode: actor.code, entityId: po.entityId, date: d.movedAt });
    await tx.stockMovement.create({ data: { no, lineNo: 1, direction: "OUT", kind: "SUBCONTRACT_OUT", qty: 1, assetId: link.assetId, serviceOrderId: po.serviceOrder.id, purchaseOrderId: po.id, movedAt: d.movedAt, byName: d.carriedBy ?? actor.name, accessories: accessories as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined, counterpartySigned: d.partnerSigned } });
    await tx.document.create({ data: { no, type: "OB", entityId: po.entityId, countryCode: no.slice(2, 4), customerId: po.serviceOrder.customerId, serviceOrderId: po.serviceOrder.id, createdById: actor.id, templateCode: "28", issuedAt: d.movedAt } });
    await tx.subcontractMilestone.create({ data: { purchaseOrderId: po.id, assetId: link.assetId, stage: "SENT", at: d.movedAt ?? new Date(), note: d.condition, attachments: d.attachments as Prisma.InputJsonValue | undefined, sourceDocNo: no, byId: actor.id } });
    if (po.status === "DRAFT") await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT" } });
    const work = po.serviceOrder.kind === "OVERHAUL" ? "OVERHAUL" : "REPAIR"; // the machine is under repair while at the partner, as with an RPTH in-house
    if (link.asset.status !== work && canTransitionAsset(link.asset.status, work)) await tx.asset.update({ where: { id: link.assetId }, data: { status: work } });
    await tx.assetEvent.create({ data: { assetId: link.assetId, type: "STATUS_CHANGED", actorId: actor.id, serviceOrderId: po.serviceOrder.id, sourceDocNo: no, occurredAt: d.movedAt, summary: `外送 ${po.no}${accessories.length ? ` · ${accessories.length} accessories` : ""}`, payload: { custody: "AT_PARTNER", purchaseOrder: po.no, supplier: po.supplier.code, accessories } as unknown as Prisma.InputJsonValue } });
    return { no };
  });
}

export const MilestoneInput = z.object({
  poNo: z.string(), actorCode: z.string(), assetCode: z.string(),
  stage: z.enum(["ARRIVED", "DISASSEMBLED", "REPAIRING", "TESTING", "COMPLETED"]),
  at: z.coerce.date().optional(), note: z.string().optional(), attachments: z.array(Att).optional(),
});

/** SRM progress while the machine is at the partner — internal only (never on the portal or a customer document). */
export async function addMilestone(input: z.input<typeof MilestoneInput>) {
  const d = MilestoneInput.parse(input);
  const [po, actor] = await Promise.all([poForCustody(d.poNo), actorOf(d.actorCode)]);
  const link = po.serviceOrder.assets.find((a) => a.asset.code === d.assetCode);
  if (!link) throw new Error(`ASSET_NOT_ON_ORDER:${d.assetCode}`);
  if (custodyOf(assetStages(po, link.assetId)) !== "AT_PARTNER") throw new Error(`NOT_AT_PARTNER:${d.assetCode}`);
  if (!MANUAL_STAGES.includes(d.stage)) throw new Error(`STAGE_NOT_MANUAL:${d.stage}`);
  return prisma.subcontractMilestone.create({ data: { purchaseOrderId: po.id, assetId: link.assetId, stage: d.stage, at: d.at ?? new Date(), note: d.note, attachments: d.attachments as Prisma.InputJsonValue | undefined, byId: actor.id } });
}

export const ReturnInput = z.object({
  poNo: z.string(), actorCode: z.string(), assetCode: z.string(),
  returned: z.string().optional(), /// accessories back, one per line "item × qty"; omitted = everything that went out
  shortAccepted: z.string().optional(), /// why we accept a missing accessory (MD/engineer note) — otherwise a shortage refuses the return
  partnerSigned: z.string().optional(), movedAt: z.coerce.date().optional(), note: z.string().optional(), attachments: z.array(Att).optional(),
});

/** 我方取回: IBTH of kind SUBCONTRACT_RETURN (template 29), referencing the 外送 OBTH; accessories checked back. */
export async function returnFromPartner(input: z.input<typeof ReturnInput>) {
  const d = ReturnInput.parse(input);
  const [po, actor] = await Promise.all([poForCustody(d.poNo), actorOf(d.actorCode)]);
  const link = po.serviceOrder.assets.find((a) => a.asset.code === d.assetCode);
  if (!link) throw new Error(`ASSET_NOT_ON_ORDER:${d.assetCode}`);
  if (custodyOf(assetStages(po, link.assetId)) !== "AT_PARTNER") throw new Error(`NOT_AT_PARTNER:${d.assetCode}`);
  const out = await prisma.stockMovement.findFirstOrThrow({ where: { purchaseOrderId: po.id, assetId: link.assetId, kind: "SUBCONTRACT_OUT" }, orderBy: { movedAt: "desc" } });
  const sent = (out.accessories as { item: string; qty: number }[] | null) ?? [];
  const back = d.returned !== undefined ? parseAccessories(d.returned) : sent;
  const missing = missingAccessories(sent, back);
  if (missing.length && !d.shortAccepted?.trim()) throw new Error(`ACCESSORIES_MISSING:${missing.map((m) => `${m.item}×${m.qty}`).join(",")}`);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "IB", createdByEmployeeCode: actor.code, entityId: po.entityId, date: d.movedAt });
    await tx.stockMovement.create({ data: { no, lineNo: 1, direction: "IN", kind: "SUBCONTRACT_RETURN", qty: 1, assetId: link.assetId, serviceOrderId: po.serviceOrder.id, purchaseOrderId: po.id, movedAt: d.movedAt, byName: actor.name, accessories: back as unknown as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined, counterpartySigned: d.partnerSigned, refNo: out.no, oldPartDisposition: missing.length ? `short accepted: ${d.shortAccepted}` : undefined } });
    await tx.document.create({ data: { no, type: "IB", entityId: po.entityId, countryCode: no.slice(2, 4), customerId: po.serviceOrder.customerId, serviceOrderId: po.serviceOrder.id, createdById: actor.id, templateCode: "29", issuedAt: d.movedAt } });
    await tx.subcontractMilestone.create({ data: { purchaseOrderId: po.id, assetId: link.assetId, stage: "RETURNED", at: d.movedAt ?? new Date(), note: [d.note, missing.length ? `missing ${missing.map((m) => `${m.item}×${m.qty}`).join(", ")} — ${d.shortAccepted}` : ""].filter(Boolean).join(" · ") || undefined, attachments: d.attachments as Prisma.InputJsonValue | undefined, sourceDocNo: no, byId: actor.id } });
    const others = await tx.subcontractMilestone.findMany({ where: { purchaseOrderId: po.id }, orderBy: { at: "asc" }, select: { assetId: true, stage: true } });
    const allBack = po.serviceOrder.assets.every((a) => { const st = custodyOf(others.filter((m) => m.assetId === a.assetId).map((m) => m.stage as PartnerStageKind)); return st !== "AT_PARTNER"; });
    if (allBack) await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "RECEIVED" } });
    await tx.assetEvent.create({ data: { assetId: link.assetId, type: "RECEIVED_WORKSHOP", actorId: actor.id, serviceOrderId: po.serviceOrder.id, sourceDocNo: no, occurredAt: d.movedAt, summary: `返回 ${out.no}${missing.length ? ` · missing ${missing.length}` : ""}`, payload: { custody: "RETURNED", purchaseOrder: po.no, dispatch: out.no, missing } as unknown as Prisma.InputJsonValue } });
    return { no, missing };
  });
}

/**
 * Our own retest after the machine is back. Pass → the machine moves to testing/acceptance and, when every machine of
 * the order passed, the order waits for the customer's acceptance; the ALM record gets partner, plan and warranty.
 * Fail → back to the partner under the POTH warranty (a new 外送 OBTH, no extra charge).
 */
export async function recordRetest(input: { poNo: string; actorCode: string; assetCode: string; passed: boolean; note?: string; attachments?: AttT[] }) {
  const [po, actor] = await Promise.all([poForCustody(input.poNo), actorOf(input.actorCode)]);
  const link = po.serviceOrder.assets.find((a) => a.asset.code === input.assetCode);
  if (!link) throw new Error(`ASSET_NOT_ON_ORDER:${input.assetCode}`);
  if (custodyOf(assetStages(po, link.assetId)) !== "RETURNED") throw new Error(`NOT_RETURNED:${input.assetCode}`);
  if (!input.passed && !input.note?.trim()) throw new Error("RETEST_FAIL_NOTE_REQUIRED");
  return prisma.$transaction(async (tx) => {
    await tx.subcontractMilestone.create({ data: { purchaseOrderId: po.id, assetId: link.assetId, stage: input.passed ? "RETEST_PASSED" : "RETEST_FAILED", note: input.note, attachments: input.attachments as Prisma.InputJsonValue | undefined, byId: actor.id } });
    if (!input.passed) {
      await tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT" } }); // rework under warranty
      await tx.assetEvent.create({ data: { assetId: link.assetId, type: "TESTED", actorId: actor.id, serviceOrderId: po.serviceOrder.id, sourceDocNo: po.no, summary: `retest FAILED · ${input.note}`, payload: { retest: "FAILED", purchaseOrder: po.no, note: input.note } as Prisma.InputJsonValue } });
      return { passed: false };
    }
    const completed = po.milestones.filter((m) => m.assetId === link.assetId && m.stage === "COMPLETED").at(-1);
    await tx.assetEvent.create({ data: { assetId: link.assetId, type: "REPAIRED", actorId: actor.id, serviceOrderId: po.serviceOrder.id, sourceDocNo: po.no,
      summary: `合作维修 ${po.supplier.code ?? po.supplier.name} · ${po.no}${po.warrantyDays != null ? ` · warranty ${po.warrantyDays} d` : ""}`,
      payload: { partner: po.supplier.code, partnerName: po.supplier.name, purchaseOrder: po.no, scope: po.scope, warrantyDays: po.warrantyDays, partnerReport: completed?.note, retest: "PASSED", note: input.note } as Prisma.InputJsonValue } });
    const asset = await tx.asset.findUniqueOrThrow({ where: { id: link.assetId } });
    if (asset.status !== "ACCEPTANCE" && canTransitionAsset(asset.status, "ACCEPTANCE")) await tx.asset.update({ where: { id: asset.id }, data: { status: "ACCEPTANCE" } });
    const ms = await tx.subcontractMilestone.findMany({ where: { purchaseOrder: { serviceOrderId: po.serviceOrder.id } }, orderBy: { at: "asc" }, select: { assetId: true, stage: true } });
    const allPassed = po.serviceOrder.assets.every((a) => custodyOf(ms.filter((m) => m.assetId === a.assetId).map((m) => m.stage as PartnerStageKind)) === "PASSED");
    if (allPassed) await progressOrder(tx, po.serviceOrder, "ACCEPTANCE_PENDING", actor.id, po.no);
    return { passed: true, orderReady: allPassed };
  });
}

/** DNTH may go out for a partner order only after our retest passed on every machine. */
export async function partnerDeliveryBlockers(orderId: string): Promise<string[]> {
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: { assets: { include: { asset: { select: { code: true } } } } } });
  if (order.mode !== "PARTNER_REPAIR") return [];
  const ms = await prisma.subcontractMilestone.findMany({ where: { purchaseOrder: { serviceOrderId: order.id } }, orderBy: { at: "asc" }, select: { assetId: true, stage: true } });
  return order.assets.filter((a) => custodyOf(ms.filter((m) => m.assetId === a.assetId).map((m) => m.stage as PartnerStageKind)) !== "PASSED").map((a) => a.asset.code);
}

// ───────────── changes: 追加费用 / 工期变更 ─────────────

export const RevisionInput = z.object({
  poNo: z.string(), actorCode: z.string(), reason: z.string().min(1, "REVISION_REASON_REQUIRED"),
  lines: z.array(z.object({ description: z.string().min(1), qty: z.number().positive(), unit: z.string().default("set"), unitPrice: z.number().min(0) })).optional(),
  expectedAt: z.coerce.date().optional(),
  customerConsent: z.string().optional(), /// the customer's written OK, verbatim reference (e-mail date, signed change form)
  attachments: z.array(Att).optional(),
});

/** 变更 POTH: same number, version +1. More cost or a later date needs the customer's written consent first; the new cost flows into the QTTH margin. */
export async function revisePurchaseOrder(input: z.input<typeof RevisionInput>) {
  const d = RevisionInput.parse(input);
  const [po, actor] = await Promise.all([prisma.purchaseOrder.findUniqueOrThrow({ where: { no: d.poNo }, include: { serviceOrder: true } }), actorOf(d.actorCode)]);
  if (po.kind !== "SUBCONTRACT") throw new Error(`NOT_SUBCONTRACT_PO:${po.no}`);
  if (po.status === "CANCELLED") throw new Error(`PO_CLOSED:${po.no}`);
  if (po.serviceOrder) assertNotLocked(po.serviceOrder);
  const oldLines = po.lines as { lineNo: number; description: string; qty: number; unit: string; unitPrice: number; amount: number; partSku?: string; vendorPartNo?: string; receivedQty?: number }[];
  const newLines = d.lines ? d.lines.map((l, i) => ({ lineNo: i + 1, ...l, amount: round2(l.qty * l.unitPrice), receivedQty: 0 })) : oldLines;
  const subtotal = round2(newLines.reduce((s, l) => s + l.amount, 0));
  const expectedAt = d.expectedAt ?? po.expectedAt;
  if (revisionNeedsConsent({ subtotal: Number(po.subtotal), expectedAt: po.expectedAt }, { subtotal, expectedAt }) && !d.customerConsent?.trim()) throw new Error("CUSTOMER_CONSENT_REQUIRED");
  const vatAmount = round2(subtotal * Number(po.vatRate)), total = round2(subtotal + vatAmount);
  const rev = { version: po.version + 1, at: new Date().toISOString(), by: actor.code, reason: d.reason, subtotalFrom: Number(po.subtotal), subtotalTo: subtotal, expectedFrom: po.expectedAt?.toISOString() ?? null, expectedTo: expectedAt?.toISOString() ?? null, customerConsent: d.customerConsent ?? null, attachments: d.attachments ?? [] };
  return prisma.$transaction(async (tx) => {
    const u = await tx.purchaseOrder.update({ where: { id: po.id }, data: { lines: newLines as unknown as Prisma.InputJsonValue, subtotal, vatAmount, total, totalCny: po.fxRateToCny ? round2(total * Number(po.fxRateToCny)) : undefined, expectedAt, version: po.version + 1, revisions: [...((po.revisions as unknown[] | null) ?? []), rev] as Prisma.InputJsonValue } });
    if (po.serviceOrder && subtotal !== Number(po.subtotal)) {
      // the POTH is the cost now: spread the change over the order's machines in proportion to the old POTH lines
      const order = await tx.serviceOrder.findUniqueOrThrow({ where: { id: po.serviceOrder.id }, include: { lines: { orderBy: { lineNo: "asc" } }, assets: { include: { asset: true } } } });
      const factor = Number(po.subtotal) > 0 ? subtotal / Number(po.subtotal) : 1;
      for (const a of order.assets) {
        const target = order.lines.find((l) => l.assetCode === a.asset.code && l.unitCost != null);
        if (target) await tx.quoteLine.update({ where: { id: target.id }, data: { unitCost: round2(Number(target.unitCost) * factor) } });
      }
      await recomputeMargin(tx, order.id, actor.id, po.no);
    }
    return u;
  });
}

// ───────────── 合作伙伴评价 ─────────────

const Score = z.number().int().min(1).max(5);
export const RatingInput = z.object({ poNo: z.string(), actorCode: z.string(), quality: Score, onTime: Score, price: Score, cooperation: Score, note: z.string().optional() });

/** One rating per subcontract POTH (re-rating replaces it); the average ranks the partner in recommendPartners. */
export async function rateSupplier(input: z.input<typeof RatingInput>) {
  const d = RatingInput.parse(input);
  const [po, actor] = await Promise.all([prisma.purchaseOrder.findUniqueOrThrow({ where: { no: d.poNo } }), actorOf(d.actorCode)]);
  const data = { supplierId: po.supplierId, quality: d.quality, onTime: d.onTime, price: d.price, cooperation: d.cooperation, note: d.note, byId: actor.id };
  return prisma.supplierRating.upsert({ where: { purchaseOrderId: po.id }, create: { ...data, purchaseOrderId: po.id }, update: data });
}

// ───────────── 应付 — supplier invoices and payment ─────────────

export const SupplierInvoiceInput = z.object({
  poNo: z.string(), actorCode: z.string(), invoiceNo: z.string().min(1), invoiceDate: z.coerce.date(),
  subtotal: z.number().positive(), vatAmount: z.number().min(0).optional(), whtRate: z.number().min(0).max(1).optional(),
  attachments: z.array(Att).optional(),
});

/**
 * Register a supplier's invoice against its POTH. Checked against the POTH (not above its subtotal) and, for partner
 * work, against our retest (not before it passed). Due date from the supplier's terms; WHT 3 % on a Thai partner's repair.
 */
export async function registerSupplierInvoice(input: z.input<typeof SupplierInvoiceInput>) {
  const d = SupplierInvoiceInput.parse(input);
  const [po, actor] = await Promise.all([prisma.purchaseOrder.findUniqueOrThrow({ where: { no: d.poNo }, include: { supplier: true, milestones: true, invoices: { where: { status: { not: "CANCELLED" } } } } }), actorOf(d.actorCode)]);
  if (po.status === "CANCELLED") throw new Error(`PO_CLOSED:${po.no}`);
  const already = po.invoices.reduce((s, i) => s + Number(i.subtotal), 0);
  if (round2(already + d.subtotal) > Number(po.subtotal) + 0.01) throw new Error(`INVOICE_EXCEEDS_PO:${round2(already + d.subtotal)}>${Number(po.subtotal)}`);
  if (po.kind === "SUBCONTRACT" && !po.milestones.some((m) => m.stage === "RETEST_PASSED")) throw new Error(`NOT_ACCEPTED_YET:${po.no}`);
  if (po.kind === "PARTS" && po.status === "DRAFT") throw new Error(`NOT_RECEIVED_YET:${po.no}`);
  const vatAmount = d.vatAmount ?? round2(d.subtotal * Number(po.vatRate));
  const whtRate = d.whtRate ?? whtRateFor(po.supplier.countryCode, po.kind);
  const whtAmount = round2(d.subtotal * whtRate), total = round2(d.subtotal + vatAmount);
  return prisma.supplierInvoice.create({ data: { entityId: po.entityId, supplierId: po.supplierId, purchaseOrderId: po.id, invoiceNo: d.invoiceNo.trim(), invoiceDate: d.invoiceDate, currency: po.currency, subtotal: d.subtotal, vatAmount, total, whtRate, whtAmount, payable: round2(total - whtAmount), dueDate: payableDueDate(d.invoiceDate, po.supplier.paymentMode, po.supplier.paymentDays), attachments: d.attachments as Prisma.InputJsonValue | undefined, createdById: actor.id } });
}

/** Pay a supplier invoice: PVTH number, status PAID. Finance or the MD only. */
export async function paySupplierInvoice(input: { id: string; actorCode: string; paidAt?: Date; paymentRef?: string }) {
  const actor = await actorOf(input.actorCode);
  if (!["MD", "FINANCE", "ADMIN"].includes(actor.role)) throw new Error("FINANCE_ONLY");
  const inv = await prisma.supplierInvoice.findUniqueOrThrow({ where: { id: input.id } });
  if (inv.status !== "OPEN") throw new Error(`PAYABLE_NOT_OPEN:${inv.status}`);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "PV", createdByEmployeeCode: actor.code, entityId: inv.entityId, date: input.paidAt });
    await tx.document.create({ data: { no, type: "PV", entityId: inv.entityId, countryCode: no.slice(2, 4), createdById: actor.id, issuedAt: input.paidAt } });
    return tx.supplierInvoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: input.paidAt ?? new Date(), paymentNo: no, paymentRef: input.paymentRef } });
  });
}

/** Open payables, earliest due first. */
export async function openPayables(entityId?: string) {
  return prisma.supplierInvoice.findMany({ where: { status: "OPEN", ...(entityId ? { entityId } : {}) }, orderBy: { dueDate: "asc" }, include: { supplier: true, purchaseOrder: { select: { no: true, kind: true } } } });
}

// ───────────── supplier partner profile ─────────────

export const PartnerProfileInput = z.object({
  code: z.string(), actorCode: z.string(), isPartner: z.boolean(), capabilities: z.array(z.string()).default([]),
  countryCode: z.string().length(2).default("TH"), paymentMode: z.enum(["MONTHLY", "PER_ORDER"]).optional(), paymentDays: z.number().int().min(0).optional(),
});

export async function savePartnerProfile(input: z.input<typeof PartnerProfileInput>) {
  const d = PartnerProfileInput.parse(input);
  await actorOf(d.actorCode);
  const mode = d.paymentMode ?? defaultPaymentMode(d.countryCode);
  return prisma.supplier.update({ where: { code: d.code }, data: { isPartner: d.isPartner, capabilities: [...new Set(d.capabilities.map((c) => c.trim().toUpperCase()).filter(Boolean))], countryCode: d.countryCode.toUpperCase(), paymentMode: mode, paymentDays: mode === "MONTHLY" ? (d.paymentDays ?? 15) : null } });
}
