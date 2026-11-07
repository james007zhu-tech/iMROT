/**
 * Run the upload-recognition pipeline over sample documents and print what it would fill, what it marks
 * uncertain, and whether the model or the offline patterns were used.
 *   npx tsx scripts/dev/recognize-samples.ts <kind> <file-or-text> [more files…]
 *   e.g. npx tsx scripts/dev/recognize-samples.ts purchase docs/samples/mitsubishi_FA26101674.pdf
 *        npx tsx scripts/dev/recognize-samples.ts service "PO No: XCGDD2610140001 drive trips F30001"
 * Needs ANTHROPIC_API_KEY in .env for images / scanned PDFs; text and text-layer PDFs work offline too.
 */
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";
import { recognizeDocuments } from "../../src/server/recognize";
import { RECOGNIZE, type RecognizeKind } from "../../src/lib/recognize";

const MEDIA: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain", ".csv": "text/csv", ".eml": "message/rfc822" };

async function main() {
  const [kind, ...rest] = process.argv.slice(2);
  if (!kind || !(kind in RECOGNIZE) || !rest.length) { console.error(`usage: recognize-samples.ts <${Object.keys(RECOGNIZE).join("|")}> <file|text>…`); process.exit(2); }
  const files = [];
  let text = "";
  for (const a of rest) {
    const ext = extname(a).toLowerCase();
    if (ext in MEDIA) files.push({ name: basename(a), url: `file://${a}`, mediaType: MEDIA[ext], bytes: await readFile(a) });
    else text += a + "\n";
  }
  const t0 = Date.now();
  const r = await recognizeDocuments(kind as RecognizeKind, files, text || undefined);
  console.log(`${kind}: ${r.usedModel ? "model" : "offline patterns"} · ${Date.now() - t0} ms · docKind=${r.docKind ?? "-"}${r.rejected ? " · REJECTED" : ""}`);
  for (const [k, v] of Object.entries(r.fields)) console.log(`  ${r.uncertain?.includes(k) ? "?" : " "} ${k.padEnd(18)} ${v}`);
  if (r.lines?.length) { console.log(`  lines (${r.lines.length}):`); for (const l of r.lines) console.log("    " + JSON.stringify(l)); }
  if (r.notes) console.log(`  notes: ${r.notes}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
