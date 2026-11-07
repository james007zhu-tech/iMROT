/**
 * Execution documents under a QTTH: INTH inspection · quote lines · RPTH/PMTH jobs · acceptance.
 * Each one appends an event to every asset it concerns and registers its number in Document.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { openJob } from "@/lib/drafts";
import { allocateNumber } from "@/lib/numbering-db";
import { totals } from "@/lib/money";
import { assetStatusForWork, canTransitionAsset } from "@/lib/lifecycle";
import { costTotal, marginApprovalFor, marginPct } from "@/lib/margin";
import { assertNotLocked, progressOrder } from "@/server/slm";
import type { AssetStatus, Prisma } from "@prisma/client";

const TestRow = z.object({ test: z.string(), criterion: z.string().optional(), result: z.string().optional(), recordId: z.string().optional(), pass: z.boolean().optional() });

// ───────────── INTH ─────────────

export const InspectionInput = z.object({
  serviceOrderNo: z.string(),
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
});

export async function createInspection(input: z.input<typeof InspectionInput>) {
  const d = InspectionInput.parse(input);
  const [order, asset, eng] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }),
    prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }),
    prisma.employee.findUniqueOrThrow({ where: { code: d.engineerCode } }),
  ]);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "IN", createdByEmployeeCode: eng.code, entityId: order.entityId });
    const insp = await tx.inspection.create({
      data: {
        no, serviceOrderId: order.id, assetId: asset.id, engineerId: eng.id, inspectedAt: d.inspectedAt,
        symptoms: d.symptoms, conditions: d.conditions, findings: d.findings, probableCause: d.probableCause,
        recommendation: d.recommendation, tests: d.tests as Prisma.InputJsonValue | undefined, instruments: d.instruments,
        openIssues: d.openIssues, conclusion: d.conclusion, attachments: d.attachments as Prisma.InputJsonValue | undefined,
        location: d.location, attachmentRefs: d.attachmentRefs,
      },
    });
    await tx.document.create({ data: { no, type: "IN", entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: eng.id, templateCode: "08" } });
    await progressOrder(tx, order, "DIAGNOSING", eng.id, no);
    await tx.assetEvent.create({
      data: {
        assetId: asset.id, type: "INSPECTED", actorId: eng.id, serviceOrderId: order.id, sourceDocNo: no,
        summary: `${d.probableCause ?? d.findings ?? ""}`,
        payload: { findings: d.findings, probableCause: d.probableCause, recommendation: d.recommendation, tests: d.tests } as Prisma.InputJsonValue,
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
    unitCost: z.number().min(0).optional(), /// cost for the margin; defaults to the part's last purchase cost
  })).min(1),
});

/** Replaces the whole line set (a quote is re-issued, never patched) and recomputes totals in order currency + CNY. */
export async function setQuoteLines(input: z.input<typeof QuoteLinesInput>) {
  const d = QuoteLinesInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { entity: true, assets: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  assertNotLocked(order);
  const vatRate = d.vatRate ?? Number(order.entity.vatRate);
  const t = totals(d.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })), vatRate);
  const fx = order.currency === "CNY" ? 1 : (await prisma.fxRate.findFirst({ where: { currency: order.currency }, orderBy: { rateDate: "desc" } }))?.rateToCny;
  const parts = await prisma.part.findMany({ where: { sku: { in: d.lines.map((l) => l.partSku).filter((s): s is string => !!s) } } });
  const costed = d.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, unitCost: l.unitCost ?? (l.partSku ? Number(parts.find((p) => p.sku === l.partSku)?.lastCost ?? 0) || undefined : undefined) }));
  const cost = costTotal(costed), pct = marginPct(costed), approval = marginApprovalFor(pct);

  return prisma.$transaction(async (tx) => {
    await tx.quoteLine.deleteMany({ where: { serviceOrderId: order.id } });
    await tx.quoteLine.createMany({
      data: d.lines.map((l, i) => {
        const part = parts.find((p) => p.sku === l.partSku);
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
          payload: { status: d.status, deliverables: d.deliverables, warrantyStart: d.warrantyStart, statusFrom: from, statusTo: to } as Prisma.InputJsonValue },
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
  const cost = costTotal(costed), pct = marginPct(costed), approval = marginApprovalFor(pct);
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
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { inspections: { select: { id: true } }, repairJobs: { select: { location: true } }, documents: { select: { type: true } }, deliveries: { select: { status: true } } } });
  const missing: string[] = [];
  if (o.kind !== "CONTRACT" && o.kind !== "PARTS_SALE" && !o.inspections.length) missing.push("INTH");
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
  serviceOrderNo: z.string(),
  assetCode: z.string(),
  actorCode: z.string(),
  receivedAt: z.coerce.date().optional(),
  sender: z.string().optional(),
  accessories: z.string().optional(), /// one per line: "item × qty" — parsed so the delivery note can check they all go back
  condition: z.string().optional(),
  fault: z.string().optional(),
  photoRefs: z.string().optional(),
  handlingRestrictions: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).optional(),
});

/** Machine arrives at the workshop: ERTH number, RECEIVED_WORKSHOP event carrying the intake record. */
export async function receiveEquipment(input: z.input<typeof ReceiveInput>) {
  const d = ReceiveInput.parse(input);
  const [order, asset, actor] = await Promise.all([
    prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo } }),
    prisma.asset.findUniqueOrThrow({ where: { code: d.assetCode } }),
    prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } }),
  ]);
  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix: "ER", createdByEmployeeCode: actor.code, entityId: order.entityId });
    await tx.document.create({ data: { no, type: "ER", entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: actor.id, templateCode: "07", issuedAt: d.receivedAt } });
    return tx.assetEvent.create({
      data: { assetId: asset.id, type: "RECEIVED_WORKSHOP", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: no, occurredAt: d.receivedAt, summary: `${d.condition ?? ""}${d.fault ? ` · ${d.fault}` : ""}`, payload: { sender: d.sender, accessories: d.accessories, accessoryList: parseAccessories(d.accessories), condition: d.condition, fault: d.fault, photoRefs: d.photoRefs, handlingRestrictions: d.handlingRestrictions } as Prisma.InputJsonValue, attachments: d.attachments as Prisma.InputJsonValue | undefined },
    });
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
