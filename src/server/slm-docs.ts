/**
 * Execution documents under a QTTH: INTH inspection · quote lines · RPTH/PMTH jobs · acceptance.
 * Each one appends an event to every asset it concerns and registers its number in Document.
 */
import { EXPORT_VAT_RATE } from "@/lib/export";
import { z } from "zod";
import { findPart, resolveParts } from "@/server/scm";
import { openOrderFor, verifySerial } from "@/server/asset-first";
import { prisma } from "@/lib/db";
import { openJob } from "@/lib/drafts";
import { allocateNumber } from "@/lib/numbering-db";
import { totals } from "@/lib/money";
import { assetStatusForWork, canTransitionAsset } from "@/lib/lifecycle";
import { costTotal, marginApprovalFor, marginPct } from "@/lib/margin";
import { marginFloor } from "@/server/modes";
import { assertNotLocked, progressOrder } from "@/server/slm";
import type { AssetStatus, Prisma } from "@prisma/client";

const TestRow = z.object({ test: z.string(), criterion: z.string().optional(), result: z.string().optional(), recordId: z.string().optional(), pass: z.boolean().optional() });
/** What the repair will need, as the engineer sees it at inspection (internal, not on the report). */
export const NeedRow = z.object({ kind: z.enum(["PART", "LABOUR"]), partSku: z.string().optional(), vendorPartNo: z.string().optional(), description: z.string().min(1), descriptionLocal: z.string().optional(), qty: z.number().positive(), unit: z.string().default("pcs") });
export type InspectionNeed = z.infer<typeof NeedRow> & { onHand?: number; short?: number };

// ───────────── INTH ─────────────

export const InspectionInput = z.object({
  /** empty = opened from the ATH: the system finds the machine's open QTTH, or keeps the INTH with the machine until one is opened */
  serviceOrderNo: z.string().optional(),
  assetCode: z.string(),
  engineerCode: z.string(),
  inspectedAt: z.coerce.date().optional(),
  symptoms: z.string().optional(),
  conditions: z.string().optional(),
  findings: z.string().optional(),
  probableCause: z.string().optional(),
  recommendation: z.string().optional(),
  tests: z.array(TestRow).optional(),
  instruments: z.string().optional(),
  openIssues: z.string().optional(),
  conclusion: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
  location: z.enum(["SITE", "WORKSHOP"]).optional(),
  attachmentRefs: z.string().optional(),
  needs: z.array(NeedRow).optional(),
  draft: z.boolean().default(false),
});

/** Stock check for the needs: parts in the catalogue get onHand and short; labour and free-text parts are left as typed. */
export async function checkNeedsStock(needs: z.infer<typeof NeedRow>[]): Promise<InspectionNeed[]> {
  const out: InspectionNeed[] = [];
  for (const n of needs) {
    if (n.kind !== "PART" || !n.partSku) { out.push(n); continue; }
    const part = await findPart(n.partSku);
    if (!part) { out.push({ ...n, onHand: 0, short: n.qty }); continue; }
    const rows = await prisma.stockMovement.groupBy({ by: ["direction"], where: { partId: part.id }, _sum: { qty: true } });
    const sum = (dir: "IN" | "OUT") => Number(rows.find((r) => r.direction === dir)?._sum.qty ?? 0);
    const onHand = sum("IN") - sum("OUT");
    out.push({ ...n, vendorPartNo: n.vendorPartNo ?? part.vendorPartNo, onHand, short: Math.max(0, n.qty - onHand) });
  }
  return out;
}

