/**
 * 2026-11-19 朱总 23:39: before the last round of testing, everything the test runs left behind goes. Kept: product
 * brands and series (and their categories), the system's own settings (legal entities, dictionary, role menus, mode
 * rules, holidays, Bank of China rates) and the MD. Every other employee is removed and the nine named accounts are
 * created (no password: each sets one through 忘记密码 / the MD's reset — nobody else ever knows it).
 *   MODE=dry  — counts only, nothing written
 *   MODE=run  — writes a JSON copy of every table to .dev-ops/backup-<stamp>/ first, then deletes in one transaction
 * Restore: scripts/dev/restore-json.ts reads the same folder back.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { prisma } from "../../src/lib/db";
import { hashPassword } from "../../src/lib/password";

const MD = "ETH2611001";
const KEEP = new Set(["Brand", "Series", "ProductCategory", "LegalEntity", "DictItem", "FxRate", "Holiday", "RoleMenu", "ModeRule", "Employee", "Dashboard", "EmployeeCredential", "EmployeeCareer", "_prisma_migrations"]);
const PEOPLE: { code: string; name: string; nameLocal?: string; email: string; role: "SALES" | "ENGINEER" | "PURCHASING" | "FINANCE" }[] = [
  { code: "ETH26002", name: "Tukta", email: "rojjana.jun@ducheng-industrial.com", role: "SALES" },
  { code: "ETH26003", name: "Fang Jianwen", nameLocal: "方建文", email: "jianwen.fang@ducheng-industrial.com", role: "ENGINEER" },
  { code: "ETH26004", name: "Fluke", email: "fluke@ducheng-industrial.com", role: "ENGINEER" },
  { code: "ETH26005", name: "Art", email: "art@ducheng-industrial.com", role: "ENGINEER" },
  { code: "ETH26006", name: "丁式俊", email: "shijun.ding@ducheng-industrial.com", role: "PURCHASING" },
  { code: "ETH26007", name: "欧阳小华", email: "xiaohua.ouyang@ducheng-industrial.com", role: "PURCHASING" },
  { code: "ETH26008", name: "魏径", email: "jing.wei@ducheng-industrial.com", role: "FINANCE" },
  { code: "ETH26009", name: "钱静", email: "jing.qian@ducheng-industrial.com", role: "FINANCE" },
  { code: "ETH26010", name: "成梅松", email: "meisong.cheng@ducheng-industrial.com", role: "ENGINEER" },
];

(async () => {
  const mode = process.env.MODE ?? "dry";
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: MD } });
  const tables = (await prisma.$queryRawUnsafe<{ t: string }[]>(`select table_name t from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1`)).map((x) => x.t);
  const count = async (t: string, where = "") => Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint n from "${t}" ${where}`))[0].n);
  const wipe = tables.filter((t) => !KEEP.has(t));
  const plan: string[] = [];
  for (const t of wipe) { const n = await count(t); if (n) plan.push(`${t} ${n}`); }
  const others = await prisma.employee.findMany({ where: { code: { not: MD } }, select: { code: true, name: true } });
  console.log(`delete all rows: ${plan.join(", ")}`);
  console.log(`FxRate hand-set (MANUAL) ${await count("FxRate", `where source <> 'BOC'`)} of ${await count("FxRate")} · Dashboard not the MD's ${await count("Dashboard", `where "ownerId" is distinct from '${md.id}' and "ownerId" is not null`)}`);
  console.log(`employees removed ${others.length}: ${others.map((e) => e.code).join(" ")}`);
  console.log(`kept: Brand ${await count("Brand")}, Series ${await count("Series")}, ProductCategory ${await count("ProductCategory")}, LegalEntity ${await count("LegalEntity")}, DictItem ${await count("DictItem")}, MD ${md.code}`);
  const clash = await prisma.employee.findMany({ where: { OR: [{ code: { in: PEOPLE.map((p) => p.code) } }, { email: { in: PEOPLE.map((p) => p.email) } }], code: { not: MD } }, select: { code: true } });
  console.log(`new accounts: ${PEOPLE.map((p) => `${p.code} ${p.role}`).join(", ")} (now in the way and removed with the rest: ${clash.map((c) => c.code).join(" ") || "none"})`);
  if (mode !== "run") { console.log("DRY RUN — nothing written"); process.exit(0); }

  // 1. a copy of everything, table by table, before anything goes
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13), dir = `.dev-ops/backup-${stamp}`;
  await mkdir(dir, { recursive: true });
  let rows = 0;
  for (const t of tables) {
    const data = (await prisma.$queryRawUnsafe<{ j: unknown }[]>(`select coalesce(json_agg(x), '[]'::json) j from "${t}" x`))[0].j as unknown[];
    await writeFile(`${dir}/${t}.json`, JSON.stringify(data)); rows += data.length;
    if (data.length !== (await count(t))) throw new Error(`backup of ${t} incomplete`);
  }
  await writeFile(`${dir}/_tables.json`, JSON.stringify(tables));
  console.log(`backup: ${dir} — ${tables.length} tables, ${rows} rows`);

  // 2. one transaction: all or nothing
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`TRUNCATE ${wipe.map((t) => `"${t}"`).join(", ")}`); // every referencing table is in the list, so no CASCADE is needed — if one were not, this fails and nothing changes
    await tx.$executeRawUnsafe(`DELETE FROM "FxRate" WHERE source <> 'BOC'`);
    await tx.$executeRawUnsafe(`DELETE FROM "Dashboard" WHERE "ownerId" IS NOT NULL AND "ownerId" <> $1`, md.id);
    await tx.$executeRawUnsafe(`DELETE FROM "EmployeeCredential" WHERE "employeeId" <> $1`, md.id);
    await tx.$executeRawUnsafe(`DELETE FROM "EmployeeCareer" WHERE "employeeId" <> $1`, md.id);
    await tx.employee.update({ where: { id: md.id }, data: { managerId: null } });
    await tx.employee.updateMany({ where: { code: { not: MD } }, data: { managerId: null } });
    const gone = await tx.employee.deleteMany({ where: { code: { not: MD } } });
    for (const p of PEOPLE) await tx.employee.create({ data: { ...p, entityId: md.entityId, locale: /[一-鿿]/.test(p.name + (p.nameLocal ?? "")) ? "zh" : "th", passwordHash: hashPassword(randomBytes(24).toString("base64url")), active: true } });
    await tx.auditLog.create({ data: { actorId: md.id, action: "DATA_WIPED", target: "ALL", detail: { by: "朱总 2026-11-18 23:39", backup: dir, deleted: plan, employeesRemoved: gone.count, created: PEOPLE.map((p) => `${p.code} ${p.role}`) } } });
  }, { timeout: 120000 });
  const left: string[] = [];
  for (const t of tables) { const n = await count(t); if (n) left.push(`${t} ${n}`); }
  console.log(`after: ${left.join(", ")}`);
  console.log((await prisma.employee.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, role: true } })).map((e) => `${e.code} ${e.name} ${e.role}`).join(" | "));
  process.exit(0);
})();
