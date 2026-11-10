/**
 * Equipment knowledge services (rules in src/lib/knowledge.ts): series dictionary, fault-code library, review, import,
 * publish, and the public queries. The public queries read PublishedFaultCode only — never FaultCode.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import {
  LANGS, canApprove, canEditDictionary, canPublish, codeFits, codeKey, kindFrom, lines, manualParts, mustStopFrom, patternError, pdfPage,
  pickLang, publicBlocker, publicOnly, publicSearchText, rankHits, searchTextOf, slugify, splitName, statusAfterEdit,
  type FaultStatus, type ManualText, type PublicText, type Source,
} from "@/lib/knowledge";

async function actor(code: string) { return prisma.employee.findUniqueOrThrow({ where: { code } }); }
function need(ok: boolean, code: string) { if (!ok) throw new Error(code); }

// ───────────────────────── dictionary ─────────────────────────

export const DEFAULT_CATEGORIES = [
  { code: "VFD", nameTh: "อินเวอร์เตอร์", nameZh: "变频器", nameEn: "Drive (VFD)", sortOrder: 10 },
  { code: "PLC", nameTh: "PLC", nameZh: "PLC", nameEn: "PLC", sortOrder: 20 },
  { code: "SERVO_DRIVE", nameTh: "เซอร์โวไดรฟ์", nameZh: "伺服驱动", nameEn: "Servo drive", sortOrder: 30 },
  { code: "SERVO_MOTOR", nameTh: "เซอร์โวมอเตอร์", nameZh: "伺服电机", nameEn: "Servo motor", sortOrder: 40 },
  { code: "MOTOR", nameTh: "มอเตอร์", nameZh: "电机", nameEn: "Motor", sortOrder: 50 },
  { code: "HMI", nameTh: "HMI", nameZh: "HMI", nameEn: "HMI", sortOrder: 60 },
  { code: "SOFT_STARTER", nameTh: "ซอฟต์สตาร์ทเตอร์", nameZh: "软启动", nameEn: "Soft starter", sortOrder: 70 },
  { code: "OTHER", nameTh: "อื่น ๆ", nameZh: "其他", nameEn: "Other", sortOrder: 99 },
];
export async function ensureCategories() {
  for (const c of DEFAULT_CATEGORIES) await prisma.productCategory.upsert({ where: { code: c.code }, update: {}, create: c });
}

export async function listSeries(filter: { brandId?: string; q?: string; all?: boolean } = {}) {
  const series = await prisma.series.findMany({
    where: { ...(filter.brandId ? { brandId: filter.brandId } : {}), ...(filter.all ? {} : { active: true }), ...(filter.q ? { OR: [{ name: { contains: filter.q, mode: "insensitive" } }, { code: { contains: filter.q, mode: "insensitive" } }, { aliases: { has: filter.q } }] } : {}) },
    include: { brand: true, category: true, successor: { select: { name: true } }, models: { select: { _count: { select: { assets: true } } } }, _count: { select: { models: true, faultCodes: true } } },
    orderBy: [{ brand: { sortOrder: "asc" } }, { brand: { name: "asc" } }, { name: "asc" }],
  });
  const counts = await prisma.faultCode.groupBy({ by: ["seriesId", "status", "isPublic"], _count: { _all: true }, where: { seriesId: { in: series.map((s) => s.id) } } });
  return series.map((s) => {
    const mine = counts.filter((c) => c.seriesId === s.id);
    const n = (f: (c: (typeof mine)[number]) => boolean) => mine.filter(f).reduce((a, c) => a + c._count._all, 0);
    return { ...s, assets: s.models.reduce((a, m) => a + m._count.assets, 0), codes: { total: n(() => true), approved: n((c) => c.status === "APPROVED"), review: n((c) => c.status === "REVIEW"), isPublic: n((c) => c.status === "APPROVED" && c.isPublic) } };
  });
}

export async function getSeries(id: string) {
  return prisma.series.findUniqueOrThrow({ where: { id }, include: { brand: true, category: true, successor: true, models: { orderBy: { code: "asc" }, include: { _count: { select: { assets: true } } } } } });
}

export interface SeriesInput { brandId: string; code: string; name: string; categoryCode?: string; lifecycle?: "ACTIVE" | "MATURE" | "DISCONTINUED"; successorId?: string; aliases?: string[]; codePattern?: string; codeRule?: string; notes?: string; publicVisible?: boolean; active?: boolean; slug?: string; documents?: Source[] }

export async function saveSeries(id: string | null, d: SeriesInput, actorCode: string) {
  const me = await actor(actorCode);
  need(canEditDictionary(me.role), "FORBIDDEN");
  need(!!d.brandId && !!d.code.trim() && !!d.name.trim(), "INVALID_INPUT");
  const bad = patternError(d.codePattern);
  if (bad) throw new Error(bad);
  if (id && d.successorId === id) throw new Error("INVALID_INPUT:successor");
  const data = {
    brandId: d.brandId, code: d.code.trim(), name: d.name.trim(), categoryCode: d.categoryCode || null, lifecycle: d.lifecycle ?? "ACTIVE",
    successorId: d.successorId || null, aliases: (d.aliases ?? []).map((a) => a.trim()).filter(Boolean), codePattern: d.codePattern?.trim() || null,
    codeRule: d.codeRule?.trim() || null, notes: d.notes?.trim() || null, publicVisible: d.publicVisible ?? true, active: d.active ?? true,
    slug: (d.slug?.trim() && slugify(d.slug)) || slugify(d.name),
    ...(d.documents ? { documents: d.documents as Prisma.InputJsonValue } : {}),
  };
  const s = id ? await prisma.series.update({ where: { id }, data }) : await prisma.series.create({ data });
  await audit(me.id, id ? "SERIES_UPDATED" : "SERIES_CREATED", `${s.code}`, { name: s.name });
  return s;
}

export async function saveBrand(id: string | null, d: { code: string; name: string; website?: string; active?: boolean; sortOrder?: number }, actorCode: string) {
  const me = await actor(actorCode);
  need(canEditDictionary(me.role), "FORBIDDEN");
  need(!!d.code.trim() && !!d.name.trim(), "INVALID_INPUT");
  const data = { code: d.code.trim().toUpperCase(), name: d.name.trim(), slug: slugify(d.name), website: d.website?.trim() || null, active: d.active ?? true, sortOrder: d.sortOrder ?? 100 };
  return id ? prisma.brand.update({ where: { id }, data }) : prisma.brand.create({ data });
}

// ───────────────────────── fault-code library ─────────────────────────

export interface CodeFilter { seriesId?: string; q?: string; kind?: string; status?: string; pub?: "public" | "internal"; take?: number; skip?: number }
function codeWhere(f: CodeFilter): Prisma.FaultCodeWhereInput {
  const q = f.q?.trim().toLowerCase();
  return {
    ...(f.seriesId ? { seriesId: f.seriesId } : {}),
    ...(f.kind ? { kind: f.kind as never } : {}),
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.pub === "public" ? { isPublic: true, status: "APPROVED" } : f.pub === "internal" ? { OR: [{ isPublic: false }, { status: { not: "APPROVED" } }] } : {}),
    ...(q ? { OR: [{ code: { equals: f.q!.trim(), mode: "insensitive" } }, { searchText: { contains: q } }] } : {}),
  };
}
export async function listFaultCodes(f: CodeFilter) {
  const where = codeWhere(f);
  const [rows, total] = await Promise.all([
    prisma.faultCode.findMany({ where, include: { series: { include: { brand: true } }, reviewedBy: { select: { name: true } }, published: { select: { publishedAt: true, version: true } } }, orderBy: [{ seriesId: "asc" }, { code: "asc" }], take: f.take ?? 100, skip: f.skip ?? 0 }),
    prisma.faultCode.count({ where }),
  ]);
  return { rows, total };
}

export async function getFaultCode(id: string) {
  const c = await prisma.faultCode.findUniqueOrThrow({ where: { id }, include: { series: { include: { brand: true, category: true } }, model: true, reviewedBy: { select: { name: true } }, import: { include: { actor: { select: { name: true } } } }, published: true } });
  // our cases: orders whose reported alarm is this code, on a machine of this series
  const cases = await prisma.serviceOrder.findMany({
    where: { reportedAlarm: { contains: c.code, mode: "insensitive" }, assets: { some: { asset: { model: { seriesId: c.seriesId } } } } },
    select: { no: true, status: true, createdAt: true, customer: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 20,
  });
  return { ...c, cases };
}

function internalSearch(c: { code: string; title: string; appliesTo?: string | null; publicText?: unknown; manualText?: unknown; internalNotes?: string | null; commonParts?: string | null; meaning?: string | null; firstChecks?: string | null }) {
  const p = (c.publicText ?? {}) as PublicText, m = (c.manualText ?? {}) as ManualText;
  return searchTextOf([c.code, c.title, c.appliesTo, c.meaning, c.firstChecks, c.internalNotes, c.commonParts,
    ...LANGS.flatMap((l) => [p[l]?.title, p[l]?.meaning, p[l]?.causes, p[l]?.checks, p[l]?.remedy, m[l]?.meaning, m[l]?.actions])]);
}

export interface CodeInput {
  seriesId: string; code: string; kind?: string; mustStop?: string; appliesTo?: string; modelId?: string;
  publicText: PublicText; manualText?: ManualText; source?: Source; related?: string[]; internalNotes?: string; commonParts?: string;
}

export async function saveFaultCode(id: string | null, d: CodeInput, actorCode: string) {
  const me = await actor(actorCode);
  need(!!d.code.trim() && !!d.seriesId, "INVALID_INPUT");
  const pub = publicOnly(d.publicText);
  const title = pub.zh?.title ?? pub.en?.title ?? pub.th?.title ?? d.code.trim();
  const base = {
    seriesId: d.seriesId, code: d.code.trim(), title, kind: (d.kind ?? "FAULT") as never, mustStop: (d.mustStop ?? "UNVERIFIED") as never,
    appliesTo: d.appliesTo?.trim() || null, modelId: d.modelId || null, publicText: pub as Prisma.InputJsonValue,
    ...(d.manualText ? { manualText: d.manualText as Prisma.InputJsonValue } : {}), ...(d.source ? { source: d.source as Prisma.InputJsonValue } : {}),
    related: (d.related ?? []).map((r) => r.trim()).filter(Boolean), internalNotes: d.internalNotes?.trim() || null, commonParts: d.commonParts?.trim() || null,
  };
  // one entry per code per series (or per model): a second one would fight for the same public address
  const twin = await prisma.faultCode.findFirst({ where: { seriesId: base.seriesId, modelId: base.modelId, code: { equals: base.code, mode: "insensitive" }, status: { not: "RETIRED" }, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
  need(!twin, `DUPLICATE_CODE:${base.code}`);
  if (!id) {
    const c = await prisma.faultCode.create({ data: { ...base, status: "DRAFT", origin: "MANUAL", searchText: internalSearch({ ...base, manualText: d.manualText }) } });
    await audit(me.id, "FAULT_CODE_CREATED", c.code, { seriesId: c.seriesId });
    return c;
  }
  const old = await prisma.faultCode.findUniqueOrThrow({ where: { id } });
  const publicChanged = JSON.stringify(publicOnly(old.publicText as PublicText)) !== JSON.stringify(pub) || old.code !== base.code || old.kind !== base.kind || old.mustStop !== base.mustStop || (old.appliesTo ?? null) !== base.appliesTo;
  const status = statusAfterEdit(old.status as FaultStatus, publicChanged);
  const c = await prisma.faultCode.update({
    where: { id },
    data: { ...base, status, reviewed: status === "APPROVED", version: publicChanged ? old.version + 1 : old.version, searchText: internalSearch({ ...base, manualText: d.manualText ?? old.manualText }) },
  });
  await audit(me.id, "FAULT_CODE_UPDATED", c.code, { publicChanged, status });
  return c;
}

/** Review actions on one or many codes (bulk from the list). */
export async function reviewCodes(input: { ids: string[]; action: "submit" | "approve" | "reject" | "public" | "internal" | "retire"; note?: string; actorCode: string }) {
  const me = await actor(input.actorCode);
  const codes = await prisma.faultCode.findMany({ where: { id: { in: input.ids } } });
  need(codes.length > 0, "INVALID_INPUT");
  if (["approve", "reject", "public", "internal", "retire"].includes(input.action)) need(canApprove(me.role), "FORBIDDEN");
  if (input.action === "reject") need(!!input.note?.trim(), "REJECT_NEEDS_NOTE");
  let changed = 0;
  const skipped: string[] = [];
  for (const c of codes) {
    let data: Prisma.FaultCodeUpdateInput | null = null;
    if (input.action === "submit" && c.status === "DRAFT") data = { status: "REVIEW" };
    if (input.action === "approve" && (c.status === "REVIEW" || c.status === "DRAFT")) data = { status: "APPROVED", reviewed: true, reviewedBy: { connect: { id: me.id } }, reviewedAt: new Date(), reviewNote: input.note?.trim() || null };
    if (input.action === "reject" && c.status !== "RETIRED") data = { status: "DRAFT", reviewed: false, isPublic: false, reviewNote: input.note!.trim() };
    if (input.action === "public") { const why = publicBlocker({ status: c.status, publicText: c.publicText as PublicText }); if (!why) data = { isPublic: true }; else skipped.push(`${c.code}:${why}`); }
    if (input.action === "internal") data = { isPublic: false };
    if (input.action === "retire") data = { status: "RETIRED", reviewed: false, isPublic: false };
    if (data) { await prisma.faultCode.update({ where: { id: c.id }, data }); changed++; } else if (input.action !== "public") skipped.push(c.code);
  }
  await audit(me.id, `FAULT_CODE_${input.action.toUpperCase()}`, `${changed} codes`, { ids: input.ids.length, skipped: skipped.slice(0, 20), note: input.note });
  return { changed, skipped };
}

