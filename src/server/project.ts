/**
 * 自动化项目 — plan, milestones and instalment invoices (flow 自动化项目-流程图-v1, 2026-11-09; rules src/lib/project.ts).
 *  - savePlan: solution, deliverables, BOM (→ requestLines, so the shortage PRTH and the quote work as for trade),
 *    labour, the payment split and planned dates. BOM and split are fixed once the customer's PO is in.
 *  - completeMilestone: in order; FAT/SAT need their record, DELIVERY a signed DNTH; SAT accepts and locks the order.
 *  - invoiceMilestone: one TITH + IVTH for the instalment (share of the quote subtotal, VAT as usual). Once SAT is done
 *    and every instalment is invoiced, the order is INVOICED; payment and "project complete" as for every order.
 */
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { audit } from "@/server/audit";
import { assertNotLocked, catchUpOrder, progressOrder } from "@/server/slm";
import { autoInquiryForOrder } from "@/server/purchasing";
import { bocRate, writeTaxInvoice } from "@/server/to";
import { assertBusinessClosure } from "@/lib/closure";
import { requestLinesFrom } from "@/lib/modes";
import { PHASES, PHASE_NAME, allInvoiced, checkPaySplit, defaultMilestones, milestoneAmount, milestoneBlockers, type Phase, type ProjectInfo } from "@/lib/project";

const EARLY = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING"];

async function projectOrder(no: string) {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { milestones: { orderBy: { seq: "asc" } }, entity: true, customer: true, deliveries: true } });
  if (o.mode !== "AUTOMATION_PROJECT") throw new Error(`NOT_PROJECT:${no}`);
  return o;
}

/** The nine milestones of a new project with the default split (called inside createServiceOrder's transaction). */
export async function createMilestones(tx: Prisma.TransactionClient, serviceOrderId: string) {
  await tx.projectMilestone.createMany({ data: defaultMilestones().map((m) => ({ serviceOrderId, seq: m.seq, phase: m.phase, payPct: m.payPct })) });
}

export const PlanInput = z.object({
  no: z.string(), actorCode: z.string(),
  solution: z.string().optional(), dueDate: z.string().optional(), scope: z.string().optional(),
  deliverables: z.array(z.object({ name: z.string(), qty: z.coerce.number() })).default([]),
  bom: z.array(z.object({ sku: z.string().optional(), description: z.string().optional(), qty: z.coerce.number().optional(), unit: z.string().optional(), neededBy: z.string().optional() })).default([]),
  labour: z.array(z.object({ description: z.string(), hours: z.coerce.number(), costPerHour: z.coerce.number().optional() })).default([]),
  milestones: z.array(z.object({ phase: z.enum(PHASES), payPct: z.number().nullable(), plannedOn: z.string().optional() })),
});

