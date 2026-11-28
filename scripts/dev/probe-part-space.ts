/**
 * 料号里有空格 (朱总 2026-11-28: the part was created before the receipt, yet receiving answered "unknown part number").
 *   npx tsx scripts/dev/probe-part-space.ts
 */
import { prisma } from "../../src/lib/db";
import { recordStockDoc, resolveParts } from "../../src/server/scm";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`PART-SPACE FAIL: ${m}`); console.log("  ok  " + m); };
async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const tag = Date.now().toString().slice(-6);
  const sku = `MIT-E${tag}B Board`, low = `TST-${tag}sensors`;
  await prisma.part.create({ data: { sku, vendorPartNo: `E${tag}B Board`, name: `E${tag}B Board`, unit: "pcs" } });
  await prisma.part.create({ data: { sku: low, vendorPartNo: `${tag}sensors`, name: "small s", unit: "pcs" } });
  for (const key of [sku, sku.toLowerCase(), `MIT-E${tag}BBoard`, `E${tag}B Board`, `e${tag}b  board`]) {
    const r = await resolveParts([key]);
    assert(r.found.get(key.trim())?.sku === sku && !r.unknown.length, `"${key}" finds ${sku}`);
  }
  assert((await resolveParts([low])).found.get(low)?.sku === low && (await resolveParts([`${tag}SENSORS`])).found.size === 1, "a number with a small s in it is found too");
  assert((await resolveParts([`NOPE-${tag}`])).unknown.length === 1, "a number that does not exist is still unknown");
  const doc = await recordStockDoc({ actorCode: md.code, direction: "IN", warehouse: "RAYONG", costCurrency: "THB", lines: [{ partSku: sku, qty: 2, unitCost: 100 }] });
  assert(/IBTH/.test(doc.no) && doc.lines.length === 1, `receipt ${doc.no} written for the part with a space in its number`);
  console.log("\nPART-SPACE PASSED");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
