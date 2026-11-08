/**
 * Fill [[FIELD]] placeholders in a DCiT Word template (document, headers, footers).
 * A field may appear several times (e.g. [[APPROVED_CRITERION]] once per test row): pass an array and
 * occurrences are consumed in document order; a string is used for every occurrence.
 * Unfilled placeholders are replaced by an empty string — a template must never reach a customer with [[…]] showing.
 * Line breaks in a value become <w:br/>.
 */
import { readZip, writeZip } from "./zip";

export type FieldValues = Record<string, string | number | null | undefined | (string | number | null | undefined)[]>;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Turn a value into the XML that goes inside <w:t>…</w:t>, closing/reopening the run text for line breaks. */
function toXml(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v).split(/\r?\n/).map(esc).join("</w:t><w:br/><w:t xml:space=\"preserve\">");
}

/**
 * Repeating rows: a table row whose placeholders start with `L_` (line fields, e.g. [[L_DESC]] [[L_QTY]]) is a
 * template row. It is copied once per line — the longest array among its `L_` keys decides the count — and each
 * copy's placeholders are bound to that line's index; with no lines the row disappears. Rows without `L_` keys are
 * untouched, so the older fixed-row templates (APPROVED_CRITERION × 4) keep their behaviour.
 */
export function expandRows(xml: string, values: FieldValues): string {
  return xml.replace(/<w:tr\b[^>]*>[\s\S]*?<\/w:tr>/g, (row) => {
    const keys = [...new Set([...row.matchAll(/\[\[(L_[A-Z0-9_]+)\]\]/g)].map((m) => m[1]))];
    if (!keys.length) return row;
    const n = Math.max(0, ...keys.map((k) => { const v = values[k]; return Array.isArray(v) ? v.length : v == null ? 0 : 1; }));
    return Array.from({ length: n }, (_, i) => row.replace(/\[\[(L_[A-Z0-9_]+)\]\]/g, (_, k: string) => `[[${k}@${i}]]`)).join("");
  });
}

export function fillXml(xml: string, values: FieldValues): { xml: string; unfilled: string[] } {
  const counters = new Map<string, number>();
  const unfilled = new Set<string>();
  for (const m of xml.matchAll(/\[\[(L_[A-Z0-9_]+)\]\]/g)) if (values[m[1]] === undefined) unfilled.add(m[1]); // rows without lines vanish, but the missing keys are still reported
  const out = expandRows(xml, values).replace(/\[\[([A-Z0-9_]+)(?:@(\d+))?\]\]/g, (_, key: string, idx?: string) => {
    const v = values[key];
    if (v === undefined) { unfilled.add(key); return ""; }
    if (idx !== undefined) return toXml(Array.isArray(v) ? v[Number(idx)] : v);
    if (Array.isArray(v)) {
      const i = counters.get(key) ?? 0;
      counters.set(key, i + 1);
      return toXml(v[i]);
    }
    return toXml(v);
  });
  return { xml: out, unfilled: [...unfilled] };
}

/** Fill a .docx buffer. Returns the new buffer and the placeholders that had no value. */
export function fillDocx(template: Buffer, values: FieldValues): { docx: Buffer; unfilled: string[] } {
  const entries = readZip(template);
  const unfilled = new Set<string>();
  for (const e of entries) {
    if (/^word\/(document|header\d*|footer\d*)\.xml$/.test(e.name)) {
      const r = fillXml(e.data.toString("utf8"), values);
      r.unfilled.forEach((k) => unfilled.add(k));
      e.data = Buffer.from(r.xml, "utf8");
    }
  }
  return { docx: writeZip(entries), unfilled: [...unfilled] };
}

/** Every placeholder key a template uses, in order of first appearance (for building field maps). */
export function listPlaceholders(template: Buffer): string[] {
  const seen: string[] = [];
  for (const e of readZip(template)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(e.name)) continue;
    for (const m of e.data.toString("utf8").matchAll(/\[\[([A-Z0-9_]+)\]\]/g)) if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}