/** 方案与 BOM. Before the PO: everything; after it only the solution text, deliverables and planned dates change. */
export async function savePlan(input: z.input<typeof PlanInput>) {
  const d = PlanInput.parse(input);
  const o = await projectOrder(d.no);
  assertNotLocked(o);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const open = EARLY.includes(o.status);
  const info = (o.project as unknown as ProjectInfo | null) ?? { name: o.no };
  const deliverables = d.deliverables.filter((x) => x.name.trim() && x.qty > 0).map((x) => ({ name: x.name.trim(), qty: x.qty }));
  const labour = d.labour.filter((x) => x.description.trim() && x.hours > 0).map((x) => ({ description: x.description.trim(), hours: x.hours, costPerHour: x.costPerHour || undefined }));
  const bom = requestLinesFrom(d.bom);
  if (open) checkPaySplit(d.milestones);
  const next: ProjectInfo = { ...info, solution: d.solution?.trim() || undefined, dueDate: d.dueDate || info.dueDate, scope: d.scope?.trim() || info.scope, deliverables, ...(open ? { labour } : {}) };
  await prisma.$transaction(async (tx) => {
    await tx.serviceOrder.update({ where: { id: o.id }, data: { project: next as unknown as Prisma.InputJsonValue, ...(open ? { requestLines: bom as unknown as Prisma.InputJsonValue } : {}) } });
    for (const m of o.milestones) {
      const f = d.milestones.find((x) => x.phase === m.phase);
      if (!f) continue;
      await tx.projectMilestone.update({ where: { id: m.id }, data: { plannedOn: f.plannedOn ? new Date(`${f.plannedOn}T00:00:00Z`) : null, ...(open ? { payPct: f.payPct } : {}) } });
    }
    await audit(actor.id, "PROJECT_PLAN", o.no, { bom: bom.length, labour: labour.length, split: d.milestones.filter((m) => m.payPct).map((m) => `${m.phase} ${m.payPct}`) }, tx);
  });
  if (open && ["RECEIVED", "ASSIGNED"].includes(o.status)) await catchUpOrder(o.no, "DIAGNOSING", actor.code);
  // what the shelf cannot cover goes out for supplier quotes (same rule as trade and INTH needs)
  const prth = open && bom.length ? await autoInquiryForOrder(o.no, actor.code).catch(() => null) : null;
  return { no: o.no, prth };
}

export const MilestoneInput = z.object({
  no: z.string(), actorCode: z.string(), seq: z.number().int(), doneAt: z.string().optional(), note: z.string().optional(),
  attachments: z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).default([]),
});

/** Mark the next milestone done. SAT accepts and locks the order (cost, price, purchasing) — the project's acceptance. */
export async function completeMilestone(input: z.input<typeof MilestoneInput>) {
  const d = MilestoneInput.parse(input);
  const o = await projectOrder(d.no);
  const m = o.milestones.find((x) => x.seq === d.seq);
  if (!m) throw new Error(`NO_MILESTONE:${d.seq}`);
  const shape = o.milestones.map((x) => ({ seq: x.seq, phase: x.phase, payPct: x.payPct == null ? null : Number(x.payPct), doneAt: x.doneAt, taxInvoiceNo: x.taxInvoiceNo }));
  const blockers = milestoneBlockers(shape.find((x) => x.seq === m.seq)!, shape, { files: d.attachments.length, signedDeliveries: o.deliveries.filter((x) => x.status === "SIGNED").length, orderStatus: o.status });
  if (blockers.length) throw new Error(`MILESTONE_${blockers[0]}:${m.phase}`); // one clear reason at a time
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  const at = d.doneAt ? new Date(`${d.doneAt}T00:00:00Z`) : new Date();
  await prisma.$transaction(async (tx) => {
    await tx.projectMilestone.update({ where: { id: m.id }, data: { doneAt: at, doneById: actor.id, note: d.note?.trim() || null, attachments: d.attachments.map((a) => ({ ...a, kind: a.kind ?? m.phase })) as Prisma.InputJsonValue } });
    if (m.phase === "SAT") {
      await progressOrder(tx, o, "ACCEPTED", actor.id, o.no);
      await tx.serviceOrder.update({ where: { id: o.id }, data: { lockedAt: at, lockedById: actor.id } });
    }
    await audit(actor.id, "MILESTONE_DONE", o.no, { phase: m.phase, files: d.attachments.length }, tx);
  });
  if (m.phase === "SAT") await settleProjectStatus(o.no, d.actorCode); // a split without a SAT instalment is fully invoiced already
  return { phase: m.phase as Phase, invoiceDue: !!m.payPct };
}

