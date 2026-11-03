/**
 * Execution documents under a QTTH: INTH inspection · quote lines · RPTH/PMTH jobs · acceptance.
 * Each one appends an event to every asset it concerns and registers its number in Document.
 */
import { z } from "zod";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { totals } from "@/lib/money";
import { assetStatusForWork, canTransitionAsset } from "@/lib/lifecycle";
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
      },
    });
    await tx.document.create({ data: { no, type: "IN", entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: eng.id, templateCode: "08" } });
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
  })).min(1),
});

/** Replaces the whole line set (a quote is re-issued, never patched) and recomputes totals in order currency + CNY. */
export async function setQuoteLines(input: z.input<typeof QuoteLinesInput>) {
  const d = QuoteLinesInput.parse(input);
  const order = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: d.serviceOrderNo }, include: { entity: true, assets: true } });
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const vatRate = d.vatRate ?? Number(order.entity.vatRate);
  const t = totals(d.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice })), vatRate);
  const fx = order.currency === "CNY" ? 1 : (await prisma.fxRate.findFirst({ where: { currency: order.currency }, orderBy: { rateDate: "desc" } }))?.rateToCny;
  const parts = await prisma.part.findMany({ where: { sku: { in: d.lines.map((l) => l.partSku).filter((s): s is string => !!s) } } });

  return prisma.$transaction(async (tx) => {
    await tx.quoteLine.deleteMany({ where: { serviceOrderId: order.id } });
    await tx.quoteLine.createMany({
      data: d.lines.map((l, i) => {
        const part = parts.find((p) => p.sku === l.partSku);
        return {
          serviceOrderId: order.id, lineNo: i + 1, assetCode: l.assetCode, partId: part?.id, description: l.description,
          descriptionLocal: l.descriptionLocal, qty: l.qty, unit: l.unit, unitPrice: l.unitPrice,
          amount: Math.round(l.qty * l.unitPrice * 100) / 100, costRef: part?.lastCost ?? undefined,
        };
      }),
    });
    const updated = await tx.serviceOrder.update({
      where: { id: order.id },
      data: { subtotal: t.subtotal, vatAmount: t.vatAmount, total: t.total, fxRateToCny: fx ? Number(fx) : undefined, totalCny: fx ? Math.round(t.total * Number(fx) * 100) / 100 : undefined },
    });
    for (const link of order.assets) {
      await tx.assetEvent.create({ data: { assetId: link.assetId, type: "QUOTED", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: order.no, summary: `${order.currency} ${t.total.toFixed(2)} · ${d.lines.length} lines`, payload: t as unknown as Prisma.InputJsonValue } });
    }
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
  partsReplaced: z.array(z.object({ partSku: z.string(), qty: z.number().positive(), oldSerial: z.string().optional(), newSerial: z.string().optional(), obthNo: z.string().optional() })).optional(),
  configBackupRef: z.string().optional(),
  laborHours: z.number().optional(),
  tests: z.array(TestRow).optional(),
  openIssues: z.string().optional(),
  conclusion: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string() })).optional(),
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

  return prisma.$transaction(async (tx) => {
    const no = await allocateNumber(tx, { prefix, createdByEmployeeCode: eng.code, entityId: order.entityId });
    const job = await tx.repairJob.create({
      data: {
        no, serviceOrderId: order.id, assetId: asset.id, engineerId: eng.id, kind: d.kind, location: d.location,
        startedAt: d.startedAt ?? new Date(), finishedAt: d.finishedAt, confirmedFault: d.confirmedFault, rootCause: d.rootCause,
        workPerformed: d.workPerformed, partsReplaced: d.partsReplaced as Prisma.InputJsonValue | undefined, configBackupRef: d.configBackupRef,
        laborHours: d.laborHours, tests: d.tests as Prisma.InputJsonValue | undefined, openIssues: d.openIssues, conclusion: d.conclusion,
        attachments: d.attachments as Prisma.InputJsonValue | undefined,
      },
    });
    await tx.document.create({ data: { no, type: prefix, entityId: order.entityId, countryCode: no.slice(2, 4), customerId: order.customerId, serviceOrderId: order.id, createdById: eng.id, templateCode: d.kind === "MAINTENANCE" ? "11" : d.location === "SITE" ? "10" : "09" } });

    // status: step into work, and if already finished, on to acceptance
    let status = asset.status;
    for (const next of status === workStatus ? [target] : [workStatus, target]) {
      if (next === status) continue;
      if (!canTransitionAsset(status, next)) throw new Error(`${asset.code}: ${status} → ${next} not allowed`);
      status = next;
    }
    if (status !== asset.status) await tx.asset.update({ where: { id: asset.id }, data: { status } });

    await tx.assetEvent.create({
      data: {
        assetId: asset.id, type: d.kind === "MAINTENANCE" ? "MAINTAINED" : d.kind === "OVERHAUL" ? "OVERHAULED" : "REPAIRED",
        actorId: eng.id, serviceOrderId: order.id, sourceDocNo: no, occurredAt: d.finishedAt ?? d.startedAt,
        summary: `${d.rootCause ?? d.workPerformed ?? ""}`,
        payload: { confirmedFault: d.confirmedFault, rootCause: d.rootCause, partsReplaced: d.partsReplaced, laborHours: d.laborHours, statusFrom: asset.status, statusTo: status } as Prisma.InputJsonValue,
      },
    });
    if (d.tests?.length) {
      await tx.assetEvent.create({ data: { assetId: asset.id, type: "TESTED", actorId: eng.id, serviceOrderId: order.id, sourceDocNo: no, summary: `${d.tests.filter((t) => t.pass !== false).length}/${d.tests.length} pass`, payload: { tests: d.tests } as Prisma.InputJsonValue } });
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

  return prisma.$transaction(async (tx) => {
    const acc = await tx.acceptance.upsert({
      where: { serviceOrderId: order.id },
      update: { deliverables: d.deliverables as Prisma.InputJsonValue, punchList: d.punchList, status: d.status, acceptedAt: d.acceptedAt ?? new Date(), warrantyStart: d.warrantyStart, warrantyTerms: d.warrantyTerms, customerContactId: d.customerContactId, customerSignatory: d.customerSignatory, signatureUrl: d.signatureUrl, dcitSignatory: d.dcitSignatory },
      create: { serviceOrderId: order.id, deliverables: d.deliverables as Prisma.InputJsonValue, punchList: d.punchList, status: d.status, acceptedAt: d.acceptedAt ?? new Date(), warrantyStart: d.warrantyStart, warrantyTerms: d.warrantyTerms, customerContactId: d.customerContactId, customerSignatory: d.customerSignatory, signatureUrl: d.signatureUrl, dcitSignatory: d.dcitSignatory },
    });
    await tx.serviceOrder.update({ where: { id: order.id }, data: { status: ok ? "ACCEPTED" : "DIAGNOSING" } });
    for (const link of order.assets) {
      const from = link.asset.status;
      const to: AssetStatus = ok ? "IN_SERVICE" : "REPAIR";
      if (from !== to) {
        if (from !== "ACCEPTANCE" && !canTransitionAsset(from, to)) throw new Error(`${link.asset.code}: ${from} → ${to} not allowed`);
        await tx.asset.update({ where: { id: link.assetId }, data: { status: to } });
      }
      await tx.assetEvent.create({
        data: { assetId: link.assetId, type: "ACCEPTED", actorId: actor.id, actorName: d.customerSignatory, serviceOrderId: order.id, sourceDocNo: order.no, occurredAt: d.acceptedAt,
          summary: `${d.status}${d.punchList ? ` · ${d.punchList}` : ""}${d.customerSignatory ? ` · ${d.customerSignatory}` : ""}`,
          payload: { status: d.status, deliverables: d.deliverables, warrantyStart: d.warrantyStart, statusFrom: from, statusTo: to } as Prisma.InputJsonValue },
      });
    }
    return acc;
  });
}

export { assetStatusForWork };

// ───────────── ERTH — equipment received at the workshop (template 07) ─────────────

export const ReceiveInput = z.object({
  serviceOrderNo: z.string(),
  assetCode: z.string(),
  actorCode: z.string(),
  receivedAt: z.coerce.date().optional(),
  sender: z.string().optional(),
  accessories: z.string().optional(),
  condition: z.string().optional(),
  fault: z.string().optional(),
  photoRefs: z.string().optional(),
  handlingRestrictions: z.string().optional(),
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
      data: { assetId: asset.id, type: "RECEIVED_WORKSHOP", actorId: actor.id, serviceOrderId: order.id, sourceDocNo: no, occurredAt: d.receivedAt, summary: `${d.condition ?? ""}${d.fault ? ` · ${d.fault}` : ""}`, payload: { sender: d.sender, accessories: d.accessories, condition: d.condition, fault: d.fault, photoRefs: d.photoRefs, handlingRestrictions: d.handlingRestrictions } as Prisma.InputJsonValue },
    });
  });
}