export async function createInspection(input: z.input<typeof InspectionInput>) {
  const d = InspectionInput.parse(input);
  const [asset, eng] = await Promise.all([
    prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }),
    prisma.employee.findUniqueOrThrow({ where: { code: d.engineerCode } }),
  ]);
  // 设备优先: the INTH is opened from the ATH; it belongs to the order named, else to the machine's open QTTH, else to the machine alone
  const order = d.serviceOrderNo ? await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }) : await openOrderFor(prisma, asset.id);
  if (order && !(await prisma.serviceOrderAsset.findUnique({ where: { serviceOrderId_assetId: { serviceOrderId: order.id, assetId: asset.id } } }))) throw new Error(`ASSET_NOT_ON_ORDER:${asset.code}`);
  // Inspection comes before the work (trial finding 2026-11-14: an INTH was accepted after the PMTH it should have preceded).
  // Once this machine has an RPTH or PMTH on the order, a new INTH is refused; what is found afterwards belongs to a new order.
  if (order) {
    const done = await prisma.repairJob.findFirst({ where: { serviceOrderId: order.id, assetId: asset.id }, orderBy: { no: "desc" }, select: { no: true } });
    const continuing = await prisma.inspection.count({ where: { serviceOrderId: order.id, assetId: asset.id, draft: true } });
    if (done && !continuing) throw new Error(`INSPECTION_AFTER_WORK:${done.no}`);
  }
  // A saved draft of this order and asset is continued (same INTH number); its blanks replace what was there.
  const open = await prisma.inspection.findFirst({ where: { serviceOrderId: order?.id ?? null, assetId: asset.id, draft: true }, orderBy: { no: "desc" } });
  const needs = d.needs ? (d.draft ? d.needs : await checkNeedsStock(d.needs)) : undefined;
  return prisma.$transaction(async (tx) => {
    const v = <T,>(x: T | undefined) => (open ? (x ?? null) : x);
    const data = {
      engineerId: eng.id, inspectedAt: d.inspectedAt ?? open?.inspectedAt ?? undefined,
      symptoms: v(d.symptoms), conditions: v(d.conditions), findings: v(d.findings), probableCause: v(d.probableCause),
      recommendation: v(d.recommendation), tests: (open ? d.tests ?? [] : d.tests) as Prisma.InputJsonValue | undefined, instruments: v(d.instruments),
      openIssues: v(d.openIssues), conclusion: v(d.conclusion),
      attachments: (d.attachments?.length ? [...((open?.attachments as unknown[] | null) ?? []), ...d.attachments] : open?.attachments ?? undefined) as Prisma.InputJsonValue | undefined,
      location: v(d.location), attachmentRefs: v(d.attachmentRefs), draft: d.draft,
      needs: (open ? needs ?? [] : needs) as Prisma.InputJsonValue | undefined,
    };
    const no = open?.no ?? (await allocateNumber(tx, { prefix: "IN", createdByEmployeeCode: eng.code, entityId: order?.entityId ?? asset.entityId }));
    const insp = open
      ? await tx.inspection.update({ where: { id: open.id }, data })
      : await tx.inspection.create({ data: { ...data, no, serviceOrderId: order?.id ?? null, assetId: asset.id } });
    if (d.draft) return insp; // nothing registered yet: no report, no timeline entry, the order does not move
    await tx.document.create({ data: { no, type: "IN", entityId: order?.entityId ?? asset.entityId, countryCode: no.slice(2, 4), customerId: order?.customerId ?? asset.customerId, serviceOrderId: order?.id ?? null, createdById: eng.id, templateCode: "08" } });
    if (order) await progressOrder(tx, order, "DIAGNOSING", eng.id, no);
    await tx.assetEvent.create({
      data: {
        assetId: asset.id, type: "INSPECTED", actorId: eng.id, serviceOrderId: order?.id ?? null, sourceDocNo: no,
        summary: `${d.probableCause ?? d.findings ?? ""}`,
        payload: { findings: d.findings, probableCause: d.probableCause, recommendation: d.recommendation, tests: d.tests, needs } as Prisma.InputJsonValue,
      },
    });
    return insp;
  });
}

// ───────────── Quote lines on the QTTH ─────────────

export const QuoteLinesInput = z.object({
  serviceOrderNo: z.string(),
  actorCode: z.string(),
  vatRate: z.number().min(0).max(1).optional(),
  lines: z.array(z.object({
    assetCode: z.string().optional(),
    partSku: z.string().optional(),
    description: z.string(),
    descriptionLocal: z.string().optional(),
    qty: z.number().positive(),
    unit: z.string().default("pcs"),
    unitPrice: z.number().min(0),
    unitCost: z.number().min(0).optional(), /// cost for the margin; defaults to the part's last purchase cost (partner work: the selected partner quote)
  })).min(1),
  warrantyDays: z.number().int().min(0).optional(), /// what we promise the customer; partner work carries the same days on the POTH
});

/**
 * Partner work: the selected partner quote is the repair's cost, per machine (PRTH lines carry the asset code).
 * Returns asset code → cost in the quote's currency; empty for in-house orders.
 */