// ───────────────────────── import ─────────────────────────

export type ImportRow = {
  brand: string; series: string; code: string; kind: string; mustStop: string; appliesTo?: string;
  publicText: PublicText; manualText: ManualText; source: Source; internalNotes?: string; commonParts?: string;
};
export type ImportPreview = { format: "GROK_JSON" | "CSV"; rows: (ImportRow & { action: "create" | "update" | "skip"; issues: string[] })[]; missing: { brand?: string; series?: string }[]; manual?: Source };

/** Grok's export (2026-11-10, ACS880): {meta:{brand, series, manual, manual_sha256, official_url}, codes:[{code, name_zh, …}]} */
function parseGrokJson(text: string): { rows: ImportRow[]; manual?: Source } {
  const d = JSON.parse(text) as { meta?: Record<string, string>; codes?: Record<string, string>[] };
  if (!d?.meta || !Array.isArray(d.codes)) throw new Error("IMPORT_FORMAT");
  const manual: Source = { ...manualParts(d.meta.manual ?? ""), url: d.meta.official_url, sha256: d.meta.manual_sha256 };
  const appliesTo = (() => { const m = (d.meta.manual ?? "").match(/^(.*?)\s+Firmware manual.*?Rev\.?\s*([A-Z0-9.]+)/i); return m ? `${m[1]} · Rev ${m[2]}` : undefined; })();
  const rows = d.codes.map((c): ImportRow => {
    const n = splitName(c.name_zh ?? c.code);
    return {
      brand: d.meta!.brand, series: d.meta!.series, code: String(c.code ?? "").trim(), kind: kindFrom(c.type, c.category_zh), mustStop: mustStopFrom(c.must_stop), appliesTo,
      publicText: { zh: { title: n.zh, remedy: c.reset_zh || undefined, prepare: c.ask_first_zh || undefined }, ...(n.en ? { en: { title: n.en } } : {}) },
      manualText: { en: { meaning: c.meaning_en, actions: c.first_checks_en }, zh: { meaning: c.meaning_zh, actions: c.first_checks_zh }, th: { meaning: c.meaning_th, actions: c.first_checks_th } },
      source: { ...manual, page: pdfPage(c.source) },
      internalNotes: [c.note_zh, c.status ? `来源核对：${c.status}` : ""].filter(Boolean).join("\n") || undefined,
      commonParts: c.common_parts_zh || undefined,
    };
  });
  return { rows, manual };
}

