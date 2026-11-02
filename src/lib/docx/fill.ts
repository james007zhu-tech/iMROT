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

export function fillXml(xml: string, values: FieldValues): { xml: string; unfilled: string[] } {
  const counters = new Map<string, number>();
  const unfilled = new Set<string>();
  const out = xml.replace(/\[\[([A-Z0-9_]+)\]\]/g, (_, key: string) => {
    const v = values[key];
    if (v === undefined) { unfilled.add(key); return ""; }
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
