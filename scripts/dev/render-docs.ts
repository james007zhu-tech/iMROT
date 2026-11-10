/** Render documents to PDF for a visual check: npx tsx scripts/dev/render-docs.ts <no>[:template] … */
import { renderDocument } from "../../src/server/reports";
(async () => {
  for (const a of process.argv.slice(2)) {
    const [no, tpl] = a.split(":");
    const r = await renderDocument(no, tpl);
    console.log(no, tpl ?? "", JSON.stringify(Object.fromEntries(Object.entries(r).filter(([, v]) => typeof v === "string" || Array.isArray(v)))).slice(0, 300));
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