/** Our CSV template (doc §导入格式): one row per code per language; causes/checks separated by "|". */
function parseCsv(text: string): { rows: ImportRow[] } {
  const recs = csvRecords(text.replace(/^﻿/, ""));
  const head = recs.shift()?.map((h) => h.trim().toLowerCase()) ?? [];
  if (head.includes("name_zh")) {
    // Grok's CSV twin of the JSON export: rebuild the JSON shape and reuse its mapping
    const codes = recs.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
    throw Object.assign(new Error("IMPORT_GROK_CSV"), { codes });
  }
  for (const k of ["brand", "series", "code", "lang", "title"]) if (!head.includes(k)) throw new Error(`IMPORT_FORMAT:${k}`);
  const at = (r: string[], k: string) => (r[head.indexOf(k)] ?? "").trim();
  const by = new Map<string, ImportRow>();
  for (const r of recs.filter((x) => x.length > 1)) {
    const key = `${at(r, "brand")}|${at(r, "series")}|${at(r, "code")}`;
    const row = by.get(key) ?? { brand: at(r, "brand"), series: at(r, "series"), code: at(r, "code"), kind: kindFrom(at(r, "kind"), ""), mustStop: mustStopFrom(at(r, "must_stop")), appliesTo: at(r, "applies_to") || undefined, publicText: {}, manualText: {}, source: { title: at(r, "source_title") || undefined, revision: at(r, "source_revision") || undefined, page: Number(at(r, "source_page")) || undefined, url: at(r, "source_url") || undefined } };
    const lang = at(r, "lang") as "zh" | "en" | "th";
    if ((["zh", "en", "th"] as string[]).includes(lang)) row.publicText[lang] = { title: at(r, "title"), meaning: at(r, "meaning") || undefined, causes: at(r, "causes") ? at(r, "causes").split("|").map((x) => x.trim()) : undefined, checks: at(r, "checks") ? at(r, "checks").split("|").map((x) => x.trim()) : undefined, remedy: at(r, "remedy") || undefined, safety: at(r, "safety") || undefined };
    by.set(key, row);
  }
  return { rows: [...by.values()] };
}

