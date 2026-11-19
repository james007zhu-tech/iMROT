/**
 * 2026-11-19 真实数据导入第一步（朱总 07:52）: customers and equipment from the old system's two exports, prepared by
 * the mapping step into .dev-ops/import-1119.json. Everything goes in one transaction — all or nothing — and only into
 * an empty customer / asset book. MODE=dry checks only.
 *   - customers keep their CTH numbers; equipment keeps its ATH, except the second of two machines that shared one
 *     (the first registered keeps it): those get a new ATH and the old one stays in configuration.legacy
 *   - every machine is 在役 (TAKEOVER, IN_SERVICE) with one ONBOARDED event; the source row is kept whole in configuration.legacy
 *   - the number counters are set past every imported number, so new customers and machines never collide
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../../src/lib/db";
import type { Prisma } from "@prisma/client";

type In = { customers: any[]; plants: Record<string, Record<string, string>>; models: { key: string; seriesId: string; code: string }[]; assets: any[] };
(async () => {
  const mode = process.env.MODE ?? "dry";
  const d = JSON.parse(await readFile(process.env.FILE ?? ".dev-ops/import-1119.json", "utf8")) as In;
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const th = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const [nc, na] = [await prisma.customer.count(), await prisma.asset.count()];
  if ((nc || na) && process.env.FORCE !== "1") throw new Error(`not empty: ${nc} customers, ${na} assets`);
  const series = new Set((await prisma.series.findMany({ select: { id: true } })).map((s) => s.id));
  const bad = d.models.filter((m) => !series.has(m.seriesId));
  if (bad.length) throw new Error(`series missing: ${bad.length}`);
  const emp = new Set((await prisma.employee.findMany({ select: { id: true } })).map((e) => e.id));
  for (const c of d.customers) if (c.salesId && !emp.has(c.salesId)) throw new Error(`sales ${c.salesId} unknown`);

  // new ATH for the second of each shared number: this month, after the highest already in the file
  const ym = (() => { const t = new Date(Date.now() + 7 * 3600e3); return `${String(t.getUTCFullYear()).slice(2)}${String(t.getUTCMonth() + 1).padStart(2, "0")}`; })();
  const used = new Set(d.assets.filter((a) => !a.recode).map((a) => a.code as string));
  let next = Math.max(0, ...[...used].filter((c) => c.startsWith(`ATH${ym}`) && c.length === 11).map((c) => Number(c.slice(7))));
  for (const a of d.assets) if (a.recode) { do next++; while (used.has(`ATH${ym}${String(next).padStart(4, "0")}`)); a.newCode = `ATH${ym}${String(next).padStart(4, "0")}`; used.add(a.newCode); }
  const codes = d.assets.map((a) => a.newCode ?? a.code);
  if (new Set(codes).size !== codes.length) throw new Error("duplicate ATH after renumbering");
  const sn = d.assets.filter((a) => a.serialNumber).map((a) => String(a.serialNumber).replace(/\s+/g, "").toUpperCase());
  if (new Set(sn).size !== sn.length) throw new Error("duplicate serial");
  console.log(`customers ${d.customers.length} · plants ${Object.values(d.plants).reduce((s, p) => s + Object.keys(p).length, 0)} · models ${d.models.length} · assets ${d.assets.length} (renumbered ${d.assets.filter((a) => a.recode).length}: ATH${ym}… up to ${String(next).padStart(4, "0")})`);
  if (mode !== "run") { console.log("DRY RUN — nothing written"); process.exit(0); }

  const t0 = Date.now();
  await prisma.$transaction(async (tx) => {
    await tx.customer.createMany({ data: d.customers.map((c) => ({ code: c.code, entityId: th.id, name: c.name, nameLocal: c.nameLocal, taxId: c.taxId, addressEn: c.addressEn, addressLocal: c.addressLocal, phone: c.phone,
      registeredCapital: c.registeredCapital ?? undefined, foundedAt: c.foundedAt ? new Date(c.foundedAt) : undefined, salesId: c.salesId, notes: c.notes, createdAt: new Date(`${c.createdAt.replace(" ", "T")}+07:00`) })) });
    const cid = new Map((await tx.customer.findMany({ select: { id: true, code: true } })).map((c) => [c.code, c.id]));
    const plantRows = Object.entries(d.plants).flatMap(([cc, p]) => Object.entries(p).map(([name, code]) => ({ customerId: cid.get(cc)!, code, name })));
    await tx.plant.createMany({ data: plantRows });
    const pid = new Map((await tx.plant.findMany({ select: { id: true, code: true, customerId: true } })).map((p) => [`${p.customerId}|${p.code}`, p.id]));
    await tx.model.createMany({ data: d.models.map((m) => ({ seriesId: m.seriesId, code: m.code })), skipDuplicates: true });
    const mrow = await tx.model.findMany({ select: { id: true, seriesId: true, code: true } });
    const mByKey = new Map(mrow.map((m) => [`${m.seriesId}|${m.code}`, m.id]));
    const mid = new Map(d.models.map((m) => [m.key, mByKey.get(`${m.seriesId}|${m.code}`)!]));
    const rows: Prisma.AssetCreateManyInput[] = d.assets.map((a) => {
      const code = a.newCode ?? a.code, cust = a.customer ? cid.get(a.customer)! : undefined;
      return { code, entityId: th.id, type: a.type, modelId: a.model ? mid.get(a.model) : undefined, serialNumber: a.serialNumber ?? `DCiT-${code}`, serialSource: a.serialSource,
        customerId: cust, plantId: cust && a.plant ? pid.get(`${cust}|${a.plant}`) : undefined, location: a.location, status: "IN_SERVICE", origin: "TAKEOVER",
        installedAt: a.installedAt ? new Date(a.installedAt) : undefined, configuration: { ...a.configuration, ...(a.newCode ? { renumberedFrom: a.code } : {}) }, operatingConditions: a.operatingConditions ?? undefined,
        createdAt: new Date(`${a.createdAt.replace(" ", "T")}+07:00`) };
    });
    for (let i = 0; i < rows.length; i += 2000) await tx.asset.createMany({ data: rows.slice(i, i + 2000) });
    const ids = await tx.asset.findMany({ select: { id: true, code: true, createdAt: true, configuration: true } });
    const ev: Prisma.AssetEventCreateManyInput[] = ids.map((x) => { const l = (x.configuration as any)?.legacy ?? {}; const from = (x.configuration as any)?.renumberedFrom;
      return { assetId: x.id, type: "ONBOARDED", actorId: md.id, occurredAt: x.createdAt, summary: `导入 · 原系统建档 ${l.submittedBy ?? ""} ${l.submittedAt ?? ""}${from ? ` · 原编号 ${from} 与另一台重复，改为 ${x.code}` : ""}`.trim(), payload: { origin: "TAKEOVER", import: "2026-11-19", legacyId: l.id, ...(from ? { renumberedFrom: from } : {}) } }; });
    for (let i = 0; i < ev.length; i += 2000) await tx.assetEvent.createMany({ data: ev.slice(i, i + 2000) });
    // counters past every imported number
    const top = new Map<string, number>();
    for (const c of [...d.customers.map((c) => c.code as string), ...codes]) { const p = c[0], per = c.slice(3, 7), n = Number(c.slice(7)); const k = `${p}|${per}`; top.set(k, Math.max(top.get(k) ?? 0, n)); }
    for (const [k, last] of top) { const [prefix, period] = k.split("|");
      await tx.docSequence.upsert({ where: { entityId_prefix_period: { entityId: th.id, prefix, period } }, create: { entityId: th.id, prefix, period, last }, update: { last } }); }
    await tx.auditLog.create({ data: { actorId: md.id, action: "DATA_IMPORTED", target: "CUSTOMERS+ASSETS", detail: { by: "朱总 2026-11-19 07:52", customers: d.customers.length, assets: rows.length, models: d.models.length, plants: plantRows.length, renumbered: d.assets.filter((a) => a.recode).map((a) => `${a.code}→${a.newCode}`) } } });
  }, { timeout: 600000, maxWait: 20000 });
  console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s · customers ${await prisma.customer.count()} · plants ${await prisma.plant.count()} · models ${await prisma.model.count()} · assets ${await prisma.asset.count()} · events ${await prisma.assetEvent.count()}`);
  const seq = await prisma.docSequence.findMany({ where: { period: ym } }); console.log("counters", seq.map((s) => `${s.prefix}${s.period}=${s.last}`).join(" "));
  process.exit(0);
})();
