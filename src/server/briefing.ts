/**
 * 设备底细 — what the system already knows before an engineer touches a machine (朱总 2026-11-10: the engineer fills
 * only what he sees, measures and judges; nothing the system knows is typed again). The three layers of iMRO-VFD:
 *   this kind of machine  → knowledge-base entries for the codes in the report, the model's parts with stock
 *   this very machine     → earlier inspections and repairs, parts replaced, last parameter backup
 *   machines like it      → what closed cases on the same model turned out to be
 * Rendered above the inspection form and handed to the model as context when it drafts from dictation or photos.
 */
import { prisma } from "@/lib/db";

export interface Briefing {
  asset: { code: string; serialNumber: string; model: string; location?: string | null; installedAt?: string };
  codes: { code: string; title: string; meaning?: string; checks?: string; parts?: string; id: string }[];
  history: { date: string; no: string; what: string }[];
  backup?: { date: string; name: string };
  cases: { no: string; symptom?: string | null; cause: string }[];
  parts: { sku: string; name: string; position?: string | null; onHand: number }[];
}

const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const one = (s?: string | null, n = 220) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : undefined);

export async function assetBriefing(assetCode: string, report: { symptom?: string | null; alarm?: string | null; orderId?: string }): Promise<Briefing | null> {
  const a = await prisma.asset.findUnique({ where: { code: assetCode }, include: { model: { include: { series: { include: { brand: true } } } } } });
  if (!a) return null;
  // codes as people write them: F30001, A07900, E.OC1, 0001 — taken from the alarm first, then the symptom text
  const words = [...new Set(`${report.alarm ?? ""} ${report.symptom ?? ""}`.match(/[A-Za-z]{0,3}[.\-]?[A-Za-z]{0,3}\d{2,6}|[A-Z]\.[A-Z0-9]{2,5}/g) ?? [])].slice(0, 6);
  const [codes, inspections, jobs, backup, bom, cases] = await Promise.all([
    a.model && words.length ? prisma.faultCode.findMany({ where: { seriesId: a.model.seriesId, code: { in: words, mode: "insensitive" }, status: { not: "RETIRED" } }, take: 6 }) : [],
    prisma.inspection.findMany({ where: { assetId: a.id, draft: false, ...(report.orderId ? { serviceOrderId: { not: report.orderId } } : {}) }, orderBy: { inspectedAt: "desc" }, take: 4, select: { no: true, inspectedAt: true, probableCause: true, findings: true } }),
    prisma.repairJob.findMany({ where: { assetId: a.id }, orderBy: [{ finishedAt: "desc" }, { no: "desc" }], take: 4, select: { no: true, finishedAt: true, startedAt: true, kind: true, rootCause: true, workPerformed: true, hazards: true, partsReplaced: true } }),
    prisma.parameterBackup.findFirst({ where: { assetId: a.id }, orderBy: { takenAt: "desc" } }),
    a.modelId ? prisma.modelPart.findMany({ where: { modelId: a.modelId }, include: { part: { include: { movements: { select: { direction: true, qty: true } } } } }, take: 40 }) : [],
    a.modelId ? prisma.repairJob.findMany({ where: { asset: { modelId: a.modelId, id: { not: a.id } }, rootCause: { not: null }, kind: { not: "MAINTENANCE" } }, orderBy: { finishedAt: "desc" }, take: 4, select: { rootCause: true, serviceOrder: { select: { no: true, reportedSymptom: true } } } }) : [],
  ]);
  const pub = (c: (typeof codes)[number]) => { const p = (c.publicText as Record<string, { meaning?: string; causes?: string[]; checks?: string[] }> | null) ?? {}; return p.zh ?? p.en ?? p.th ?? {}; };
  const history = [
    ...inspections.map((i) => ({ at: i.inspectedAt, date: day(i.inspectedAt), no: i.no, what: one(i.probableCause || i.findings) ?? "" })),
    ...jobs.map((j) => { const parts = ((j.partsReplaced as { partSku?: string; name?: string; qty?: number }[] | null) ?? []).map((p) => `${p.partSku ?? p.name ?? "?"}×${p.qty ?? 1}`).join(", "); return { at: j.finishedAt ?? j.startedAt ?? new Date(0), date: day(j.finishedAt ?? j.startedAt), no: j.no, what: [one(j.kind === "MAINTENANCE" ? j.hazards : j.rootCause), one(j.workPerformed, 120), parts ? `parts: ${parts}` : ""].filter(Boolean).join(" · ") }; }),
  ].sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, 6).map(({ date, no, what }) => ({ date, no, what }));
  return {
    asset: { code: a.code, serialNumber: a.serialNumber, model: a.model ? `${a.model.series.brand.name} ${a.model.series.name} ${a.model.code}` : "", location: a.location, installedAt: day(a.installedAt) || undefined },
    codes: codes.map((c) => { const p = pub(c); return { id: c.id, code: c.code, title: c.title, meaning: one(p.meaning ?? c.meaning, 300), checks: one((p.checks ?? []).join("; ") || c.firstChecks, 400), parts: one(c.commonParts, 160) }; }),
    history,
    backup: backup ? { date: day(backup.takenAt), name: backup.note ?? "" } : undefined,
    cases: cases.map((c) => ({ no: c.serviceOrder.no, symptom: one(c.serviceOrder.reportedSymptom, 80), cause: one(c.rootCause, 160) ?? "" })),
    parts: bom.map((m) => ({ sku: m.part.sku, name: m.part.name, position: m.position, onHand: m.part.movements.reduce((s, x) => s + (x.direction === "IN" ? 1 : -1) * Number(x.qty), 0) })),
  };
}

