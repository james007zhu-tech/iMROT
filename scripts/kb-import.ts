/**
 * Fault-code import without the web page — for Grok working offline (朱总 2026-11-10).
 * Grok writes wide tables (docs/knowledge/fault-code-writing-guide.md) into .dev-ops/kb-inbox/ on the Mac mini and
 * drops a trigger file; the dev container runs this script:
 *   .dev-ops/kb-check   → check only, report in .dev-ops/kb-check.out (nothing written)
 *   .dev-ops/kb-import  → import, report in .dev-ops/kb-import.out; imported files move to kb-inbox/done/
 * By hand:  npx tsx scripts/kb-import.ts <file-or-folder> [--commit] [--actor ETH…] [--category VFD]
 * Imported codes land as 待审核 like every import (rule 32): somebody approves them in /fault-codes before they can
 * be public. Rows with a blocking issue are not imported; the report says which and why, so the file can be fixed.
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { importFaultCodes } from "../src/server/knowledge";
import { isBlocking } from "../src/lib/knowledge";
import { readZip } from "../src/lib/docx/zip";
import zh from "../messages/zh.json";

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const commit = args.includes("--commit");
const targets = args.filter((a, i) => !a.startsWith("--") && !["--actor", "--category"].includes(args[i - 1] ?? ""));
const label = (code: string) => (zh.ui as Record<string, string>)[`kbIssue_${code}`] ?? code;

function files(p: string): string[] {
  if (!statSync(p).isDirectory()) return [p];
  return readdirSync(p).filter((f) => /\.(csv|json|zip)$/i.test(f)).sort().map((f) => path.join(p, f));
}
function textOf(file: string): { name: string; text: string } {
  const buf = readFileSync(file);
  if (!/\.zip$/i.test(file)) return { name: path.basename(file), text: buf.toString("utf8") };
  const entries = readZip(buf);
  const pick = entries.find((e) => /\.csv$/i.test(e.name)) ?? entries.find((e) => /\.json$/i.test(e.name));
  if (!pick) throw new Error("IMPORT_FORMAT: no .csv or .json in the zip");
  return { name: path.basename(pick.name), text: pick.data.toString("utf8") };
}

async function main() {
  if (!targets.length) { console.log("usage: npx tsx scripts/kb-import.ts <file-or-folder> [--commit] [--actor ETH…] [--category VFD]"); process.exit(2); }
  const actor = flag("--actor") ?? process.env.KB_IMPORT_ACTOR ?? (await prisma.employee.findFirst({ where: { role: "MD", active: true }, orderBy: { code: "asc" } }))?.code;
  if (!actor) throw new Error("no MD employee to import as; pass --actor");
  const all = targets.flatMap(files);
  console.log(`${commit ? "IMPORT" : "CHECK"} ${new Date().toISOString()} · ${all.length} file(s) · as ${actor}\n`);
  let blocking = 0;
  for (const file of all) {
    const { name, text } = textOf(file);
    const r = await importFaultCodes({ fileName: name, text, actorCode: actor, dryRun: !commit, createMissing: true, categoryCode: flag("--category") ?? "VFD" });
    const rows = r.preview.rows;
    const n = (a: string) => rows.filter((x) => x.action === a).length;
    console.log(`■ ${path.basename(file)}  [${r.preview.format}]  ${rows.length} rows · create ${n("create")} · update ${n("update")} · skip ${n("skip")}`);
    if (r.preview.missing.length) console.log(`  new brand/series: ${r.preview.missing.map((m) => `${m.brand ?? ""} ${m.series ?? ""}`.trim()).join(", ")}`);
    const byCode = new Map<string, { rows: string[]; where: Set<string> }>();
    for (const row of rows) for (const i of row.issues) {
      const [code, where] = i.split(":");
      const g = byCode.get(code) ?? { rows: [], where: new Set() };
      g.rows.push(row.code); if (where) g.where.add(where); byCode.set(code, g);
    }
    for (const [code, g] of [...byCode].sort((a, b) => Number(isBlocking(b[0])) - Number(isBlocking(a[0])))) {
      const block = isBlocking(code);
      if (block) blocking += g.rows.length;
      console.log(`  ${block ? "✗ BLOCKING" : "· note    "} ${code} ×${g.rows.length} — ${label(code)}${g.where.size ? ` (${[...g.where].slice(0, 8).join(", ")})` : ""}`);
      if (code !== "MUST_STOP_UNVERIFIED") console.log(`      codes: ${g.rows.slice(0, 30).join(", ")}${g.rows.length > 30 ? ` … +${g.rows.length - 30}` : ""}`);
    }
    if (commit) {
      const done = path.join(path.dirname(file), "done");
      mkdirSync(done, { recursive: true });
      renameSync(file, path.join(done, `${new Date().toISOString().replace(/[:.]/g, "-")}-${path.basename(file)}`));
      console.log(`  imported as 待审核 (import ${r.importId}); file moved to done/`);
    }
    console.log("");
  }
  console.log(blocking ? `${blocking} row(s) blocked — fix them and check again` : "no blocking issues");
  process.exit(blocking && !commit ? 1 : 0);
}

main().catch((e) => { console.error(`FAILED: ${(e as Error).message}`); process.exit(1); });