function csvRecords(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); out.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

function parseImport(fileName: string, text: string): { format: "GROK_JSON" | "CSV"; rows: ImportRow[]; manual?: Source } {
  if (/\.json$/i.test(fileName) || text.trimStart().startsWith("{")) return { format: "GROK_JSON", ...parseGrokJson(text) };
  try { return { format: "CSV", ...parseCsv(text) }; } catch (e) {
    const codes = (e as { codes?: Record<string, string>[] }).codes;
    if (!codes) throw e;
    // a Grok CSV has no meta block: brand/series must come from the series picked on the page — returned as "?"
    return { format: "CSV", ...parseGrokJson(JSON.stringify({ meta: { brand: "?", series: "?", manual: codes[0]?.source?.split("；")[0] ?? "" }, codes })) };
  }
}

async function resolveSeries(brand: string, series: string) {
  const b = await prisma.brand.findFirst({ where: { OR: [{ code: { equals: brand, mode: "insensitive" } }, { name: { equals: brand, mode: "insensitive" } }] } });
  const s = b ? await prisma.series.findFirst({ where: { brandId: b.id, OR: [{ code: { equals: series, mode: "insensitive" } }, { name: { equals: series, mode: "insensitive" } }, { aliases: { has: series } }] } }) : null;
  return { b, s };
}

