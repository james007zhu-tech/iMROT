/** N-41 先进先出 and N-42 作废 / 退料选原出库单: batches, issue cost, returns to the batch, voiding, the three figures agree. */
import { prisma } from "../../src/lib/db";
import { createServiceOrder } from "../../src/server/slm";
import { recordStockDoc, voidStockDoc, stockOnHand } from "../../src/server/scm";
import { localIso } from "../../src/lib/dates";
import { fifoOf, systemCost } from "../../src/server/fifo";
import { simpleBalance } from "../../src/server/fin-report";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => String(e.message));

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const tag = Date.now().toString().slice(-6);
  const customer = await prisma.customer.findFirstOrThrow({ orderBy: { code: "asc" } });
  const part = await prisma.part.create({ data: { sku: `GEN-TEST-FIFO-${tag}`, vendorPartNo: `TEST-FIFO-${tag}`, name: "TEST fifo fan" } });
  const val = async () => (await fifoOf([part.id])).get(part.id)!;
  const today = localIso(new Date())!.slice(0, 10);
  const stockBefore = (await simpleBalance(md.entityId, today, { includeTest: true })).assets.stock;
  const a = await recordStockDoc({ actorCode: md.code, direction: "IN", movedAt: new Date(Date.now() - 3 * 864e5), lines: [{ partSku: part.sku, qty: 6, unitCost: 100 }] });
  const b = await recordStockDoc({ actorCode: md.code, direction: "IN", movedAt: new Date(Date.now() - 2 * 864e5), lines: [{ partSku: part.sku, qty: 4, unitCost: 120 }] });
  check("two receipts: value 1,080, next batch at 100", (await val()).value === 1080 && systemCost(await val())?.cost === 100 && systemCost(await val())?.batch?.no === a.no);
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "DOMESTIC_TRADE", customerRef: `TEST-FIFO-${tag}`, requestLines: [{ sku: part.sku, description: part.name, qty: 8, unit: "pcs" }] });
  const o1 = await recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, movedAt: new Date(Date.now() - 864e5), lines: [{ partSku: part.sku, qty: 1 }] });
  let f = await val();
  check("MD's example: out 1 costs 100, 980 left", f.out.get(o1.lines[0].id)?.amount === 100 && f.value === 980, `${f.out.get(o1.lines[0].id)?.amount} ${f.value}`);
  const o2 = await recordStockDoc({ actorCode: md.code, direction: "OUT", serviceOrderNo: o.no, lines: [{ partSku: part.sku, qty: 7 }] });
  f = await val();
  const al = f.out.get(o2.lines[0].id)!;
  check("an issue across batches is split: 5 × 100 + 2 × 120 = 740", al.amount === 740 && al.alloc.length === 2 && f.value === 240, JSON.stringify(al.alloc));
  if (stockBefore != null) { const now = (await simpleBalance(md.entityId, today, { includeTest: true })).assets.stock; check("the report's stock figure moved by the same 240", Math.abs(Number(now) - Number(stockBefore) - 240) < 0.01, `${stockBefore} → ${now}`); }
  // 退料选原出库单
  check("a return for more than the issue took is refused", (await msg(recordStockDoc({ actorCode: md.code, direction: "IN", serviceOrderNo: o.no, refNo: o1.no, lines: [{ partSku: part.sku, qty: 2 }] }))).startsWith("RETURN_OVER"));
  const r = await recordStockDoc({ actorCode: md.code, direction: "IN", serviceOrderNo: o.no, refNo: o2.no, lines: [{ partSku: part.sku, qty: 3, unitCost: 999 }] });
  f = await val();
  check("3 back from the second issue: 2 × 120 and 1 × 100, at the cost they left at", f.back.get(r.lines[0].id)?.amount === 340 && f.value === 580 && f.qty === 5, `${f.back.get(r.lines[0].id)?.amount} ${f.value} ${f.qty}`);
  check("on hand agrees with the batches", (await stockOnHand(part.sku)) === f.qty);
  // 作废
  check("a receipt whose goods went out cannot be voided", (await msg(voidStockDoc({ no: a.no, actorCode: md.code, reason: "probe" }))).startsWith("STOCK_VOID_USED"));
  check("an issue with a return cannot be voided", (await msg(voidStockDoc({ no: o2.no, actorCode: md.code, reason: "probe" }))).startsWith("STOCK_VOID_HAS_RETURN"));
  check("no reason, no void", (await msg(voidStockDoc({ no: o1.no, actorCode: md.code, reason: "" }))) === "VOID_REASON_REQUIRED");
  const v1 = await voidStockDoc({ no: o1.no, actorCode: md.code, reason: "probe: issued by mistake" });
  f = await val();
  check("voiding the first issue puts its 1 × 100 back", f.value === 680 && f.qty === 6 && (await stockOnHand(part.sku)) === 6 && v1.no.startsWith("IB"), `${f.value} ${f.qty} ${v1.no}`);
  check("a void document cannot be voided again, nor its reversal", (await msg(voidStockDoc({ no: o1.no, actorCode: md.code, reason: "again" }))) === "STOCK_VOID_DONE" && (await msg(voidStockDoc({ no: v1.no, actorCode: md.code, reason: "again" }))) === "STOCK_VOID_DONE");
  const c = await recordStockDoc({ actorCode: md.code, direction: "IN", lines: [{ partSku: part.sku, qty: 2, unitCost: 150 }] });
  check("a new receipt sets the last purchase price", Number((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).lastCost) === 150);
  const v2 = await voidStockDoc({ no: c.no, actorCode: md.code, reason: "probe: wrong receipt" });
  f = await val();
  check("voiding it: stock and value as before, last price back to 120", f.value === 680 && (await stockOnHand(part.sku)) === 6 && v2.no.startsWith("OB") && Number((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).lastCost) === 120, `${f.value}`);
  const eng = await prisma.employee.findFirst({ where: { role: "ENGINEER", active: true } });
  if (eng) check("an engineer cannot void", (await msg(voidStockDoc({ no: b.no, actorCode: eng.code, reason: "probe" }))) === "NO_PERMISSION");
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
