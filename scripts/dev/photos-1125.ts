/**
 * 2026-11-25 照片导入（朱总: 方案 A）: the pictures of the old system's 设备初始档案 and 明细账, as web copies already lying
 * in UPLOADS_DIR under jdy-<data_id>-<o|n|r><i>.jpg (made on the Mac mini by .dev-ops/jdy-photos-web/pack.py; the
 * originals stay with the export). This script only ties them to their records, by the old record's data_id:
 *   - a machine: Asset.configuration.legacy.id = data_id → Asset.photos = [{ url, kind: NAMEPLATE | OVERVIEW, name, source }],
 *     and nameplatePhoto when the machine has none
 *   - a cash-book line: LegacyDoc.legacyId = data_id → LegacyDoc.files
 * Run again at will: it sets the same values. MODE=dry checks only. A file that is not on disk is not tied.
 */
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { UPLOADS_DIR } from "../../src/lib/uploads";

type Rec = { data_id: string; kind: "asset" | "ledger"; uaid: string | null; files: { f: string | null; field: "o" | "n" | "r"; orig: string }[] };
(async () => {
  const mode = process.env.MODE ?? "dry";
  const recs = JSON.parse(await readFile(process.env.FILE ?? ".dev-ops/photos-manifest.json", "utf8")) as Rec[];
  const rows = await prisma.$queryRaw<{ id: string; code: string; lid: string | null; was: string | null; has: boolean }[]>`select id, code, configuration->'legacy'->>'id' as lid, configuration->>'renumberedFrom' as was, "nameplatePhoto" is not null as has from "Asset"`;
  const byLid = new Map(rows.filter((r) => r.lid).map((r) => [r.lid!, r]));
  const docs = new Map((await prisma.legacyDoc.findMany({ where: { kind: "LEDGER" }, select: { id: true, legacyId: true } })).map((d) => [d.legacyId, d.id]));
  const on = async (f: string) => access(path.join(UPLOADS_DIR, f)).then(() => true, () => false);
  let assets = 0, pics = 0, ledger = 0, lpics = 0, absent = 0; const noAsset: string[] = [], noDoc: string[] = [];
  const todoA: { id: string; photos: Prisma.InputJsonValue; nameplate: string | null }[] = [], todoL: { id: string; files: Prisma.InputJsonValue }[] = [];
  for (const r of recs) {
    const files: { url: string; kind: string; name: string; source: string }[] = [];
    for (const f of r.files) { if (!f.f) continue; if (!(await on(f.f))) { absent++; continue; } files.push({ url: `/api/uploads/${f.f}`, kind: f.field === "n" ? "NAMEPLATE" : f.field === "o" ? "OVERVIEW" : "RECEIPT", name: f.orig, source: "JDY" }); }
    if (!files.length) continue;
    if (r.kind === "asset") {
      // the six machines the old system registered after 11-19 came in on 11-23 under a new number, without the old record's id
      const late = r.uaid ? rows.filter((x) => !x.lid && x.was === r.uaid) : [];
      const a = byLid.get(r.data_id) ?? (late.length === 1 ? late[0] : undefined);
      if (!a) { noAsset.push(`${r.uaid ?? ""}(${r.data_id.slice(-6)})`); continue; }
      todoA.push({ id: a.id, photos: files, nameplate: a.has ? null : files.find((f) => f.kind === "NAMEPLATE")?.url ?? null }); assets++; pics += files.length;
    } else {
      const d = docs.get(r.data_id);
      if (!d) { noDoc.push(r.data_id); continue; }
      todoL.push({ id: d, files: files.map(({ url, name }) => ({ url, name })) }); ledger++; lpics += files.length;
    }
  }
  console.log(`machines ${assets} with ${pics} pictures · cash-book lines ${ledger} with ${lpics} · files not on disk ${absent} · records with no machine here ${noAsset.length} ${noAsset.slice(0, 12).join(" ")} · cash-book records not found ${noDoc.length}`);
  if (mode !== "run") { console.log("DRY RUN"); process.exit(0); }
  for (let i = 0; i < todoA.length; i += 200) await prisma.$transaction(todoA.slice(i, i + 200).map((x) => prisma.asset.update({ where: { id: x.id }, data: { photos: x.photos, ...(x.nameplate ? { nameplatePhoto: x.nameplate } : {}) } })));
  for (let i = 0; i < todoL.length; i += 200) await prisma.$transaction(todoL.slice(i, i + 200).map((x) => prisma.legacyDoc.update({ where: { id: x.id }, data: { files: x.files } })));
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  await prisma.auditLog.create({ data: { actorId: md.id, action: "DATA_IMPORTED", target: "LEGACY_PHOTOS", detail: { by: "朱总 2026-11-25 方案 A", machines: assets, pictures: pics, cashBookLines: ledger, receipts: lpics, notOnDisk: absent, noMachine: noAsset.length } } });
  console.log("written"); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
