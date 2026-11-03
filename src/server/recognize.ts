/**
 * Upload / paste → fields. The model reads images and PDFs; without a key we fall back to text patterns.
 * Drafts only: the page shows what was filled (light blue) and a person saves.
 */
import { complete, json } from "@/server/ai";
import { RECOGNIZE, recognizeText, type RecognizeKind } from "@/lib/recognize";

export interface RecognizeFile { name: string; url: string; mediaType: string; bytes: Buffer }
export interface RecognizeResult { fields: Record<string, string>; docKind?: string; rejected?: boolean; notes?: string; usedModel: boolean }

const IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export async function recognizeDocuments(kind: RecognizeKind, files: RecognizeFile[], text?: string): Promise<RecognizeResult> {
  const spec = RECOGNIZE[kind];
  const plain = [text ?? "", ...files.filter((f) => f.mediaType.startsWith("text/") || /\.(txt|csv|eml)$/i.test(f.name)).map((f) => f.bytes.toString("utf8"))].join("\n").trim();
  const visual = files.filter((f) => IMAGE.includes(f.mediaType) || f.mediaType === "application/pdf");

  if (process.env.ANTHROPIC_API_KEY && (visual.length || plain)) {
    const content: unknown[] = visual.map((f) => f.mediaType === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.bytes.toString("base64") } }
      : { type: "image", source: { type: "base64", media_type: f.mediaType, data: f.bytes.toString("base64") } });
    if (plain) content.push({ type: "text", text: plain.slice(0, 20000) });
    content.push({ type: "text", text: "Extract the fields." });
    const accept = spec.accept ? `First decide docKind, one of ${spec.accept.join(", ")} or OTHER (DBD = หนังสือรับรอง company certificate from the Department of Business Development; PP20 = ภ.พ.20 VAT registration; BILLING = the customer's own billing/invoice-to details). If OTHER, return empty fields.` : "docKind: a short label for what the document is.";
    const out = await complete(
      `You read documents for an industrial field-service system (VFDs, motors, PLCs) in Thailand. ${accept} Return only JSON: {"docKind": string, "fields": {${Object.entries(spec.fields).map(([k, d]) => `"${k}": ${JSON.stringify(d)}`).join(", ")}}, "notes": string}. Copy codes, numbers and names exactly as printed. Leave a field out when it is not in the document — never guess.`,
      [{ role: "user", content }], 1200,
    );
    const r = json<{ docKind?: string; fields?: Record<string, unknown>; notes?: string }>(out);
    const fields = Object.fromEntries(Object.entries(r.fields ?? {}).filter(([k, v]) => k in spec.fields && v != null && String(v).trim() !== "").map(([k, v]) => [k, String(v)]));
    const rejected = !!spec.accept && !spec.accept.includes(String(r.docKind ?? "").toUpperCase());
    return { fields: rejected ? {} : fields, docKind: r.docKind, rejected, notes: r.notes, usedModel: true };
  }

  const r = recognizeText(kind, plain);
  const rejected = !!spec.accept && plain.length > 0 && !r.docKind;
  return { fields: rejected ? {} : r.fields, docKind: r.docKind, rejected, usedModel: false, notes: visual.length && !plain ? "no-model" : undefined };
}
