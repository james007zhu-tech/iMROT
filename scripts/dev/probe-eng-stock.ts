/**
 * 出入库给工程师 (朱总 2026-11-27): an engineer books a stock receipt and a stock issue, receives the goods of an approved
 * PO — and the receipt keeps the PO's price although the engineer never sees cost; PUR-only things stay PUR's.
 *   npx tsx scripts/dev/probe-eng-stock.ts
 */
import { prisma } from "../../src/lib/db";
import { recordStockDoc, voidStockDoc } from "../../src/server/scm";
import { createPurchaseOrder, createSupplier } from "../../src/server/purchasing";
import { receivePurchaseOrder } from "./_probe";
import { can, menuAllows, pathAllows } from "../../src/lib/caps";
import { docTypeAllowed } from "../../src/server/scope";

let failed = 0;
const check = (m: string, c: unknown, d = "") => { console.log(`${c ? "✓" : "✗"} ${m}${d ? ` — ${d}` : ""}`); if (!c) failed++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const tag = Date.now().toString().slice(-6);
  let n = 0;
  const mk = (role: string) => prisma.employee.create({ data: { code: `ETH16${tag.slice(-3)}${String(++n).padStart(2, "0")}`, name: `TEST es ${role}`, role: role as never, entityId: entity.id, joinedAt: new Date("2030-01-01") } });
  const eng = await mk("ENGINEER"), pur = await mk("PURCHASING"), hr = await mk("HR");
  const part = await prisma.part.create({ data: { sku: `TEST-ES-${tag}`, vendorPartNo: `ES-${tag}`, name: "TEST es fuse", lastCost: 10 } });

  console.log("页面与菜单");
  check("engineer: stock in, stock out, purchase orders in the menu; IB and OB papers", menuAllows(eng, "stockIn") && menuAllows(eng, "stockOut") && menuAllows(eng, "purchaseOrders") && docTypeAllowed(eng, "IB") && docTypeAllowed(eng, "OB"));
  check("engineer: the stock form for a receipt opens; HR's does not", pathAllows(eng, "/parts/movement?direction=IN") && pathAllows(eng, "/parts/movement") && !pathAllows(hr, "/parts/movement?direction=IN"));
  check("engineer: no PO paper (it carries what we pay)", !docTypeAllowed(eng, "PO") && docTypeAllowed(pur, "PO"));
  check("engineer still cannot raise a PO, a supplier or a part, nor see cost", !can.purchase(eng) && !can.cost(eng) && !pathAllows(eng, "/purchasing/orders/new") && !pathAllows(eng, "/suppliers/new") && !pathAllows(eng, "/parts/new"));

  console.log("入库、出库");
  const ib = await recordStockDoc({ actorCode: eng.code, direction: "IN", lines: [{ partSku: part.sku, qty: 5, unitCost: 1 }] });
  check("an engineer books a receipt without an order", /^IB/.test(ib.no) || /IB/.test(ib.no), ib.no);
  check("…the cost the engineer typed is not taken (stays 10)", Number((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).lastCost) === 10);
  const asset = await prisma.asset.findFirstOrThrow({ select: { code: true } });
  const ob = await msg(recordStockDoc({ actorCode: eng.code, direction: "OUT", assetCode: asset.code, lines: [{ partSku: part.sku, qty: 2 }] }));
  check("an engineer books an issue to a machine", ob === "ok", ob);
  check("an issue still needs the machine or the order it serves", /must name the asset or the service order/.test(await msg(recordStockDoc({ actorCode: eng.code, direction: "OUT", lines: [{ partSku: part.sku, qty: 1 }] }))));
  check("voiding a stock paper stays with PUR and the MD", /NO_PERMISSION/.test(await msg(voidStockDoc({ no: ib.no, actorCode: eng.code, reason: "test" }))));
  check("HR still cannot move stock", /NO_PERMISSION/.test(await msg(recordStockDoc({ actorCode: hr.code, direction: "IN", lines: [{ partSku: part.sku, qty: 1 }] }))));

  console.log("采购到货入库");
  const sup = await createSupplier({ actorCode: pur.code, entityCode: entity.code, name: `TEST es supplier ${tag}` } as never);
  const po = await createPurchaseOrder({ actorCode: pur.code, supplierId: (sup as { id: string }).id, lines: [{ partSku: part.sku, description: "TEST es fuse", qty: 3, unit: "pcs", unitPrice: 77 }] } as never);
  const r = await msg(receivePurchaseOrder({ poNo: (po as { no: string }).no, actorCode: eng.code, received: [{ lineNo: 1, qty: 3 }] }));
  check("an engineer receives the goods of an approved PO", r === "ok", r);
  const last = await prisma.stockMovement.findFirst({ where: { partId: part.id, direction: "IN" }, orderBy: { movedAt: "desc" } });
  check("…and the receipt keeps the PO price 77 as cost", Number(last?.unitCost ?? 0) === 77 && Number((await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).lastCost) === 77, `${last?.unitCost} / ${(await prisma.part.findUniqueOrThrow({ where: { id: part.id } })).lastCost}`);
  console.log(failed ? `${failed} FAILED` : "ALL PASSED");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
