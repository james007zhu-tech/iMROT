/**
 * Render the newest TITH / IVTH / RCTH / BLTH through the Word templates (20–23) and check that every placeholder
 * was filled and the PDF has the expected pages (tax invoice and receipt print original + copy).
 *   npx tsx scripts/smoke.ts && npx tsx scripts/dev/probe-finance-docs.ts
 */
import { execFileSync } from "node:child_process";
import { prisma } from "../../src/lib/db";
import { renderDocument } from "../../src/server/reports";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`FINANCE DOCS FAIL: ${m}`); console.log("  ok  " + m); };
const pages = (pdf: string) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [pdf]).toString())?.[1] ?? 0);

async function main() {
  const want: { type: "TI" | "IV" | "RC" | "BL"; pages: number }[] = [{ type: "TI", pages: 2 }, { type: "IV", pages: 1 }, { type: "RC", pages: 2 }, { type: "BL", pages: 1 }];
  for (const w of want) {
    const doc = await prisma.document.findFirst({ where: { type: w.type }, orderBy: { no: "desc" } });
    if (!doc) { console.log(`  --  no ${w.type} document in this database, skipped`); continue; }
    const r = await renderDocument(doc.no);
    assert(r.unfilled.length === 0, `${doc.no}: every placeholder filled${r.unfilled.length ? ` (missing ${r.unfilled.join(", ")})` : ""}`);
    if (r.pdfPath) {
      assert(pages(r.pdfPath) === w.pages, `${doc.no}: PDF has ${w.pages} page(s) → ${r.pdfPath}`);
      const text = execFileSync("pdftotext", ["-layout", r.pdfPath, "-"]).toString();
      assert(!/\[\[/.test(text), `${doc.no}: no [[placeholder]] left in the PDF`);
      assert(text.includes(doc.no), `${doc.no}: number printed`);
      if (w.type === "TI") { assert(/ORIGINAL/.test(text) && /COPY/.test(text), `${doc.no}: original and copy pages`); assert(/บาทถ้วน|สตางค์/.test(text), `${doc.no}: amount in Thai words`); }
      if (w.type === "RC") assert(/ORIGINAL/.test(text) && /COPY/.test(text), `${doc.no}: original and copy pages`);
    } else console.log(`  --  ${doc.no}: LibreOffice not installed here, .docx only`);
  }
  console.log("\nFINANCE DOCS PASSED");
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
