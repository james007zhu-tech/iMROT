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
export function publicSearchText(code: string, brand: string, series: string, content: PublicText, keywords: string[] = []): string {
  return searchTextOf([code, brand, series, keywords, ...LANGS.flatMap((l) => { const e = content[l]; return e ? [e.title, e.meaning, e.causes, e.checks, e.remedy] : []; })]);
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

// ───────────────────────── wide table (Grok's offline format, 2026-11-10) ─────────────────────────

/**
 * One row per code, every language in its own column (docs/knowledge/fault-code-writing-guide.md). Lists (causes,
 * checks, prepare, related, keywords) are items separated by " | ". The order here is the order of the template.
 */
export const WIDE_COLUMNS = [
  "brand", "series", "code", "kind", "must_stop", "applies_to", "related", "keywords",
  ...(["title", "meaning", "causes", "checks", "remedy", "safety", "prepare"] as const).flatMap((f) => LANGS.map((l) => `${f}_${l}`)),
  "manual_meaning_en", "manual_actions_en", "manual_meaning_zh", "manual_actions_zh", "manual_meaning_th", "manual_actions_th",
  "source_title", "source_doc_id", "source_revision", "source_date", "source_page", "source_url", "source_sha256",
  "internal_notes", "common_parts", "check_status",
] as const;
export const REQUIRED_WIDE = ["brand", "series", "code", "kind", "title_zh", "title_en", "title_th"] as const;
export const splitList = (s: string | null | undefined) => (s ?? "").split("|").map((x) => x.trim()).filter(Boolean);

/** Issues that keep a row out of the import; everything else is reported and imported for review. */
export const BLOCKING_ISSUES = ["NO_CODE", "NO_TITLE", "COPIED_FROM_MANUAL", "WRONG_LANG", "DUPLICATE_IN_FILE"] as const;

const HAS = { zh: /[\u4e00-\u9fff]/, th: /[\u0e00-\u0e7f]/ };
const LIMITS = { title: { zh: 16, en: 50, th: 50 }, meaning: { zh: 80, en: 260, th: 260 }, item: { zh: 40, en: 140, th: 140 } } as const;

/** Long runs shared with the manufacturer's text: 8 words in English, 16 characters in Chinese or Thai. */
export function copiedFrom(ours: string, theirs: string, lang: Lang): boolean {
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const a = norm(ours), b = norm(theirs);
  if (!a || !b) return false;
  if (lang === "en") {
    const w = a.split(" "), set = new Set<string>(), bw = b.split(" ");
    for (let i = 0; i + 8 <= bw.length; i++) set.add(bw.slice(i, i + 8).join(" "));
    for (let i = 0; i + 8 <= w.length; i++) if (set.has(w.slice(i, i + 8).join(" "))) return true;
    return false;
  }
  const A = a.replace(/[\s，。；、,.;:：()（）]/g, ""), B = b.replace(/[\s，。；、,.;:：()（）]/g, "");
  for (let i = 0; i + 16 <= A.length; i++) if (B.includes(A.slice(i, i + 16))) return true;
  return false;
}

/**
 * The wording rules of the guide, checked mechanically. Codes: NO_TITLE, MISSING_LANG:th, TITLE_TOO_LONG:en,
 * TITLE_HAS_CODE:zh, TOO_LONG:zh.meaning, PAGE_REF:zh.remedy, MANUAL_WORDS:zh.meaning, CONTACT_VENDOR:en.checks,
 * CIRCLED_NUMBERS:zh.prepare, WRONG_LANG:th.title, COPIED_FROM_MANUAL:en.checks, LIST_SIZE:zh.causes,
 * LIST_MISMATCH:checks, SAFETY_MISSING.
 */
export function wordingIssues(r: { code: string; kind: string; publicText: PublicText; manualText?: ManualText | null }): string[] {
  const out = new Set<string>();
  const pub = r.publicText ?? {};
  if (!LANGS.some((l) => pub[l]?.title?.trim())) out.add("NO_TITLE");
  for (const l of LANGS) {
    const e = pub[l];
    if (!e?.title?.trim()) { out.add(`MISSING_LANG:${l}`); continue; }
    if (e.title.length > LIMITS.title[l]) out.add(`TITLE_TOO_LONG:${l}`);
    if (r.code && e.title.toLowerCase().includes(r.code.toLowerCase())) out.add(`TITLE_HAS_CODE:${l}`);
    if (e.meaning && e.meaning.length > LIMITS.meaning[l]) out.add(`TOO_LONG:${l}.meaning`);
    const fields: [string, string][] = [["title", e.title], ["meaning", e.meaning ?? ""], ["causes", (e.causes ?? []).join("\n")], ["checks", (e.checks ?? []).join("\n")], ["remedy", e.remedy ?? ""], ["safety", e.safety ?? ""], ["prepare", e.prepare ?? ""]];
    for (const [f, v] of fields) {
      if (!v) continue;
      if (/PDF\s*\d|第\s*\d+\s*页|\bp(?:age|\.)\s*\d|หน้า\s*\d/i.test(v)) out.add(`PAGE_REF:${l}.${f}`);
      if (/原文|手册(?:原因|措施)|manual (?:says|text)|according to the manual/i.test(v)) out.add(`MANUAL_WORDS:${l}.${f}`);
      if (/contact (?:your )?(?:local )?(?:\w+ )?(?:representative|service)|联系.{0,8}(?:原厂|代表|代理)|ติดต่อตัวแทน/i.test(v)) out.add(`CONTACT_VENDOR:${l}.${f}`);
      if (/[①-⑳]/.test(v)) out.add(`CIRCLED_NUMBERS:${l}.${f}`);
      // Thai or Chinese script in the wrong column; English may carry neither (codes and units are Latin anyway)
      if ((l === "zh" && HAS.th.test(v)) || (l === "th" && HAS.zh.test(v)) || (l === "en" && (HAS.zh.test(v) || HAS.th.test(v)))) out.add(`WRONG_LANG:${l}.${f}`);
      const theirs = r.manualText ? LANGS.map((m) => `${r.manualText?.[m]?.meaning ?? ""}\n${r.manualText?.[m]?.actions ?? ""}`).join("\n") : "";
      if (f !== "title" && theirs && copiedFrom(v, theirs, l)) out.add(`COPIED_FROM_MANUAL:${l}.${f}`);
    }
    for (const f of ["causes", "checks"] as const) {
      const n = e[f]?.length ?? 0;
      if (n > (f === "causes" ? 6 : 8)) out.add(`LIST_SIZE:${l}.${f}`);
      if ((e[f] ?? []).some((x) => x.length > LIMITS.item[l])) out.add(`TOO_LONG:${l}.${f}`);
    }
  }
  for (const f of ["causes", "checks"] as const) {
    const sizes = new Set(LANGS.filter((l) => pub[l]?.title).map((l) => pub[l]?.[f]?.length ?? 0));
    if (sizes.size > 1) out.add(`LIST_MISMATCH:${f}`);
  }
  // opening covers or measuring needs the safety line
  const checks = LANGS.flatMap((l) => pub[l]?.checks ?? []).join(" ");
  if (/断电|拆|测量|绝缘|disconnect|insulation|measure|power off|ตัดไฟ|วัด/i.test(checks) && !LANGS.some((l) => pub[l]?.safety?.trim())) out.add("SAFETY_MISSING");
  return [...out];
}
export const isBlocking = (issue: string) => (BLOCKING_ISSUES as readonly string[]).includes(issue.split(":")[0]);

export const lines = (s: string | null | undefined) => (s ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