/** The same briefing as plain text for the model. */
export function briefingText(b: Briefing, report: { symptom?: string | null; alarm?: string | null }): string {
  return [
    `Machine: ${b.asset.code}, S/N ${b.asset.serialNumber}, ${b.asset.model}${b.asset.location ? `, at ${b.asset.location}` : ""}.`,
    `Reported: ${[report.symptom, report.alarm].filter(Boolean).join(" / ") || "—"}.`,
    b.codes.length ? `Knowledge base for the reported codes:\n${b.codes.map((c) => `- ${c.code} ${c.title}: ${c.meaning ?? ""} Checks: ${c.checks ?? "—"}${c.parts ? ` Common parts: ${c.parts}` : ""}`).join("\n")}` : "",
    b.history.length ? `This machine's history:\n${b.history.map((h) => `- ${h.date} ${h.no}: ${h.what}`).join("\n")}` : "This machine has no earlier inspection or repair on file.",
    b.cases.length ? `Closed cases on the same model:\n${b.cases.map((c) => `- ${c.no}: ${c.symptom ?? ""} → ${c.cause}`).join("\n")}` : "",
    b.parts.length ? `Parts of this model (use only these SKUs in "needs"; otherwise leave sku empty):\n${b.parts.map((p) => `- ${p.sku} ${p.name}${p.position ? ` (${p.position})` : ""}, on hand ${p.onHand}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

type FullOrder = NonNullable<Awaited<ReturnType<typeof import("@/server/slm").getServiceOrder>>>;

/**
 * Everything upstream of the form in hand, as text for the model: the machines with their briefing, what was
 * reported, and what the earlier documents of this order already say — so no step asks for it again.
 */
export async function orderContext(order: FullOrder): Promise<string> {
  const report = { symptom: order.reportedSymptom, alarm: order.reportedAlarm, orderId: order.id };
  const briefs = await Promise.all(order.assets.slice(0, 3).map((l) => assetBriefing(l.asset.code, report)));
  const insp = order.inspections.at(-1);
  const needs = ((insp?.needs as { kind?: string; partSku?: string; description?: string; qty?: number; unit?: string }[] | null) ?? []).map((n) => `${n.kind ?? "PART"} ${n.partSku ?? ""} ${n.description ?? ""} × ${n.qty ?? ""} ${n.unit ?? ""}`.replace(/\s+/g, " ").trim());
  const jobs = order.repairJobs.filter((j) => j.finishedAt);
  return [
    `Order ${order.no} (${order.mode}, ${order.status}) for ${order.customer.name}${order.plant ? `, plant ${order.plant.code}` : ""}${order.customerRef ? `, customer ref ${order.customerRef}` : ""}.`,
    ...briefs.filter((b): b is Briefing => !!b).map((b) => briefingText(b, report)),
    !order.assets.length && order.reportedSymptom ? `Request: ${order.reportedSymptom}` : "",
    insp ? `Inspection ${insp.no}: findings: ${one(insp.findings, 500) ?? "—"}; probable cause: ${one(insp.probableCause, 300) ?? "—"}; recommendation: ${one(insp.recommendation, 300) ?? "—"}${needs.length ? `; needs: ${needs.join("; ")}` : ""}` : "",
    jobs.length ? `Work done: ${jobs.map((j) => `${j.no}: ${one(j.rootCause ?? j.hazards, 200) ?? ""} / ${one(j.workPerformed ?? j.handled, 300) ?? ""}`).join(" | ")}` : "",
    order.lines.length ? `Quote lines: ${order.lines.map((l) => `${l.lineNo}. ${l.description} × ${Number(l.qty)} ${l.unit}`).join("; ")}` : "",
    order.stockMovements.filter((m) => m.direction === "OUT" && m.part).length ? `Parts issued from stock: ${order.stockMovements.filter((m) => m.direction === "OUT" && m.part).map((m) => `${m.part!.sku} ${m.part!.name} × ${Number(m.qty)} (${m.no})`).join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
