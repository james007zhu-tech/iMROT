/**
 * 系列生命周期主表 → the series dictionary. Reads data/series_lifecycle_master_<date>.json (made from the workbook).
 * Idempotent: a series is found by its master number, else by brand + code / name / alias; what people typed into
 * the dictionary (name, code, notes, fault-code rules) is kept — the master list brings the lifecycle, its evidence,
 * the installed base, the category when there was none, and new brands and series.
 *   npx tsx scripts/dev/import-series-master.ts [file] [--dry]
 */
import { readFileSync } from "node:fs";
import { prisma } from "../../src/lib/db";
import { ensureCategories } from "../../src/server/knowledge";
import { slugify } from "../../src/lib/knowledge";

type Row = { no: string; brand: string; brandZh: string | null; category: string | null; series: string; installed: number; status: string; grade: string | null; url: string | null; checked: string | null; dates: string | null; successor: string | null; remark: string | null; reviewed: boolean };
const STATUS: Record<string, "ACTIVE" | "GROWTH" | "DECLINING" | "DISCONTINUED" | "UNVERIFIED"> = { 在售: "ACTIVE", 成长期: "GROWTH", 衰退: "DECLINING", "停售-有替代": "DISCONTINUED", 停产: "DISCONTINUED", 待核实: "UNVERIFIED", 未查: "UNVERIFIED" };
const CATEGORY: Record<string, string> = { 低压变频器: "VFD", 伺服驱动器: "SERVO_DRIVE", "触摸屏/HMI": "HMI", 软起动器: "SOFT_STARTER", 中压变频器: "MV_VFD", 高压变频器: "MV_VFD", 直流调速器: "DC_DRIVE", 步进驱动器: "STEPPER", 其他设备: "OTHER" };
const bare = (s: string) => s.normalize("NFKC").toUpperCase().replace(/[^A-Z0-9฀-鿿]/g, "");
const BRAND_ALIAS: Record<string, string[]> = { "ROCKWELLAB": ["ALLENBRADLEY", "ROCKWELL", "ROCKWELLAUTOMATION", "AB"], "SCHNEIDERELECTRIC": ["SCHNEIDER"], "FUJIELECTRIC": ["FUJI"], "MITSUBISHI": ["MITSUBISHIELECTRIC"], "NIDECCT": ["CONTROLTECHNIQUES", "NIDEC"], "BOSCHREXROTH": ["REXROTH"], "LSELECTRIC": ["LS", "LSIS"] };