/** From the data itself: all 4-hex → a pattern, and which leading character always means the same kind. */
function deriveRule(rows: ImportRow[]): { codePattern: string | null; codeRule: string | null } {
  const hex4 = rows.length > 0 && rows.every((r) => /^[0-9A-F]{4}$/i.test(r.code));
  if (!hex4) return { codePattern: null, codeRule: null };
  const byLead = new Map<string, Set<string>>();
  for (const r of rows) byLead.set(r.code[0].toUpperCase(), (byLead.get(r.code[0].toUpperCase()) ?? new Set()).add(r.kind));
  const leads = [...byLead].filter(([, k]) => k.size === 1 && !k.has("FAULT")).map(([c, k]) => `${c} 开头：${[...k][0] === "WARNING" ? "警告" : [...k][0] === "EVENT" ? "事件" : [...k][0]}`);
  return { codePattern: "^[0-9A-F]{4}$", codeRule: `4 位十六进制${leads.length ? `；${leads.join("；")}；其余：故障` : ""}（按导入数据）` };
}

/** Preview (dryRun) or commit an import. New rows land as REVIEW (待审核); approved codes are never overwritten. */
export async function importFaultCodes(input: { fileName: string; text: string; actorCode: string; dryRun: boolean; createMissing?: boolean; categoryCode?: string; seriesId?: string }) {
  const me = await actor(input.actorCode);
  need(canApprove(me.role) || canEditDictionary(me.role), "FORBIDDEN");
  const parsed = parseImport(input.fileName, input.text);
  if (input.seriesId) {
    const s = await prisma.series.findUniqueOrThrow({ where: { id: input.seriesId }, include: { brand: true } });
    for (const r of parsed.rows) { r.brand = s.brand.name; r.series = s.code; }
  }
  const groups = new Map<string, ImportRow[]>();
  for (const r of parsed.rows) groups.set(`${r.brand}|${r.series}`, [...(groups.get(`${r.brand}|${r.series}`) ?? []), r]);
  const preview: ImportPreview = { format: parsed.format, rows: [], missing: [], manual: parsed.manual };
  const seriesIds = new Map<string, string | null>();
  for (const [key, rows] of groups) {
    const [brand, series] = key.split("|");
    let { b, s } = await resolveSeries(brand, series);
    const derived = deriveRule(rows);
    if ((!b || !s) && !input.dryRun && input.createMissing && canEditDictionary(me.role)) {
      b ??= await prisma.brand.create({ data: { code: brand.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12) || "BRAND", name: brand, slug: slugify(brand) } });
      s = await prisma.series.create({ data: { brandId: b.id, code: series, name: series, slug: slugify(series), categoryCode: input.categoryCode || null, ...derived, documents: parsed.manual ? [parsed.manual] as Prisma.InputJsonValue : undefined } });
    } else if (s && !input.dryRun && canEditDictionary(me.role)) {
      // an existing series keeps what people wrote; the import only fills what is still blank
      const fill: Prisma.SeriesUpdateInput = {};
      if (!s.codePattern && derived.codePattern) { fill.codePattern = derived.codePattern; fill.codeRule = s.codeRule ?? derived.codeRule; }
      if (!s.categoryCode && input.categoryCode) fill.category = { connect: { code: input.categoryCode } };
      if (!s.documents && parsed.manual) fill.documents = [parsed.manual] as Prisma.InputJsonValue;
      if (!s.slug) fill.slug = slugify(s.name);
      if (Object.keys(fill).length) s = await prisma.series.update({ where: { id: s.id }, data: fill });
    }
    if (!b || !s) { preview.missing.push({ brand: b ? undefined : brand, series }); seriesIds.set(key, null); }
    else seriesIds.set(key, s.id);
    const existing = s ? await prisma.faultCode.findMany({ where: { seriesId: s.id, modelId: null, code: { in: rows.map((r) => r.code) } } }) : [];
    for (const r of rows) {
      const issues: string[] = [];
      if (!r.code) issues.push("NO_CODE");
      if (s && !codeFits(s.codePattern, r.code)) issues.push("CODE_PATTERN");
      if (r.mustStop === "UNVERIFIED") issues.push("MUST_STOP_UNVERIFIED");
      const old = existing.find((e) => e.code.toLowerCase() === r.code.toLowerCase());
      const action = !r.code || !s && !input.createMissing ? "skip" : old ? (old.status === "APPROVED" ? "skip" : "update") : "create";
      if (old?.status === "APPROVED") issues.push("APPROVED_NOT_OVERWRITTEN");
      preview.rows.push({ ...r, action, issues });
    }
  }
  if (input.dryRun) return { preview, importId: null };

  const counts = { created: 0, updated: 0, skipped: 0, flagged: preview.rows.filter((r) => r.issues.includes("CODE_PATTERN")).length };
  const imp = await prisma.faultCodeImport.create({ data: { fileName: input.fileName, format: parsed.format, actorId: me.id, counts: counts as Prisma.InputJsonValue } });
  for (const r of preview.rows) {
    const sid = seriesIds.get(`${r.brand}|${r.series}`);
    if (!sid || r.action === "skip") { counts.skipped++; continue; }
    const title = r.publicText.zh?.title ?? r.publicText.en?.title ?? r.code;
    const data = {
      title, kind: r.kind as never, mustStop: r.mustStop as never, appliesTo: r.appliesTo ?? null, publicText: publicOnly(r.publicText) as Prisma.InputJsonValue,
      manualText: r.manualText as Prisma.InputJsonValue, source: r.source as Prisma.InputJsonValue, internalNotes: r.internalNotes ?? null, commonParts: r.commonParts ?? null,
      status: "REVIEW" as const, origin: "IMPORT", importId: imp.id,
      searchText: internalSearch({ code: r.code, title, appliesTo: r.appliesTo, publicText: r.publicText, manualText: r.manualText, internalNotes: r.internalNotes, commonParts: r.commonParts }),
    };
    if (r.action === "update") {
      await prisma.faultCode.updateMany({ where: { seriesId: sid, modelId: null, code: { equals: r.code, mode: "insensitive" }, status: { not: "APPROVED" } }, data });
      counts.updated++;
    } else { await prisma.faultCode.create({ data: { seriesId: sid, code: r.code, ...data } }); counts.created++; }
  }
  await prisma.faultCodeImport.update({ where: { id: imp.id }, data: { counts: counts as Prisma.InputJsonValue } });
  await audit(me.id, "FAULT_CODES_IMPORTED", input.fileName, counts);
  return { preview, importId: imp.id, counts };
}

