/**
 * Equipment knowledge: product series dictionary + per-series fault-code library with a public read-only query
 * (朱总 2026-11-09/10; architecture doc "设备知识库架构方案", mockup docs/mockups/equipment-knowledge-v0.1.html).
 * Pure rules shared by the services, the pages, the public API and the tests.
 *
 *  - publicText = OUR words per language; it is the only content that can be published.
 *  - manualText = the manufacturer's text and its translations: internal reference, never published (copyright).
 *  - internal fields (notes, common parts, cases, reviewer) never leave DCiT OS.
 *  - a code goes DRAFT → REVIEW → APPROVED; only APPROVED codes can be made public; editing the public text of an
 *    approved code sends it back to REVIEW; "publish" copies approved + public codes into the published table.
 */
export const LANGS = ["zh", "en", "th"] as const;
export type Lang = (typeof LANGS)[number];
/** When the asked language has no title: English, then Thai, then Chinese (doc §对外查询接口). */
export const FALLBACK: readonly Lang[] = ["en", "th", "zh"];

export type PublicEntry = { title?: string; meaning?: string; causes?: string[]; checks?: string[]; remedy?: string; safety?: string; prepare?: string };
export type PublicText = Partial<Record<Lang, PublicEntry>>;
export type ManualText = Partial<Record<Lang, { meaning?: string; actions?: string }>>;
export type Source = { title?: string; docId?: string; revision?: string; date?: string; page?: number; url?: string; sha256?: string };

export const KINDS = ["FAULT", "WARNING", "EVENT", "INFO"] as const;
export const STATUSES = ["DRAFT", "REVIEW", "APPROVED", "RETIRED"] as const;
export type FaultStatus = (typeof STATUSES)[number];

/** Who may approve codes (the "技术负责人" role does not exist yet) and who may publish. */
export const canApprove = (role: string) => role === "MD" || role === "MANAGER";
export const canPublish = (role: string) => role === "MD";
export const canEditDictionary = (role: string) => role === "MD" || role === "ADMIN";

export function slugify(s: string): string {
  return s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}

export const codeKey = (code: string) => code.trim().toLowerCase();

/** Does the code fit the series' pattern? An empty or broken pattern accepts everything. */
export function codeFits(pattern: string | null | undefined, code: string): boolean {
  if (!pattern) return true;
  try { return new RegExp(pattern, "i").test(code.trim()); } catch { return true; }
}

export function patternError(pattern: string | null | undefined): string | null {
  if (!pattern) return null;
  try { new RegExp(pattern); return null; } catch { return "INVALID_CODE_PATTERN"; }
}

/** "接地漏电（Earth leakage）" → zh "接地漏电", en "Earth leakage". */
export function splitName(name: string): { zh: string; en?: string } {
  const m = name.trim().match(/^(.*?)\s*[（(]([^（）()]*)[）)]\s*$/);
  return m && m[1] ? { zh: m[1].trim(), en: m[2].trim() || undefined } : { zh: name.trim() };
}

/** "…acs880_V.pdf PDF501（印刷页同PDF）" → 501 */
export function pdfPage(s: string | null | undefined): number | undefined {
  const m = (s ?? "").match(/PDF\s*(\d{1,4})/i) ?? (s ?? "").match(/\bp(?:age)?\.?\s*(\d{1,4})\b/i);
  return m ? Number(m[1]) : undefined;
}

/** "ACS880 primary control program Firmware manual 3AUA0000085967 Rev V (2020-08-21)" → parts */
export function manualParts(manual: string): Source {
  const docId = manual.match(/\b(3AUA\d+|[A-Z0-9]{2,}[-0-9A-Z]{6,})\b/)?.[1];
  const revision = manual.match(/\bRev\.?\s*([A-Z0-9.]+)/i)?.[1];
  const date = manual.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  const title = manual.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "").trim();
  return { title, docId, revision, date };
}