export async function partnerCostByAsset(db: Prisma.TransactionClient | typeof prisma, orderId: string): Promise<Map<string, number>> {
  const inqs = await db.purchaseInquiry.findMany({ where: { serviceOrderId: orderId, kind: "SUBCONTRACT", status: { in: ["COMPARED", "ORDERED"] } }, include: { quotes: { where: { selected: true } } } });
  const out = new Map<string, number>();
  for (const inq of inqs) {
    const q = inq.quotes[0];
    if (!q) continue;
    const il = inq.lines as { lineNo: number; assetCode?: string }[];
    for (const l of q.lines as { lineNo: number; qty: number; unitPrice: number }[]) {
      const code = il.find((x) => x.lineNo === l.lineNo)?.assetCode;
      if (code) out.set(code, (out.get(code) ?? 0) + Math.round(l.qty * l.unitPrice * 100) / 100);
    }
  }
  return out;
}

/** Put each machine's partner cost on its first quote line that has no cost of its own (the other lines keep theirs). */
export function spreadPartnerCost<T extends { assetCode?: string | null; qty: number; unitCost?: number | null }>(lines: T[], costs: Map<string, number>): T[] {
  const used = new Set<string>();
  return lines.map((l) => {
    if (!l.assetCode || !costs.has(l.assetCode) || used.has(l.assetCode) || l.unitCost != null) return l;
    used.add(l.assetCode);
    return { ...l, unitCost: Math.round((costs.get(l.assetCode)! / l.qty) * 100) / 100 };
  });
}

