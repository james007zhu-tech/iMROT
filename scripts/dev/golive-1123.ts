/**
 * 2026-11-23 正式发布前的清理（朱总 09:58）: everything the test runs produced goes; what stays is
 *   1 人员体系      Employee (+ career, credentials, salary records), role menus, holidays
 *   2 设备档案      Asset with its import event, and what an asset file hangs on: Customer, Plant, Contact, Model
 *   3 品牌和系列    Brand, Series, ProductCategory (the test brands / series go when nothing real hangs on them)
 *   4 库存清单      Part and the opening receipts of 2026-11-19 (期初库存); test parts and test movements go
 *   5 故障代码库    FaultCode, its import record, anything published
 *   6 接口          lives in .env and the code, not in the database — untouched; Bank of China rates stay
 * plus the system's own settings (legal entities, dictionary, mode rules, dashboards).
 * MODE=backup writes a JSON copy of every table; MODE=dry counts; MODE=run backs up, then deletes in one transaction.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { prisma } from "../../src/lib/db";

const KEEP = new Set(["Employee", "EmployeeCareer", "EmployeeCredential", "SalaryRecord", "RoleMenu", "Holiday",
  "Customer", "Plant", "Contact", "Asset", "AssetRelation", "Model", "ModelPart", "Brand", "Series", "ProductCategory", "MaintenanceStandard",
  "Part", "FaultCode", "FaultCodeImport", "PublishedFaultCode", "PublishRun",
  "FxRate", "LegalEntity", "DictItem", "ModeRule", "Dashboard"]);
const PARTIAL = new Set(["AssetEvent", "StockMovement", "Document", "AuditLog", "DocSequence"]);
const q = <T = unknown>(sql: string, ...a: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...a);

(async () => {
  const mode = process.env.MODE ?? "dry";
  const tables = (await q<{ t: string }>(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).map((x) => x.t);
  const unknown = [...KEEP, ...PARTIAL].filter((t) => !tables.includes(t)); if (unknown.length) throw new Error(`no such table: ${unknown}`);
  const count = async (t: string, where = "") => Number((await q<{ n: bigint }>(`select count(*)::bigint n from "${t}" ${where}`))[0].n);
  const wipe = tables.filter((t) => !KEEP.has(t) && !PARTIAL.has(t));
  const opening = `select distinct no from "StockMovement" where "supplierRef" like '期初库存%'`;
  const testParts = `select id from "Part" where sku like '%-TEST-%'`; // not "name contains test": two real instruments are testers
  const plan: string[] = [];
  for (const t of wipe) { const n = await count(t); if (n) plan.push(`${t} ${n}`); }
  console.log(`delete all: ${plan.join(", ") || "nothing"}`);
  console.log(`AssetEvent: delete ${await count("AssetEvent", `where not (type='ONBOARDED' and payload->>'import' is not null)`)} of ${await count("AssetEvent")}`);
  console.log(`StockMovement: delete ${await count("StockMovement", `where no not in (${opening})`)} of ${await count("StockMovement")} · Document: delete ${await count("Document", `where no not in (${opening})`)} of ${await count("Document")}`);
  console.log(`Part: delete ${await count("Part", `where id in (${testParts})`)} of ${await count("Part")} · AuditLog: delete ${await count("AuditLog", `where action not in ('DATA_IMPORTED','DATA_WIPED','FAULT_CODES_IMPORTED')`)} of ${await count("AuditLog")}`);
  console.log(`Asset back to 在役: ${await count("Asset", `where status <> 'IN_SERVICE'`)} · test brands ${await count("Brand", `where name ilike '%PROBE%' or name ilike '%TEST%'`)} · test series ${await count("Series", `where code ilike 'TEST%'`)}`);
  // kept tables pointing at tables that go: those columns are cleared (or the run stops if one cannot be)
  const fks = await q<{ t: string; c: string; r: string; nullable: string }>(`select tc.table_name t, kcu.column_name c, ccu.table_name r, col.is_nullable nullable from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name=tc.constraint_name join information_schema.constraint_column_usage ccu on ccu.constraint_name=tc.constraint_name
    join information_schema.columns col on col.table_name=tc.table_name and col.column_name=kcu.column_name where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public'`);
  const dangling = fks.filter((f) => KEEP.has(f.t) && wipe.includes(f.r));
  for (const f of dangling) { const n = await count(f.t, `where "${f.c}" is not null`); if (n) console.log(`  ${f.t}.${f.c} → ${f.r}: ${n} rows ${f.nullable === "YES" ? "cleared" : "CANNOT BE CLEARED"}`); if (n && f.nullable !== "YES") throw new Error(`${f.t}.${f.c} is required and points at ${f.r}`); }
  if (mode === "dry") { console.log("DRY RUN — nothing written"); process.exit(0); }

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13), dir = `.dev-ops/backup-${stamp}`;
  await mkdir(dir, { recursive: true });
  let rows = 0;
  for (const t of tables) { // big tables in slices, so no single string is too long
    const n = await count(t); const parts: unknown[] = [];
    for (let off = 0; off < Math.max(n, 1); off += 5000) parts.push(...((await q<{ j: unknown[] }>(`select coalesce(json_agg(x), '[]'::json) j from (select * from "${t}" order by 1 offset ${off} limit 5000) x`))[0].j));
    if (parts.length !== n) throw new Error(`backup of ${t} incomplete: ${parts.length} of ${n}`);
    await writeFile(`${dir}/${t}.json.gz`, gzipSync(JSON.stringify(parts))); rows += n;
  }
  await writeFile(`${dir}/_tables.json`, JSON.stringify(tables));
  console.log(`backup: ${dir} — ${tables.length} tables, ${rows} rows`);
  if (mode === "backup") process.exit(0);

  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  await prisma.$transaction(async (tx) => {
    const x = (sql: string) => tx.$executeRawUnsafe(sql);
    for (const f of dangling) await x(`UPDATE "${f.t}" SET "${f.c}" = NULL WHERE "${f.c}" IS NOT NULL`);
    await x(`DELETE FROM "AssetEvent" WHERE NOT (type='ONBOARDED' AND payload->>'import' IS NOT NULL)`);
    await x(`UPDATE "Asset" SET status='IN_SERVICE' WHERE status <> 'IN_SERVICE'`);
    await x(`DELETE FROM "StockMovement" WHERE no NOT IN (${opening})`);
    await x(`UPDATE "StockMovement" SET "serviceOrderId"=NULL, "purchaseOrderId"=NULL, "assetId"=NULL WHERE "serviceOrderId" IS NOT NULL OR "purchaseOrderId" IS NOT NULL`);
    await x(`DELETE FROM "Document" WHERE no NOT IN (${opening})`);
    await x(`DELETE FROM "AuditLog" WHERE action NOT IN ('DATA_IMPORTED','DATA_WIPED','FAULT_CODES_IMPORTED')`);
    // the rest, children before parents: keep trying until every table is empty
    let left = [...wipe];
    for (let pass = 0; left.length && pass < 30; pass++) { const next: string[] = [];
      for (const t of left) { await x(`SAVEPOINT s`); try { await x(`DELETE FROM "${t}"`); await x(`RELEASE SAVEPOINT s`); } catch { await x(`ROLLBACK TO SAVEPOINT s`); next.push(t); } }
      if (next.length === left.length) throw new Error(`cannot empty: ${next.join(", ")}`); left = next; }
    await x(`DELETE FROM "Part" WHERE id IN (${testParts})`);
    // one imported part number kept a stray bracket from the source sheet (MS2670BN-IE(南京民盛电子仪器))
    await x(`UPDATE "Part" SET sku='GEN-MS2670BN-IE', "vendorPartNo"='MS2670BN-IE', name='南京民盛耐压测试仪 / Menshiny Withstand Voltage Tester · 南京民盛电子仪器' WHERE sku='GEN-MS2670BN-IE(' AND NOT EXISTS (SELECT 1 FROM "Part" WHERE sku='GEN-MS2670BN-IE')`);
    await x(`DELETE FROM "Series" s WHERE (s.code ILIKE 'TEST%' OR s."brandId" IN (SELECT id FROM "Brand" WHERE name ILIKE '%PROBE%' OR name ILIKE '%TEST%')) AND NOT EXISTS (SELECT 1 FROM "Model" m WHERE m."seriesId"=s.id) AND NOT EXISTS (SELECT 1 FROM "FaultCode" f WHERE f."seriesId"=s.id)`);
    await x(`DELETE FROM "Brand" b WHERE (b.name ILIKE '%PROBE%' OR b.name ILIKE '%TEST%') AND NOT EXISTS (SELECT 1 FROM "Series" s WHERE s."brandId"=b.id) AND NOT EXISTS (SELECT 1 FROM "Part" p WHERE p."brandId"=b.id)`);
    // number counters: customers, equipment, employees and the opening receipts keep theirs; every document series starts again
    await x(`DELETE FROM "DocSequence" WHERE NOT (prefix IN ('A','C','E') OR (prefix='IB' AND EXISTS (SELECT 1 FROM "StockMovement" m WHERE m.no LIKE 'IBTH' || "DocSequence".period || '%')))`);
    await tx.auditLog.create({ data: { actorId: md.id, action: "DATA_WIPED", target: "GO_LIVE", detail: { by: "朱总 2026-11-23 09:58 正式发布", backup: dir, deleted: plan } } });
  }, { timeout: 300000, maxWait: 20000 });
  const left: string[] = [];
  for (const t of tables) { const n = await count(t); if (n) left.push(`${t} ${n}`); }
  console.log(`after: ${left.join(", ")}`);
  console.log(`stock: ${JSON.stringify(await q(`select count(distinct "partId")::int parts, sum(case direction when 'IN' then qty else -qty end)::float qty from "StockMovement"`))} · counters ${(await prisma.docSequence.findMany({ orderBy: [{ prefix: "asc" }, { period: "asc" }] })).map((s) => `${s.prefix}${s.period}=${s.last}`).join(" ")}`);
  process.exit(0);
})();
