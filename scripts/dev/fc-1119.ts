/**
 * 2026-11-19 故障代码库导入（朱总 10:59; 16:3x: 只导能对上的）: the codes of fault_codes_os_import_20261119.xlsx whose
 * brand and series exist in the series table — 17,804 after duplicates within a series. They land as 待审核 (REVIEW),
 * origin IMPORT, under one FaultCodeImport, exactly as the 导入 page would file them; nothing is public until approved.
 * Refuses when fault codes already exist. MODE=dry checks only.
 */
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { prisma } from "../../src/lib/db";
import type { Prisma } from "@prisma/client";

type R = { seriesId: string; code: string; title: string; kind: "FAULT" | "WARNING"; mustStop: "YES" | "NO" | "UNVERIFIED"; appliesTo: string | null; publicText: any; manualText: any; source: any; internalNotes: string | null; commonParts: string | null; legacyId: string };
(async () => {
  const mode = process.env.MODE ?? "dry";
  const file = process.env.FILE ?? ".dev-ops/fc-1119.json.gz", raw = await readFile(file);
  const rows = JSON.parse((file.endsWith(".gz") ? gunzipSync(raw) : raw).toString("utf8")) as R[];
  const n = await prisma.faultCode.count();
  if (n && process.env.FORCE !== "1") throw new Error(`fault codes already there: ${n}`);
  const series = new Set((await prisma.series.findMany({ select: { id: true } })).map((s) => s.id));
  const missing = [...new Set(rows.filter((r) => !series.has(r.seriesId)).map((r) => r.seriesId))];
  if (missing.length) throw new Error(`series missing: ${missing.length}`);
  const keys = new Set<string>(); for (const r of rows) { const k = `${r.seriesId}|${r.code.toUpperCase()}`; if (keys.has(k)) throw new Error(`duplicate ${k}`); keys.add(k); }
  console.log(`codes ${rows.length} in ${new Set(rows.map((r) => r.seriesId)).size} series · existing ${n}`);
  if (mode !== "run") { console.log("DRY RUN"); process.exit(0); }
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const imp = await prisma.faultCodeImport.create({ data: { fileName: "fault_codes_os_import_20261119.xlsx", format: "WIDE", actorId: md.id, counts: {} } });
  const search = (r: R) => [r.code, r.title, r.appliesTo, ...Object.values(r.publicText ?? {}).flatMap((e: any) => [e.title, e.meaning, ...(e.causes ?? []), ...(e.checks ?? [])]), r.manualText?.zh?.meaning, r.manualText?.zh?.actions, r.internalNotes, r.commonParts].filter(Boolean).join(" ").toLowerCase().slice(0, 8000);
  const data: Prisma.FaultCodeCreateManyInput[] = rows.map((r) => ({ seriesId: r.seriesId, code: r.code, title: r.title, kind: r.kind, mustStop: r.mustStop, appliesTo: r.appliesTo, publicText: r.publicText, manualText: r.manualText, source: r.source,
    internalNotes: r.internalNotes, commonParts: r.commonParts, status: "REVIEW", origin: "IMPORT", importId: imp.id, searchText: search(r) }));
  for (let i = 0; i < data.length; i += 1000) await prisma.faultCode.createMany({ data: data.slice(i, i + 1000) });
  const counts = { created: data.length, updated: 0, skipped: 0, flagged: 0 };
  await prisma.faultCodeImport.update({ where: { id: imp.id }, data: { counts } });
  await prisma.auditLog.create({ data: { actorId: md.id, action: "FAULT_CODES_IMPORTED", target: "fault_codes_os_import_20261119.xlsx", detail: { ...counts, by: "朱总 2026-11-19 只导能对上的" } } });
  console.log(`done · fault codes ${await prisma.faultCode.count()} · REVIEW ${await prisma.faultCode.count({ where: { status: "REVIEW" } })}`);
  process.exit(0);
})();
