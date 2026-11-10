/**
 * Upload / paste → fields. The model reads images and PDFs; without a key we fall back to text patterns.
 * Drafts only: the page shows what was filled (light blue; orange when uncertain) and a person saves.
 *
 * Error reduction: the model must return a confidence per field and copy codes verbatim; we normalise values,
 * and check verbatim codes against the document's own text (pasted text, text files, and the text layer of
 * PDFs via pdftotext when it is installed) — mismatches are returned as `uncertain` for the person to check.
 */
import { execFile } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { callClaude, complete, json } from "@/server/ai";
import { RECOGNIZE, normalizeFields, normalizeLines, recognizeText, uncertainFields, type RecognizeKind, type RecognizedLine } from "@/lib/recognize";

export interface RecognizeFile { name: string; url: string; mediaType: string; bytes: Buffer }
export interface RecognizeResult { fields: Record<string, string>; lines?: RecognizedLine[]; uncertain?: string[]; lookedUp?: string[]; docKind?: string; rejected?: boolean; notes?: string; usedModel: boolean }

const IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const run = promisify(execFile);

/** Text layer of a PDF (for verification and the offline fallback); empty when pdftotext is missing or the PDF is a scan. */
export async function pdfText(bytes: Buffer): Promise<string> {
  const p = join(tmpdir(), `rec-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await writeFile(p, bytes);
    const { stdout } = await run("pdftotext", ["-layout", p, "-"], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
    return stdout.trim();
  } catch { return ""; }
  finally { await unlink(p).catch(() => {}); }
}

/** What each accepted docKind means, for the model's first decision. */
const DOC_KIND_HINTS: Record<string, string> = {
  DBD: "DBD = หนังสือรับรอง company certificate from the Department of Business Development", PP20: "PP20 = ภ.พ.20 VAT registration", BILLING: "BILLING = the customer's own billing/invoice-to details",
  INQUIRY: "INQUIRY = the customer's request for quotation / inquiry (RFQ form, e-mail, LINE or chat message asking for a price or a repair)", PO: "PO = the customer's purchase order or work order", MESSAGE: "MESSAGE = a fault report or other message without a request for price",
  CV: "CV = résumé / curriculum vitae", PASSPORT: "PASSPORT = passport data page", ID_CARD: "ID_CARD = Thai national ID card", VISA: "VISA = visa sticker or stamp with permitted-to-stay date", WORK_PERMIT: "WORK_PERMIT = Thai work permit booklet or digital permit", CONTRACT: "CONTRACT = labour / employment contract", DEGREE: "DEGREE = diploma or transcript", CERTIFICATE: "CERTIFICATE = professional licence or training certificate",
};

/**
 * Company master data by name, from the public web (DBD DataWarehouse, the company's own site, registries): tax ID,
 * branch, registered address, phone, e-mail. Only what a source states; every value comes back for a person to
 * confirm (the form marks it orange). Returns {} when the web-search tool is unavailable or nothing reliable is found.
 * COMPANY_LOOKUP=off disables it.
 */
export async function lookupCompany(name: string, nameLocal?: string): Promise<Record<string, string>> {
  if (process.env.COMPANY_LOOKUP === "off" || !process.env.ANTHROPIC_API_KEY) return {};
  const res = await callClaude({
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
    system: "You find official registration data of a company for a supplier/customer master record. Search the web (for Thai companies: DBD DataWarehouse, the company's website, creden.co, dataforthai; otherwise the national registry or the company's site). Return only JSON: {\"taxId\": string, \"branchCode\": string, \"addressEn\": string, \"addressLocal\": string, \"phone\": string, \"email\": string, \"sources\": [url]}. Include a field only when a source states it for exactly this legal entity; a Thai tax ID has 13 digits; branchCode 00000 for a head office. Never guess or build a value from a similar company. If you cannot confirm anything, return {}.",
    messages: [{ role: "user", content: `Company: ${name}${nameLocal && nameLocal !== name ? ` (${nameLocal})` : ""}\nFinish with the JSON object only, starting with {"taxId".` }],
  });
  if (!res.ok) { console.warn(`[lookup] ${res.status} ${(await res.text()).slice(0, 300)}`); return {}; }
  const data = (await res.json()) as { stop_reason?: string; content: { type: string; text?: string }[] };
  const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  let r: Record<string, unknown>;
  try { r = json<Record<string, unknown>>(text.slice(text.lastIndexOf("{\"taxId\"") >= 0 ? text.lastIndexOf("{\"taxId\"") : 0)); }
  catch { console.warn(`[lookup] no JSON for ${name} (${data.stop_reason}): ${text.slice(-300)}`); return {}; }
  return Object.fromEntries(Object.entries(r).filter(([k, v]) => k !== "sources" && typeof v === "string" && v.trim()).map(([k, v]) => [k, String(v)]));
}

export async function recognizeDocuments(kind: RecognizeKind, files: RecognizeFile[], text?: string): Promise<RecognizeResult> {
  const spec = RECOGNIZE[kind];
  const textFiles = files.filter((f) => f.mediaType.startsWith("text/") || /\.(txt|csv|eml)$/i.test(f.name)).map((f) => f.bytes.toString("utf8"));
  const pdfTexts = await Promise.all(files.filter((f) => f.mediaType === "application/pdf").map((f) => pdfText(f.bytes)));
  const plain = [text ?? "", ...textFiles].join("\n").trim();
  const docText = [plain, ...pdfTexts].join("\n").trim(); // what we can verify codes against
  const visual = files.filter((f) => IMAGE.includes(f.mediaType) || f.mediaType === "application/pdf");

  if (process.env.ANTHROPIC_API_KEY && (visual.length || plain)) {
    const content: unknown[] = visual.map((f) => f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.bytes.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.bytes.toString("base64") } });
    if (plain) content.push({ type: "text", text: plain.slice(0, 20000) });
    content.push({ type: "text", text: "Extract the fields." });
    const accept = spec.accept
      ? `First decide docKind, one of ${spec.accept.join(", ")} or OTHER (${spec.accept.map((k) => DOC_KIND_HINTS[k]).filter(Boolean).join("; ")}). ${spec.strict ? "If OTHER, return empty fields." : "Extract the fields whatever the docKind is — the person chose to upload this document here."}`
      : "docKind: a short label for what the document is.";
    const linesSpec = spec.lines ? `, "lines": [{${Object.entries(spec.lines).map(([k, d]) => `"${k}": ${JSON.stringify(d)}`).join(", ")}}] (one object per printed line item, in order; omit the key when the document has no line items)` : "";
    const out = await complete(
      `You read documents for an industrial field-service system (VFDs, motors, PLCs) in Thailand. ${accept} Return only JSON: {"docKind": string, "fields": {${Object.entries(spec.fields).map(([k, d]) => `"${k}": ${JSON.stringify(d)}`).join(", ")}}, "confidence": {<field>: 0..1 for every field you filled}${linesSpec}, "notes": string}. Rules: copy codes, part numbers, serial numbers, document numbers and names exactly as printed, character for character — never reconstruct a code you cannot read fully (leave it out and say so in notes). Dates as YYYY-MM-DD (convert Thai Buddhist years by subtracting 543). Numbers without thousands separators or currency symbols. Leave a field out when it is not in the document — never guess. Confidence below 0.8 means a person must check that field.`,
      [{ role: "user", content }], 2500,
    );
    const r = json<{ docKind?: string; fields?: Record<string, unknown>; confidence?: Record<string, number>; lines?: unknown; notes?: string }>(out);
    const raw = Object.fromEntries(Object.entries(r.fields ?? {}).filter(([k, v]) => k in spec.fields && v != null && String(v).trim() !== "").map(([k, v]) => [k, String(v)]));
    const fields = normalizeFields(raw);
    const lines = normalizeLines(spec, r.lines);
    const rejected = !!spec.strict && !!spec.accept && !spec.accept.includes(String(r.docKind ?? "").toUpperCase());
    const uncertain = rejected ? [] : uncertainFields(fields, r.confidence, docText || undefined);
    // 朱总 2026-11-10: a company form is completed from the name on the paper — what the document does not print
    // (tax ID, registered address, phone) is looked up on the web and filled orange, for a person to confirm.
    let looked: string[] = [];
    if (!rejected && kind === "entity" && (fields.nameEn || fields.nameLocal)) {
      const found = await lookupCompany(fields.nameEn ?? fields.nameLocal, fields.nameLocal).catch(() => ({} as Record<string, string>));
      for (const [k, v] of Object.entries(normalizeFields(found))) if (k in spec.fields && !fields[k]) { fields[k] = v; looked.push(k); }
    }
    return { fields: rejected ? {} : fields, lines: rejected ? [] : lines, uncertain: [...new Set([...uncertain, ...looked])], lookedUp: looked, docKind: r.docKind, rejected, notes: r.notes, usedModel: true };
  }

  const r = recognizeText(kind, docText);
  const rejected = !!spec.strict && !!spec.accept && docText.length > 0 && !r.docKind;
  // Without a model (no ANTHROPIC_API_KEY) only the text rules ran: say so, so nobody trusts a half-read document.
  return { fields: rejected ? {} : r.fields, uncertain: [], docKind: r.docKind, rejected, usedModel: false, notes: process.env.ANTHROPIC_API_KEY ? undefined : "no-model" };
}