// ───────────────────────── publish ─────────────────────────

/** MD only: copy every approved + public code (of an active, publicly visible series and brand) into the published table. */
export async function publishKnowledge(actorCode: string) {
  const me = await actor(actorCode);
  need(canPublish(me.role), "FORBIDDEN");
  const codes = await prisma.faultCode.findMany({
    where: { status: "APPROVED", isPublic: true, series: { active: true, publicVisible: true, brand: { active: true } } },
    include: { series: { include: { brand: true, category: true } } },
  });
  const before = await prisma.publishedFaultCode.findMany({ select: { faultCodeId: true, version: true } });
  const now = new Date();
  // older data may hold the same code twice in a series (a model-level copy, an old duplicate): one public page per
  // address — the series-level entry first, then the newest
  const seen = new Set<string>();
  codes.sort((a, b) => Number(!!a.modelId) - Number(!!b.modelId) || b.updatedAt.getTime() - a.updatedAt.getTime());
  codes.splice(0, codes.length, ...codes.filter((c) => { const k = `${c.seriesId}|${codeKey(c.code)}`; if (seen.has(k)) return false; seen.add(k); return true; }));
  let added = 0, updated = 0, gone: string[] = [];
  await prisma.$transaction(async (tx) => {
    for (const c of codes) {
      const brandSlug = c.series.brand.slug ?? slugify(c.series.brand.name), seriesSlug = c.series.slug ?? slugify(c.series.name);
      const content = publicOnly(c.publicText as PublicText);
      const src = c.source as Source | null;
      const data = {
        brandSlug, brandName: c.series.brand.name, seriesSlug, seriesName: c.series.name, category: c.series.category?.nameEn ?? null, code: c.code, codeKey: codeKey(c.code),
        kind: c.kind, mustStop: c.mustStop, appliesTo: c.appliesTo, content: content as Prisma.InputJsonValue,
        // the manual reference goes out without our local file path or checksum
        source: src ? ({ title: src.title, docId: src.docId, revision: src.revision, date: src.date, page: src.page, url: src.url } as Prisma.InputJsonValue) : undefined,
        related: c.related, searchText: publicSearchText(c.code, c.series.brand.name, c.series.name, content), version: c.version, publishedAt: now,
      };
      const was = before.find((b) => b.faultCodeId === c.id);
      if (!was) added++; else if (was.version !== c.version) updated++;
      await tx.publishedFaultCode.upsert({ where: { faultCodeId: c.id }, create: { faultCodeId: c.id, ...data }, update: data });
    }
    const keep = new Set([...codes.map((c) => c.id), ...(await stillLive())]);
    gone = before.filter((b) => !keep.has(b.faultCodeId)).map((b) => b.faultCodeId);
    if (gone.length) await tx.publishedFaultCode.deleteMany({ where: { faultCodeId: { in: gone } } });
    await tx.publishRun.create({ data: { actorId: me.id, added, updated, removed: gone.length } });
  });
  await audit(me.id, "KNOWLEDGE_PUBLISHED", `${codes.length} codes`, { added, updated });
  return { added, updated, removed: gone.length, total: codes.length };
}

