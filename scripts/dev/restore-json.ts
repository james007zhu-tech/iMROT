/** Puts a database back from a JSON copy made by wipe-1119.ts: DIR=.dev-ops/backup-… MODE=run (dry by default). */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { prisma } from "../../src/lib/db";
(async () => {
  const dir = process.env.DIR; if (!dir) throw new Error("DIR=");
  const tables = JSON.parse(await readFile(`${dir}/_tables.json`, "utf8")) as string[];
  const data = new Map<string, string>(); let rows = 0;
  for (const t of tables) { const s = existsSync(`${dir}/${t}.json.gz`) ? gunzipSync(await readFile(`${dir}/${t}.json.gz`)).toString("utf8") : await readFile(`${dir}/${t}.json`, "utf8"); data.set(t, s); rows += (JSON.parse(s) as unknown[]).length; }
  console.log(`${dir}: ${tables.length} tables, ${rows} rows`);
  if (process.env.MODE !== "run") { console.log("DRY RUN"); process.exit(0); }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`); // foreign keys are checked again once every table is back
    await tx.$executeRawUnsafe(`TRUNCATE ${tables.filter((t) => t !== "_prisma_migrations").map((t) => `"${t}"`).join(", ")}`);
    for (const t of tables) { if (t === "_prisma_migrations") continue; const s = data.get(t)!; if (s === "[]") continue;
      const all = JSON.parse(s) as unknown[];
      for (let i = 0; i < all.length; i += 2000) await tx.$executeRawUnsafe(`INSERT INTO "${t}" SELECT * FROM json_populate_recordset(NULL::"${t}", $1::json)`, JSON.stringify(all.slice(i, i + 2000))); }
  }, { timeout: 300000 });
  for (const t of tables) { const n = Number((await prisma.$queryRawUnsafe<{ n: bigint }[]>(`select count(*)::bigint n from "${t}"`))[0].n); const want = (JSON.parse(data.get(t)!) as unknown[]).length; if (n !== want) console.log(`✗ ${t} ${n} ≠ ${want}`); }
  console.log("restored");
  process.exit(0);
})();