(async () => {
  const args = process.argv.slice(2), dry = args.includes("--dry");
  const file = args.find((a) => !a.startsWith("--")) ?? "data/series_lifecycle_master_20261114_v2.json";
  const { rows, asOf } = JSON.parse(readFileSync(file, "utf8")) as { rows: Row[]; asOf: string };
  await ensureCategories();
  const stats = { brandsNew: 0, seriesNew: 0, seriesUpdated: 0, successorsLinked: 0, notes: [] as string[] };

  // ── brands
  const brands = await prisma.brand.findMany();
  const usedCodes = new Set(brands.map((b) => b.code));
  const brandOf = new Map<string, (typeof brands)[number]>();
  let seq = 1;
  for (const name of [...new Set(rows.map((r) => r.brand))]) {
    const key = bare(name), also = [key, ...(BRAND_ALIAS[key] ?? [])];
    let b = brands.find((x) => also.includes(bare(x.name)) || also.includes(bare(x.code)));
    const zh = rows.find((r) => r.brand === name)?.brandZh ?? null;
    if (!b) {
      const latin = name.normalize("NFKD").toUpperCase().replace(/[^A-Z0-9]/g, "");
      let code = latin.slice(0, 3);
      if (code.length < 2) { do code = `B${String(seq++).padStart(2, "0")}`; while (usedCodes.has(code)); }
      for (let i = 2; usedCodes.has(code); i++) code = `${latin.slice(0, 3)}${i}`;
      usedCodes.add(code);
      b = dry ? ({ id: `dry-${code}`, code, name, nameZh: zh } as (typeof brands)[number]) : await prisma.brand.create({ data: { code, name, nameZh: zh && zh !== name ? zh : null, slug: slugify(name) || code.toLowerCase(), sortOrder: 100 } }).catch(async () => prisma.brand.create({ data: { code, name, nameZh: zh && zh !== name ? zh : null, sortOrder: 100 } }));
      stats.brandsNew++;
    } else if (!dry && !b.nameZh && zh && zh !== b.name) await prisma.brand.update({ where: { id: b.id }, data: { nameZh: zh } });
    brandOf.set(name, b);
  }

  // ── series
  const seenNo = new Set<string>();
  const idOf = new Map<Row, string>();
  for (const r of rows) {
    const b = brandOf.get(r.brand)!;
    let no: string | null = r.no;
    if (seenNo.has(r.no)) { stats.notes.push(`${r.no} is used twice in the list — the second (${r.brand} ${r.series}) is filed without a master number`); no = null; }
    seenNo.add(r.no);
    const cats = (r.category ?? "").replace(/（.*$/, "").split("/").map((c) => c.trim()).filter(Boolean);
    const conflict = /冲突/.test(r.category ?? "");
    const categoryCode = r.category === "触摸屏/HMI" ? "HMI" : CATEGORY[cats[0]] ?? null;
    const lifecycle = STATUS[r.status];
    if (!lifecycle) { stats.notes.push(`${r.no} ${r.series}: unknown status ${r.status} — skipped`); continue; }
    const remark = [r.status === "停售-有替代" || r.status === "停产" ? `主表状态：${r.status}` : null, conflict ? `类别待核：${r.category}` : null, r.remark, r.reviewed ? null : `本轮（${asOf}）未复核`].filter(Boolean).join("；") || null;
    const facts = { lifecycle, installedBase: r.installed || null, lifecycleGrade: r.grade, lifecycleUrl: r.url, lifecycleCheckedAt: r.checked ? new Date(r.checked) : null, lifecycleDates: r.dates, successorNote: r.successor, lifecycleRemark: remark };
    const mine = dry && b.id.startsWith("dry-") ? [] : await prisma.series.findMany({ where: { brandId: b.id } });
    const k = bare(r.series);
    const found = (no && (await prisma.series.findUnique({ where: { masterNo: no } }))) || mine.find((s) => bare(s.code) === k || bare(s.name) === k || s.aliases.some((a) => bare(a) === k) || (k.length >= 4 && !s.masterNo && bare(s.name).endsWith(k))); // "S120" finds a hand-made "SINAMICS S120", never another row of this list
    if (found) {
      if (!dry) await prisma.series.update({ where: { id: found.id }, data: { ...facts, masterNo: no ?? undefined, categoryCode: found.categoryCode ?? categoryCode ?? undefined, aliases: found.aliases.some((a) => bare(a) === k) || bare(found.name) === k || bare(found.code) === k ? undefined : { push: r.series } } });
      idOf.set(r, found.id); stats.seriesUpdated++;
      continue;
    }
    stats.seriesNew++;
    if (dry) continue;
    const base = { brandId: b.id, code: r.series.replace(/\s+/g, ""), name: r.series, categoryCode, masterNo: no, ...facts };
    const slug = slugify(r.series) || (no ?? r.series).toLowerCase();
    const created = await prisma.series.create({ data: { ...base, slug } }).catch(() => prisma.series.create({ data: { ...base, slug: `${slug}-${(no ?? String(Date.now())).toLowerCase()}` } }));
    idOf.set(r, created.id);
  }

  // ── successors: the maker's replacement, linked when it is a series of the same brand in the dictionary
  if (!dry) for (const r of rows) {
    const id = idOf.get(r);
    if (!id || !r.successor) continue;
    const head = bare(r.successor.split(/[（(；;，,/]/)[0]);
    const peers = await prisma.series.findMany({ where: { brandId: brandOf.get(r.brand)!.id, id: { not: id } } });
    const hit = peers.filter((s) => { const n = bare(s.name), c = bare(s.code); return head === n || head === c || (n.length >= 4 && head.endsWith(n)) || (c.length >= 4 && head.endsWith(c)) || s.aliases.some((a) => bare(a) === head); }).sort((a, z) => z.name.length - a.name.length)[0];
    if (hit) { await prisma.series.update({ where: { id }, data: { successorId: hit.id } }); stats.successorsLinked++; }
  }
  console.log(`${dry ? "[dry run] " : ""}${rows.length} rows · brands new ${stats.brandsNew} · series new ${stats.seriesNew}, updated ${stats.seriesUpdated} · successors linked ${stats.successorsLinked}`);
  for (const n of stats.notes) console.log(`note: ${n}`);
  const by = await prisma.series.groupBy({ by: ["lifecycle"], _count: { _all: true }, where: { masterNo: { not: null } } });
  console.log(by.map((x) => `${x.lifecycle} ${x._count._all}`).join(" · "));
  process.exit(0);
})();