/** "ACS880 … Firmware manual 3AUA0000085967 Rev V · 2020-08-21" — the revision only when the title lacks it. */
export function manualLabel(src: Source | null | undefined, withDate = true): string {
  if (!src?.title) return "";
  const rev = src.revision && !new RegExp(`\\bRev\\.?\\s*${src.revision.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(src.title) ? ` · Rev ${src.revision}` : "";
  return `${src.title}${rev}${withDate && src.date ? ` · ${src.date}` : ""}`;
}

/** Grok's ACS880 export: type fault|warning, category_zh 故障|警告|事件警告. */
export function kindFrom(type: string | undefined, category: string | undefined): (typeof KINDS)[number] {
  if (/事件|event/i.test(category ?? "") || /event/i.test(type ?? "")) return "EVENT";
  if (/warn|警告|alarm|报警/i.test(`${type ?? ""} ${category ?? ""}`)) return "WARNING";
  if (/info|提示/i.test(`${type ?? ""} ${category ?? ""}`)) return "INFO";
  return "FAULT";
}

export function mustStopFrom(v: string | undefined): "YES" | "NO" | "UNVERIFIED" {
  const s = (v ?? "").trim().toLowerCase();
  if (["是", "yes", "y", "true", "停机"].includes(s)) return "YES";
  if (["否", "no", "n", "false", "不停机"].includes(s)) return "NO";
  return "UNVERIFIED"; // 待核实 and anything unclear — never shown as "does not stop"
}

/** Editing the public words of an approved code needs a new review; internal edits do not. */
export function statusAfterEdit(status: FaultStatus, publicChanged: boolean): FaultStatus {
  return status === "APPROVED" && publicChanged ? "REVIEW" : status;
}

/** Why a code cannot be made public, or null. */
export function publicBlocker(c: { status: string; publicText: PublicText | null }): string | null {
  if (c.status !== "APPROVED") return "PUBLIC_NEEDS_APPROVED";
  if (!LANGS.some((l) => c.publicText?.[l]?.title?.trim())) return "PUBLIC_NEEDS_TITLE";
  return null;
}

/**
 * The public text for one language, else the first of the fallback order that has a title; null when none has.
 * One language per page — fields are never borrowed from another language (a Chinese remedy under an English title
 * reads as a mistake); `others` lists the other languages written, so the page can link to them.
 */
export function pickLang(content: PublicText | null | undefined, lang: string): ({ lang: Lang; others: Lang[] } & PublicEntry) | null {
  const order = [lang, ...FALLBACK].filter((l, i, a): l is Lang => (LANGS as readonly string[]).includes(l) && a.indexOf(l) === i);
  const written = order.filter((l) => content?.[l]?.title?.trim());
  if (!written.length) return null;
  return { ...content![written[0]]!, lang: written[0], others: written.slice(1) };
}

/** Lower-cased words people search by. Public search text is built from public fields only. */
export function searchTextOf(parts: (string | string[] | undefined | null)[]): string {
  return parts.flat().filter(Boolean).join(" \n").toLowerCase().slice(0, 20000);
}
export function publicSearchText(code: string, brand: string, series: string, content: PublicText): string {
  return searchTextOf([code, brand, series, ...LANGS.flatMap((l) => { const e = content[l]; return e ? [e.title, e.meaning, e.causes, e.checks, e.remedy] : []; })]);
}

/** Only these keys of publicText ever go out — anything else that slipped into the JSON stays home. */
export function publicOnly(t: PublicText | null | undefined): PublicText {
  const out: PublicText = {};
  for (const l of LANGS) {
    const e = t?.[l];
    if (!e) continue;
    const clean: PublicEntry = {};
    for (const k of ["title", "meaning", "remedy", "safety", "prepare"] as const) if (typeof e[k] === "string" && e[k]!.trim()) clean[k] = e[k]!.trim();
    for (const k of ["causes", "checks"] as const) if (Array.isArray(e[k]) && e[k]!.length) clean[k] = e[k]!.map(String).filter((x) => x.trim());
    if (Object.keys(clean).length) out[l] = clean;
  }
  return out;
}

/** Public search order: exact code, then codes ending with the query ("30001" → F30001), then words. */
export function rankHits<T extends { codeKey: string; searchText: string }>(rows: T[], q: string): T[] {
  const k = codeKey(q);
  if (!k) return [];
  const exact = rows.filter((r) => r.codeKey === k);
  const tail = k.length >= 3 ? rows.filter((r) => r.codeKey !== k && r.codeKey.endsWith(k)) : [];
  const words = rows.filter((r) => r.codeKey !== k && !(k.length >= 3 && r.codeKey.endsWith(k)) && r.searchText.includes(k));
  return [...exact, ...tail, ...words];
}

export const lines = (s: string | null | undefined) => (s ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