/** Replaces the whole line set (a quote is re-issued, never patched) and recomputes totals in order currency + CNY. */
export async function setQuoteLines(input: z.input<typeof QuoteLinesInput>) {
  const d = QuoteLinesInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { entity: true, assets: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  assertNotLocked(order);
  // 国际贸易: an export is zero-rated (src/lib/export.ts — until the accountant says otherwise)
  const vatRate = d.vatRate ?? (order.mode === "INTERNATIONAL_TRADE" ? EXPORT_VAT_RATE : Number(order.entity.vatRate));
  const t = totals(d.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })), vatRate);
  const fx = order.currency === "CNY" ? 1 : (await prisma.fxRate.findFirst({ where: { currency: order.currency }, orderBy: { rateDate: "desc" } }))?.rateToCny;
  const parts = await resolveParts(d.lines.map((l) => l.partSku).filter((s): s is string => !!s));
  const partnerCosts = order.mode === "PARTNER_REPAIR" ? await partnerCostByAsset(prisma, order.id) : new Map<string, number>();
  const costed = spreadPartnerCost(d.lines.map((l) => ({ assetCode: l.assetCode, qty: l.qty, unitPrice: l.unitPrice, unitCost: l.unitCost ?? (l.partSku ? Number(parts.found.get(l.partSku.trim())?.lastCost ?? 0) || undefined : undefined) })), partnerCosts);
  const cost = costTotal(costed), pct = marginPct(costed), approval = marginApprovalFor(pct, await marginFloor(order.mode));

  return prisma.$transaction(async (tx) => {
    await tx.quoteLine.deleteMany({ where: { serviceOrderId: order.id } });
    await tx.quoteLine.createMany({
      data: d.lines.map((l, i) => {
        const part = l.partSku ? parts.found.get(l.partSku.trim()) : undefined;
        return {
          serviceOrderId: order.id, lineNo: i + 1, assetCode: l.assetCode, partId: part?.id, description: l.description,
          descriptionLocal: l.descriptionLocal, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice,
          amount: Math.round(l.qty * l.unitPrice * 100) / 100, costRef: part?.lastCost ?? undefined, unitCost: costed[i].unitCost,
        };
      }),
    });
    const updated = await tx.serviceOrder.update({
      where: { id: order.id },
      data: {
        subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total, fxRateToCny: fx ? Number(fx) : undefined, totalCny: fx ? Math.round(t.total * Number(fx) * 100) / 100 : undefined,
        costTotal: cost, marginPct: pct, marginApproval: approval, marginApprovedById: null, marginApprovedAt: null, marginNote: null,
        ...(d.warrantyDays !== undefined ? { warrantyDays: d.warrantyDays } : {}),
      },
    });
    for (const link of order.assets) {
      await tx.assetEvent.create({ data: { assetId: link.assetId, type: "QUOTED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: order.no, summary: `${order.currency} ${t.total.toFixed(2)} · ${d.lines.length} lines`, payload: { ...t, costTotal: cost, marginPct: pct, marginApproval: approval } as unknown as Prisma.InputJsonValue } });
    }
    await progressOrder(tx, order, "QUOTE_PENDING", actor.id);
    return updated;
  });
}

// ───────────── RPTH / PMTH ─────────────

export const RepairJobInput = z.object({
  serviceOrderNo: z.string(),
  assetCode: z.string(),
  engineerCode: z.string(),
  kind: z.enum(["MAINTENANCE", "REPAIR", "OVERHAUL", "FIELD_SERVICE"]),
  location: z.enum(["SITE", "WORKSHOP"]).default("SITE"),
  startedAt: z.coerce.date().optional(),
  finishedAt: z.coerce.date().optional(),
  confirmedFault: z.string().optional(),
  rootCause: z.string().optional(),
  workPerformed: z.string().optional(),
  partsReplaced: z.array(z.object({ partSku: z.string(), name: z.string().optional(), qty: z.number().positive(), oldSerial: z.string().optional(), newSerial: z.string().optional(), obthNo: z.string().optional(), oldDisposition: z.enum(["SCRAP", "RETURN_TO_CUSTOMER", "KEEP_FOR_ANALYSIS"]).optional() })).optional(),
  configBackupRef: z.string().optional(),
  laborHours: z.number().optional(),
  tests: z.array(TestRow).optional(),
  openIssues: z.string().optional(),
  conclusion: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).optional(),
  // PMTH only
  level: z.enum(["QUARTERLY", "HALF_YEAR", "ANNUAL", "CONTRACT"]).optional(),
  runHours: z.number().int().optional(),
  checklist: z.array(z.object({ item: z.string(), criterion: z.string().optional(), measured: z.string().optional(), verdict: z.enum(["OK", "HANDLED", "HAZARD", "WATCH"]).optional(), photo: z.string().optional() })).optional(),
  hazards: z.string().optional(),
  handled: z.string().optional(),
  recommendation: z.string().optional(),
  conditionRating: z.enum(["GOOD", "GOOD_WITH_ISSUE", "POOR"]).optional(),
  nextDueAt: z.coerce.date().optional(),
  nextDueHours: z.number().int().optional(),
  consumables: z.string().optional(),
  escortContactId: z.string().optional(),
  travelCost: z.number().min(0).optional(),
});

/** Opening a job moves the asset IN_SERVICE → MAINTENANCE/REPAIR/OVERHAUL; finishing it moves to ACCEPTANCE. */
export async function createRepairJob(input: z.input<typeof RepairJobInput>) {
  const d = RepairJobInput.parse(input);
  const [order, asset, eng] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }),
    prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }),
    prisma.employee.findUniqueOrThrow({ where: { code: d.engineerCode } }),
  ]);
  const prefix = d.kind === "MAINTENANCE" ? "PM" : "RP";
  const workStatus: AssetStatus = d.kind === "MAINTENANCE" ? "MAINTENANCE" : d.kind === "OVERHAUL" ? "OVERHAUL" : "REPAIR";
  const target: AssetStatus = d.finishedAt ? "ACCEPTANCE" : workStatus;

  // "Save draft" keeps working on the same unfinished RPTH / PMTH instead of opening a new number each time.
  const open = openJob(await prisma.repairJob.findMany({ where: { serviceOrderId: order.id, assetId: asset.id } }), { maintenance: d.kind === "MAINTENANCE", orderStatus: order.status, assetId: asset.id }) ?? null;
  if (d.escortContactId && !(await prisma.contact.findFirst({ where: { id: d.escortContactId, customerId: order.customerId } }))) throw new Error("ESCORT_NOT_CUSTOMER");

  return prisma.$transaction(async (tx) => {
    // Re-saving a draft replaces it: a field left blank this time is cleared, not kept from the last save.
    const v = <T,>(x: T | undefined) => (open ? (x ?? null) : x);
    const list = (x: unknown[] | undefined) => (open ? (x ?? []) : x) as Prisma.InputJsonValue | undefined;
    const fields = {
      engineerId: eng.id, kind: d.kind, location: d.location,
      startedAt: d.startedAt ?? open?.startedAt ?? new Date(), finishedAt: v(d.finishedAt), confirmedFault: v(d.confirmedFault), rootCause: v(d.rootCause),
      workPerformed: v(d.workPerformed), partsReplaced: list(d.partsReplaced), configBackupRef: v(d.configBackupRef),
      laborHours: v(d.laborHours), tests: list(d.tests), openIssues: v(d.openIssues), conclusion: v(d.conclusion),
      attachments: (d.attachments?.length ? [...((open?.attachments as unknown[] | null) ?? []), ...d.attachments] : open?.attachments ?? undefined) as Prisma.InputJsonValue | undefined,
      level: v(d.level), runHours: v(d.runHours), checklist: list(d.checklist), hazards: v(d.hazards), handled: v(d.handled),
      recommendation: v(d.recommendation), conditionRating: v(d.conditionRating), nextDueAt: v(d.nextDueAt), nextDueHours: v(d.nextDueHours),
      consumables: v(d.consumables), escortContactId: v(d.escortContactId), travelCost: v(d.travelCost),
    };
    const no = open?.no ?? (await allocateNumber(tx, { prefix, createdByEmployeeCode: eng.code, entityId: order.entityId }));
    const templateCode = d.kind === "MAINTENANCE" ? "11" : d.location === "SITE" ? "10" : "09";
    const job = open
      ? await tx.repairJob.update({ where: { id: open.id }, data: fields })
      : await tx.repairJob.create({ data: { no, serviceOrderId: order.id, assetId: asset.id, ...fields } });
    if (open) await tx.document.update({ where: { no }, data: { templateCode } });
    else await tx.document.create({ data: { no, type: prefix, entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: eng.id, templateCode } });

    // status: step into work, and if already finished, on to acceptance
    let status = asset.status;
    for (const next of status === workStatus ? [target] : [workStatus, target]) {
      if (next === status) continue;
      if (!canTransitionAsset(status, next)) throw new Error(`${asset.code}: ${status} → ${next} not allowed`);
      status = next;
    }
    if (status !== asset.status) await tx.asset.update({ where: { id: asset.id }, data: { status } });

    // One work event and one test event per RPTH / PMTH: a draft saved again updates them instead of adding more.
    const type = d.kind === "MAINTENANCE" ? "MAINTAINED" : d.kind === "OVERHAUL" ? "OVERHAULED" : "REPAIRED";
    const work = {
      assetId: asset.id, type, actorId: eng.id, serviceOrderId: order.id, sourceDocNo: no, occurredAt: d.finishedAt ?? d.startedAt ?? open?.startedAt ?? undefined,
      summary: `${d.rootCause ?? d.workPerformed ?? ""}`,
      payload: { confirmedFault: d.confirmedFault, rootCause: d.rootCause, partsReplaced: d.partsReplaced, laborHours: d.laborHours, statusFrom: asset.status, statusTo: status, hazards: d.hazards, handled: d.handled, nextDueAt: d.nextDueAt, nextDueHours: d.nextDueHours, runHours: d.runHours, finished: !!d.finishedAt } as Prisma.InputJsonValue,
      attachments: fields.attachments,
    } as const;
    // The job's own event is kept current while it is a draft, but where the asset came from stays as first recorded.
    const prevWork = open ? await tx.assetEvent.findFirst({ where: { sourceDocNo: no, type } }) : null;
    const firstFrom = (prevWork?.payload as { statusFrom?: string } | null)?.statusFrom;
    if (prevWork) await tx.assetEvent.update({ where: { id: prevWork.id }, data: { ...work, payload: { ...(work.payload as object), statusFrom: firstFrom ?? asset.status } as Prisma.InputJsonValue } });
    else await tx.assetEvent.create({ data: work });
    if (d.tests?.length) {
      const test = { assetId: asset.id, type: "TESTED" as const, actorId: eng.id, serviceOrderId: order.id, sourceDocNo: no, summary: `${d.tests.filter((t) => t.pass !== false).length}/${d.tests.length} pass`, payload: { tests: d.tests } as Prisma.InputJsonValue };
      const prevTest = open ? await tx.assetEvent.findFirst({ where: { sourceDocNo: no, type: "TESTED" } }) : null;
      if (prevTest) await tx.assetEvent.update({ where: { id: prevTest.id }, data: test });
      else await tx.assetEvent.create({ data: test });
    }
    return job;
  });
}