const VISIBLE = { active: true, publicVisible: true, brand: { active: true } } as const;
/** Published codes whose public words are being re-reviewed: the last approved version stays online until the new one is approved. */
async function stillLive(): Promise<string[]> {
  return (await prisma.faultCode.findMany({ where: { status: "REVIEW", isPublic: true, published: { isNot: null }, series: VISIBLE }, select: { id: true } })).map((c) => c.id);
}

/** How many changes the next publish would make: new or re-versioned public codes, and codes to take down. */
export async function publishPending(): Promise<number> {
  const [live, published] = await Promise.all([
    prisma.faultCode.findMany({ where: { status: "APPROVED", isPublic: true, series: { active: true, publicVisible: true, brand: { active: true } } }, select: { id: true, version: true, published: { select: { version: true } } } }),
    prisma.publishedFaultCode.findMany({ select: { faultCodeId: true } }),
  ]);
  const keep = new Set([...live.map((c) => c.id), ...(await stillLive())]);
  return live.filter((c) => !c.published || c.published.version !== c.version).length + published.filter((p) => !keep.has(p.faultCodeId)).length;
}

export async function publishRuns() {
  return prisma.publishRun.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { actor: { select: { name: true } } } });
}

// ───────────────────────── public queries (PublishedFaultCode only) ─────────────────────────