/** TITH + IVTH for one done instalment. Order currency must be the entity's (THB in Thailand). */
export async function invoiceMilestone(input: { no: string; actorCode: string; seq: number; issuedAt?: Date }) {
  assertBusinessClosure("TI");
  const o = await projectOrder(input.no);
  const m = o.milestones.find((x) => x.seq === input.seq);
  if (!m) throw new Error(`NO_MILESTONE:${input.seq}`);
  if (!m.payPct || !Number(m.payPct)) throw new Error(`MILESTONE_NOT_PAYABLE:${m.phase}`);
  if (!m.doneAt) throw new Error(`MILESTONE_NOT_DONE:${m.phase}`);
  if (m.taxInvoiceNo) throw new Error(`TI_EXISTS:${m.taxInvoiceNo}`);
  if (o.subtotal == null) throw new Error("QUOTE_NEEDS_LINE");
  const currency = o.entity.localCurrency;
  if (o.currency !== currency) throw new Error(`tax invoice must be in ${currency}; order is in ${o.currency}`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  const shape = o.milestones.map((x) => ({ seq: x.seq, phase: x.phase, payPct: x.payPct == null ? null : Number(x.payPct), doneAt: x.doneAt, taxInvoiceNo: x.taxInvoiceNo }));
  const amount = milestoneAmount(shape.find((x) => x.seq === m.seq)!, shape, Number(o.subtotal));
  const k = shape.filter((x) => x.payPct).findIndex((x) => x.seq === m.seq) + 1;
  const pct = Math.round(Number(m.payPct) * 1000) / 10;
  const [en, th] = PHASE_NAME[m.phase as Phase] ?? [m.phase, m.phase];
  const name = (o.project as unknown as ProjectInfo | null)?.name;
  const lines = [{ descriptionLocal: `งวดที่ ${k}: ${th} ${pct}% ของมูลค่าโครงการ ${o.no}`, descriptionEn: `Instalment ${k}: ${en}, ${pct}% of contract ${o.no}${name ? ` (${name})` : ""}`, qty: 1, unit: "lot", unitPrice: amount }];
  const issuedAt = input.issuedAt ?? new Date();
  const fx = await bocRate(currency, issuedAt);
  return prisma.$transaction(async (tx) => {
    const ti = await writeTaxInvoice(tx, { order: o, actor, issuedAt, currency, lines, vatRate: Number(o.entity.vatRate), fx });
    const ivNo = await allocateNumber(tx, { prefix: "IV", createdByEmployeeCode: actor.code, entityId: o.entityId, date: issuedAt });
    await tx.invoice.create({ data: { no: ivNo, serviceOrderId: o.id, taxInvoiceId: ti.id, issuedAt, dueAt: new Date(issuedAt.getTime() + o.customer.paymentTermDays * 86_400_000), currency, amountDue: ti.total } });
    await tx.document.create({ data: { no: ivNo, type: "IV", entityId: o.entityId, countryCode: ivNo.slice(2, 4), customerId: o.customerId, serviceOrderId: o.id, createdById: actor.id, issuedAt } });
    await tx.projectMilestone.update({ where: { id: m.id }, data: { taxInvoiceNo: ti.no, invoiceNo: ivNo } });
    const after = shape.map((x) => (x.seq === m.seq ? { ...x, taxInvoiceNo: ti.no } : x));
    if (o.status === "ACCEPTED" && allInvoiced(after)) await progressOrder(tx, o, "INVOICED", actor.id, ti.no);
    await audit(actor.id, "MILESTONE_INVOICE", o.no, { phase: m.phase, amount, taxInvoice: ti.no, invoice: ivNo }, tx);
    return { taxInvoiceNo: ti.no, invoiceNo: ivNo, amount };
  });
}

/** After SAT: once the last instalment is invoiced the order moves on (called when SAT itself completes late). */
export async function settleProjectStatus(no: string, actorCode: string) {
  const o = await projectOrder(no);
  const shape = o.milestones.map((x) => ({ seq: x.seq, phase: x.phase, payPct: x.payPct == null ? null : Number(x.payPct), doneAt: x.doneAt, taxInvoiceNo: x.taxInvoiceNo }));
  if (o.status !== "ACCEPTED" || !allInvoiced(shape)) return o.status;
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  return prisma.$transaction((tx) => progressOrder(tx, o, "INVOICED", actor.id, o.no));
}