// ───────────── Acceptance (templates 12 + 13) ─────────────

export const AcceptanceInput = z.object({
  serviceOrderNo: z.string(),
  actorCode: z.string(),
  deliverables: z.array(z.object({ deliverable: z.string(), criterion: z.string().optional(), result: z.string().optional() })).min(1),
  status: z.enum(["ACCEPTED", "CONDITIONAL", "REJECTED"]),
  punchList: z.string().optional(),
  acceptedAt: z.coerce.date().optional(),
  warrantyStart: z.coerce.date().optional(),
  warrantyTerms: z.string().optional(),
  customerContactId: z.string().optional(),
  customerSignatory: z.string().optional(),
  signatureUrl: z.string().optional(),
  dcitSignatory: z.string().optional(),
});

/** ACCEPTED / CONDITIONAL → assets back IN_SERVICE, order → ACCEPTED. REJECTED → assets to REPAIR, order back to DIAGNOSING. */
export async function recordAcceptance(input: z.input<typeof AcceptanceInput>) {
  const d = AcceptanceInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { assets: { include: { asset: true } } } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  if (order.status !== "ACCEPTANCE_PENDING" && order.status !== "IN_PROGRESS") throw new Error(`${order.no} is ${order.status}; acceptance needs ACCEPTANCE_PENDING`);
  const ok = d.status !== "REJECTED";
  if (ok) {
    const missing = await missingForAcceptance(order.no);
    if (missing.length) throw new Error(`ACCEPTANCE_INCOMPLETE:${missing.join(",")}`);
  }

  return prisma.$transaction(async (tx) => {
    const acc = await tx.acceptance.upsert({
      where: { serviceOrderId: order.id },
      update: { deliverables: d.deliverables as Prisma.InputJsonValue, punchList: d.punchList, status: d.status, acceptedAt: d.acceptedAt ?? new Date(), warrantyStart: d.warrantyStart, warrantyTerms: d.warrantyTerms, customerContactId: d.customerContactId, customerSignatory: d.customerSignatory, signatureUrl: d.signatureUrl, dcitSignatory: d.dcitSignatory },
      create: { serviceOrderId: order.id, deliverables: d.deliverables as Prisma.InputJsonValue, punchList: d.punchList, status: d.status, acceptedAt: d.acceptedAt ?? new Date(), warrantyStart: d.warrantyStart, warrantyTerms: d.warrantyTerms, customerContactId: d.customerContactId, customerSignatory: d.customerSignatory, signatureUrl: d.signatureUrl, dcitSignatory: d.dcitSignatory },
    });
    // Acceptance is the financial freeze: price, cost, stock issues and purchasing are closed from here on.
    await tx.serviceOrder.update({ where: { id: order.id }, data: { status: ok ? "ACCEPTED" : "DIAGNOSING", lockedAt: ok ? (d.acceptedAt ?? new Date()) : null, lockedById: ok ? actor.id : null } });
    for (const link of order.assets) {
      const from = link.asset.status;
      const to: AssetStatus = ok ? "IN_SERVICE" : "REPAIR";
      if (from !== to) {
        if (from !== "ACCEPTANCE" && !canTransitionAsset(from, to)) throw new Error(`${link.asset.code}: ${from} → ${to} not allowed`);
        await tx.asset.update({ where: { id: link.assetId }, data: { status: to } });
      }
      await tx.assetEvent.create({
        data: { assetId: link.assetId, type: "ACCEPTED", actorId: actor.id, actorName: d.customerSignatory, serviceOrderId: order.id, sourceDocNo: order.no, occurredAt: d.acceptedAt,
          summary: `${d.status}${d.punchList ? ` · ${d.punchList}` : ""}`, // the signatory lives in actorName and is masked when shown
          payload: { status: d.status, deliverables: d.deliverables, warrantyStart: d.warrantyStart, warrantyDays: order.warrantyDays, warrantyUntil: ok && order.warrantyDays != null ? new Date((d.warrantyStart ?? d.acceptedAt ?? new Date()).getTime() + order.warrantyDays * 86_400_000).toISOString().slice(0, 10) : undefined, mode: order.mode, statusFrom: from, statusTo: to } as Prisma.InputJsonValue },
      });
    }
    return acc;
  });
}