export async function publicBrands() {
  const rows = await prisma.publishedFaultCode.groupBy({ by: ["brandSlug", "brandName"], _count: { _all: true }, orderBy: { brandName: "asc" } });
  return rows.map((r) => ({ slug: r.brandSlug, name: r.brandName, codes: r._count._all }));
}
export async function publicSeries(brandSlug: string) {
  const rows = await prisma.publishedFaultCode.groupBy({ by: ["seriesSlug", "seriesName", "category"], where: { brandSlug }, _count: { _all: true }, orderBy: { seriesName: "asc" } });
  return rows.map((r) => ({ slug: r.seriesSlug, name: r.seriesName, category: r.category, codes: r._count._all }));
}

type Pub = Awaited<ReturnType<typeof prisma.publishedFaultCode.findFirst>>;
export function publicView(p: NonNullable<Pub>, lang: string) {
  const text = pickLang(p.content as PublicText, lang);
  return {
    brand: p.brandName, brandSlug: p.brandSlug, series: p.seriesName, seriesSlug: p.seriesSlug, code: p.code, kind: p.kind, mustStop: p.mustStop, appliesTo: p.appliesTo,
    lang: text?.lang ?? null, others: text?.others ?? [], title: text?.title ?? p.code, meaning: text?.meaning ?? null, causes: text?.causes ?? [], checks: text?.checks ?? [],
    remedy: text?.remedy ?? null, safety: text?.safety ?? null, prepare: text?.prepare ?? null, source: p.source, related: p.related, publishedAt: p.publishedAt.toISOString().slice(0, 10),
  };
}
export async function publicCodes(brandSlug: string, seriesSlug: string, opts: { kind?: string; page?: number; lang: string }) {
  const where = { brandSlug, seriesSlug, ...(opts.kind ? { kind: opts.kind as never } : {}) };
  const page = Math.max(1, opts.page ?? 1);
  const [rows, total] = await Promise.all([prisma.publishedFaultCode.findMany({ where, orderBy: { code: "asc" }, take: 50, skip: (page - 1) * 50 }), prisma.publishedFaultCode.count({ where })]);
  return { total, page, pageSize: 50, items: rows.map((r) => { const v = publicView(r, opts.lang); return { code: v.code, kind: v.kind, title: v.title, lang: v.lang }; }) };
}
export async function publicCode(brandSlug: string, seriesSlug: string, code: string, lang: string) {
  const p = await prisma.publishedFaultCode.findUnique({ where: { brandSlug_seriesSlug_codeKey: { brandSlug, seriesSlug, codeKey: codeKey(code) } } });
  return p ? publicView(p, lang) : null;
}
export async function publicSearch(q: string, opts: { brand?: string; series?: string; lang: string }) {
  const k = codeKey(q).slice(0, 100);
  if (!k) return { items: [] };
  const rows = await prisma.publishedFaultCode.findMany({ where: { ...(opts.brand ? { brandSlug: opts.brand } : {}), ...(opts.series ? { seriesSlug: opts.series } : {}), OR: [{ codeKey: { endsWith: k } }, { searchText: { contains: k } }] }, take: 200 });
  return { items: rankHits(rows, k).slice(0, 30).map((r) => { const v = publicView(r, opts.lang); return { brand: v.brand, brandSlug: v.brandSlug, series: v.series, seriesSlug: v.seriesSlug, code: v.code, kind: v.kind, title: v.title, lang: v.lang }; }) };
}

export { lines };
