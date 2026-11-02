/**
 * LLM assistance (Phase 1 scope): drafts only — nothing here writes to the database.
 * Provider is switchable (decision: Claude API primary, others per specialty); calls go through one `complete()`.
 * Every output carries the record numbers it was built from, so a person can check before saving.
 */
import { prisma } from "@/lib/db";

type Msg = { role: "user"; content: unknown };

async function complete(system: string, messages: Msg[], maxTokens = 1500): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5", max_tokens: maxTokens, system, messages }),
  });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

function json<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("model returned no JSON");
  return JSON.parse(m[0]) as T;
}

export interface NameplateReading { brand?: string; series?: string; model?: string; serialNumber?: string; ratedPowerKw?: number; ratedVoltageV?: number; ratedCurrentA?: number; confidence: number; notes?: string; matchedModelId?: string }

/** 建档辅助: read a nameplate photo, propose brand/series/model/serial, and match against the model library. */
export async function readNameplate(imageBase64: string, mediaType: "image/jpeg" | "image/png" = "image/jpeg"): Promise<NameplateReading> {
  const text = await complete(
    "You read industrial equipment nameplates (VFDs, motors, PLCs). Return only JSON: {brand, series, model, serialNumber, ratedPowerKw, ratedVoltageV, ratedCurrentA, confidence (0-1), notes}. Copy the model and serial exactly as printed; do not guess missing characters — leave the field null and lower confidence.",
    [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } }, { type: "text", text: "Read this nameplate." }] }],
  );
  const r = json<NameplateReading>(text);
  if (r.model) {
    const m = await prisma.model.findFirst({ where: { code: { equals: r.model, mode: "insensitive" } }, include: { series: { include: { brand: true } } } });
    if (m) { r.matchedModelId = m.id; r.brand = m.series.brand.name; r.series = m.series.name; }
  }
  return r;
}

export interface InspectionDraft { conditions?: string; findings?: string; probableCause?: string; recommendation?: string; tests?: { test: string; criterion?: string; result?: string }[]; missing: string[] }

/** 现场记录整理: turn an engineer's voice-note transcript or loose notes into the INTH fields; lists what is still missing. */
export async function draftInspection(notes: string, locale = "zh"): Promise<InspectionDraft> {
  const text = await complete(
    `You structure a field engineer's raw notes about a VFD/motor inspection into a diagnostic report. Write in ${locale === "th" ? "Thai" : locale === "en" ? "English" : "Chinese"}. Return only JSON: {conditions, findings, probableCause, recommendation, tests:[{test,criterion,result}], missing:[...]} where "missing" names the mandatory items the notes do not contain (measured values, instrument, safety isolation, customer authorization). Never invent measurements.`,
    [{ role: "user", content: notes }],
  );
  return json<InspectionDraft>(text);
}

/** 相似案例检索: closed orders on the same series/model with similar symptom, ranked by the model, each with its record numbers. */
export async function similarCases(opts: { modelId?: string; seriesId?: string; symptom: string; alarm?: string; limit?: number }) {
  const candidates = await prisma.serviceOrder.findMany({
    where: { status: { in: ["ACCEPTED", "INVOICED", "CLOSED"] }, assets: { some: { asset: opts.modelId ? { modelId: opts.modelId } : { model: { seriesId: opts.seriesId } } } } },
    include: { inspections: true, repairJobs: true, assets: { include: { asset: { select: { code: true } } } } },
    orderBy: { reportedAt: "desc" }, take: 40,
  });
  if (candidates.length === 0) return [];
  const summary = candidates.map((c) => ({ no: c.no, symptom: c.reportedSymptom, alarm: c.reportedAlarm, cause: c.repairJobs.map((j) => j.rootCause).filter(Boolean).join("; ") || c.inspections.map((i) => i.probableCause).filter(Boolean).join("; "), work: c.repairJobs.map((j) => j.workPerformed).filter(Boolean).join("; "), docs: [...c.inspections.map((i) => i.no), ...c.repairJobs.map((j) => j.no)] }));
  const text = await complete(
    "You rank past service cases by relevance to a new fault report. Return only JSON: {ranked:[{no, relevance (0-1), why}]} with at most the requested number of entries, most relevant first. Judge on symptom and alarm similarity and whether the recorded cause would explain the new symptom.",
    [{ role: "user", content: JSON.stringify({ newCase: { symptom: opts.symptom, alarm: opts.alarm }, pastCases: summary, limit: opts.limit ?? 5 }) }],
  );
  const { ranked } = json<{ ranked: { no: string; relevance: number; why: string }[] }>(text);
  return ranked.map((r) => ({ ...r, ...summary.find((s) => s.no === r.no)! }));
}

/** 三语报告: translate report field values th/zh/en while keeping numbers, codes and document numbers untouched. */
export async function translateFields(values: Record<string, string>, target: "th" | "zh" | "en"): Promise<Record<string, string>> {
  const text = await complete(
    `Translate the JSON values into ${target === "th" ? "Thai" : target === "zh" ? "Simplified Chinese" : "English"} for a technical service report. Keep keys, numbers, units, model codes, serial numbers and document numbers exactly as they are. Return only the JSON object.`,
    [{ role: "user", content: JSON.stringify(values) }], 3000,
  );
  return json<Record<string, string>>(text);
}