/**
 * Recompute costTotal / marginPct / marginApproval from the stored quote lines (after a purchase comparison
 * wrote new costs). A quote that drops below the floor goes back to PENDING; one that recovers clears it.
 */
export async function recomputeMargin(tx: Prisma.TransactionClient, orderId: string, actorId: string, sourceDocNo?: string) {
  const o = await tx.serviceOrder.findUniqueOrThrow({ where: { id: orderId }, include: { lines: true, assets: true } });
  const costed = o.lines.map((l) => ({ qty: Number(l.qty), unitPrice: Number(l.unitPrice), unitCost: l.unitCost != null ? Number(l.unitCost) : undefined }));
  const cost = costTotal(costed), pct = marginPct(costed), approval = marginApprovalFor(pct, await marginFloor(o.mode, tx));
  const keep = approval === "NOT_NEEDED" ? "NOT_NEEDED" : o.marginApproval === "APPROVED" && o.marginPct != null && pct != null && pct >= Number(o.marginPct) ? "APPROVED" : "PENDING";
  await tx.serviceOrder.update({ where: { id: orderId }, data: { costTotal: cost, marginPct: pct, marginApproval: keep, ...(keep === "PENDING" ? { marginApprovedById: null, marginApprovedAt: null } : {}) } });
  for (const a of o.assets) await tx.assetEvent.create({ data: { assetId: a.assetId, type: "QUOTED", actorId, serviceOrderId: orderId, sourceDocNo: sourceDocNo ?? o.no, summary: `cost ${cost.toFixed(2)} · margin ${pct == null ? "-" : (pct * 100).toFixed(1) + "%"}`, payload: { costTotal: cost, marginPct: pct, marginApproval: keep } as Prisma.InputJsonValue } });
  return { cost, pct, approval: keep };
}

/**
 * Document-completeness check before acceptance (流程图 验收第 4 条): INTH and RPTH/PMTH are always required;
 * a workshop job also needs the machine's intake (ERTH) and a signed delivery note (DNTH) — the machine's in and out.
 * Returns the missing document kinds, empty when acceptance may proceed. Shared by the service and the page.
 */
export async function missingForAcceptance(no: string): Promise<string[]> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { inspections: { select: { id: true } }, repairJobs: { select: { location: true } }, documents: { select: { type: true } }, deliveries: { select: { status: true } }, assets: { select: { assetId: true, asset: { select: { code: true } } } } } });
  const missing: string[] = [];
  // 自动化项目 (朱总 2026-11-11): what we deliver is filed as ATH before the customer accepts it
  if (o.mode === "AUTOMATION_PROJECT" && !o.assets.length) missing.push("ATH");
  if (o.mode === "PARTNER_REPAIR") {
    // 合作维修 (flow 2026-11-08): QTTH · INTH · POTH · 外送 OBTH · 返回 IBTH · our retest passed · ERTH in · DNTH out — no RPTH, the partner repaired it
    if (!o.inspections.length) missing.push("INTH");
    const pos = await prisma.purchaseOrder.findMany({ where: { serviceOrderId: o.id, kind: "SUBCONTRACT", status: { not: "CANCELLED" } }, select: { id: true } });
    if (!pos.length) missing.push("POTH");
    const custody = await prisma.stockMovement.findMany({ where: { serviceOrderId: o.id, kind: { in: ["SUBCONTRACT_OUT", "SUBCONTRACT_RETURN"] } }, select: { kind: true } });
    if (!custody.some((m) => m.kind === "SUBCONTRACT_OUT")) missing.push("OBTH");
    if (!custody.some((m) => m.kind === "SUBCONTRACT_RETURN")) missing.push("IBTH");
    const ms = pos.length ? await prisma.subcontractMilestone.findMany({ where: { purchaseOrderId: { in: pos.map((p) => p.id) } }, orderBy: { at: "asc" }, select: { assetId: true, stage: true } }) : [];
    for (const a of o.assets) {
      const last = ms.filter((m) => m.assetId === a.assetId && (m.stage === "RETEST_PASSED" || m.stage === "RETEST_FAILED" || m.stage === "SENT")).at(-1);
      if (last?.stage !== "RETEST_PASSED") missing.push(`RETEST:${a.asset.code}`);
    }
    if (!o.documents.some((d) => d.type === "ER")) missing.push("ERTH");
    if (!o.deliveries.some((d) => d.status === "SIGNED")) missing.push("DNTH");
    return missing;
  }
  // 维保 (trial finding 2026-11-14): a maintenance visit is accepted on its PMTH; an INTH is optional there, as the document chain says
  const maintenance = o.mode === "MAINTENANCE" || o.kind === "MAINTENANCE" || o.kind === "CONTRACT";
  if (!maintenance && o.kind !== "PARTS_SALE" && !o.inspections.length) missing.push("INTH");
  if (!o.repairJobs.length) missing.push(o.kind === "MAINTENANCE" || o.kind === "CONTRACT" ? "PMTH" : "RPTH");
  if (o.repairJobs.some((j) => j.location === "WORKSHOP")) {
    if (!o.documents.some((d) => d.type === "ER")) missing.push("ERTH");
    if (!o.deliveries.some((d) => d.status === "SIGNED")) missing.push("DNTH");
  }
  return missing;
}

export { assetStatusForWork };

// ───────────── ERTH — equipment received at the workshop (template 07) ─────────────

export const ReceiveInput = z.object({
  /** empty = opened from the ATH (朱总 2026-11-11): each machine goes to its own open QTTH, or waits for one */
  serviceOrderNo: z.string().optional(),
  /** one ERTH may take in several machines of one customer; `assetCode` is the single-machine form */
  assetCode: z.string().optional(),
  items: z.array(z.object({ assetCode: z.string(), accessories: z.string().optional(), condition: z.string().optional(), fault: z.string().optional(), serialChecked: z.boolean().optional() })).optional(),
  actorCode: z.string(),
  receivedAt: z.coerce.date().optional(),
  sender: z.string().optional(),
  accessories: z.string().optional(), /// one per line: "item × qty" — parsed so the delivery note can check they all go back
  condition: z.string().optional(),
  fault: z.string().optional(),
  serialChecked: z.boolean().optional(), /// the receiver compared the serial number on the machine with the ATH
  photoRefs: z.string().optional(),
  handlingRestrictions: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).optional(),
});

/**
 * Machines arrive at the workshop: one ERTH number, one RECEIVED_WORKSHOP event per machine carrying its intake record.
 * Receiving is where the ATH ↔ serial number pairing is checked against the machine itself.
 */
export async function receiveEquipment(input: z.input<typeof ReceiveInput>) {
  const d = ReceiveInput.parse(input);
  const items = d.items?.length ? d.items : d.assetCode ? [{ assetCode: d.assetCode, accessories: d.accessories, condition: d.condition, fault: d.fault, serialChecked: d.serialChecked }] : [];
  if (!items.length) throw new Error("ASSET_REQUIRED");
  if (new Set(items.map((i) => i.assetCode)).size !== items.length) throw new Error("RECEIVE_ASSET_TWICE");
  const [named, assets, actor] = await Promise.all([
    d.serviceOrderNo ? prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { assets: { select: { assetId: true } } } }) : null,
    prisma.asset.findMany({ where: { code: { in: items.map((i) => i.assetCode) } } }),
    prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } }),
  ]);
  if (assets.length !== items.length) throw new Error("unknown asset code in request");
  const customers = new Set(assets.map((a) => a.customerId));
  if (customers.size > 1) throw new Error("RECEIVE_ONE_CUSTOMER");
  // which QTTH each machine's intake belongs to: the one named (when the machine is on it), else its own open order, else none yet
  const orderOf = new Map<string, { id: string; entityId: string; customerId: string } | null>();
  for (const a of assets) orderOf.set(a.id, named && named.assets.some((x) => x.assetId === a.id) ? named : await openOrderFor(prisma, a.id));
  if (named && ![...orderOf.values()].some((o) => o?.id === named.id)) throw new Error(`ASSET_NOT_ON_ORDER:${assets[0].code}`);
  const orders = new Set([...orderOf.values()].map((o) => o?.id ?? null));
  const one = orders.size === 1 ? [...orderOf.values()][0] : null; // the ERTH itself follows an order only when every machine on it does
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "ER", createdByEmployeeCode: actor.code, entityId: one?.entityId ?? assets[0].entityId });
    await tx.document.create({ data: { no, type: "ER", entityId: one?.entityId ?? assets[0].entityId, countryCode: no.slice(2, 4), customerId: assets[0].customerId, serviceOrderId: one?.id ?? null, createdById: actor.id, templateCode: "07", issuedAt: d.receivedAt } });
    let first: Awaited<ReturnType<typeof tx.assetEvent.create>> | null = null;
    for (const it of items) {
      const asset = assets.find((a) => a.code === it.assetCode)!;
      if (it.serialChecked) await verifySerial(tx, asset.id, actor);
      const ev = await tx.assetEvent.create({
        data: { assetId: asset.id, type: "RECEIVED_WORKSHOP", actorId: actor.id, serviceOrderId: orderOf.get(asset.id)?.id ?? null, sourceDocNo: no, occurredAt: d.receivedAt, summary: `${it.condition ?? ""}${it.fault ? ` · ${it.fault}` : ""}`, payload: { sender: d.sender, accessories: it.accessories, accessoryList: parseAccessories(it.accessories), condition: it.condition, fault: it.fault, photoRefs: d.photoRefs, handlingRestrictions: d.handlingRestrictions, serialChecked: !!it.serialChecked } as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined },
      });
      first ??= ev;
    }
    return first!;
  });
}

/** "Keyboard × 1\nCable x2, fuse" → [{item, qty}] (qty defaults to 1). */
export function parseAccessories(text?: string): { item: string; qty: number }[] {
  if (!text) return [];
  return text.split(/[\n,，;；]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = /^(.*?)\s*[×xX*]\s*(\d+)\s*$/.exec(x);
    return m ? { item: m[1].trim(), qty: Number(m[2]) } : { item: x, qty: 1 };
  });
}
