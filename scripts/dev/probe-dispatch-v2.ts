/**
 * 派修单 v2 (2026-11-17 18:35) — the rules decided by the MD on 11/17 18:29, with the real functions:
 *   第 11 条  a quote line without cost is refused (Sales estimates; those who see what we paid get the last price)
 *   第 12 条  every PO is approved by the MD before it is sent or received, whatever the amount
 *     npx tsx scripts/dev/probe-dispatch-v2.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder } from "../../src/server/slm";
import { setQuoteLines } from "../../src/server/slm-docs";
import { askPoApproval, createPurchaseOrder, createSupplier, decidePurchaseOrder, receivePurchaseOrder, sendPurchaseOrder } from "../../src/server/purchasing";
import { allocateNumber } from "../../src/lib/numbering-db";

let failed = 0;
const check = (m: string, c: unknown, d = "") => { console.log(`${c ? "✓" : "✗"} ${m}${d ? ` — ${d}` : ""}`); if (!c) failed++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e: Error) => e.message);

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const tag = Date.now().toString().slice(-6);
  let n = 0;
  const mk = (role: string) => prisma.employee.create({ data: { code: `ETH15${tag.slice(-3)}${String(++n).padStart(2, "0")}`, name: `TEST d2 ${role}`, role: role as never, entityId: entity.id, joinedAt: new Date("2030-01-01") } });
  const sales = await mk("SALES"), pur = await mk("PURCHASING");
  const customer = await prisma.$transaction(async (tx) => tx.customer.create({ data: { code: await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id }), entityId: entity.id, name: `TEST d2 ${tag}`, taxId: `01055${Math.random().toString().slice(2, 10)}`, branchCode: "00000", paymentTermDays: 30, salesId: sales.id } }));
  const part = await prisma.part.create({ data: { sku: `TEST-D2-${tag}`, vendorPartNo: `D2-${tag}`, name: "TEST d2 bolt", lastCost: 40 } });

  console.log("第 11 条 报价成本必填");
  const o = await createServiceOrder({ createdByEmployeeCode: sales.code, customerId: customer.id, mode: "DOMESTIC_TRADE", requestLines: [{ sku: part.sku, qty: 2, unit: "pcs" }] } as never);
  const two = [{ partSku: part.sku, description: "TEST d2 bolt", qty: 2, unit: "pcs", unitPrice: 100 }, { description: "TEST freight", qty: 1, unit: "lot", unitPrice: 50 }];
  check("Sales: both lines without cost are named, nothing saved", /QUOTE_COST_REQUIRED:1、2/.test(await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: sales.code, lines: two }))) && (await prisma.quoteLine.count({ where: { serviceOrder: { no: o.no } } })) === 0);
  check("MD: the part line takes the last purchase price; the line without any is named", /QUOTE_COST_REQUIRED:2$/.test(await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: two }))));
  const saved = await setQuoteLines({ serviceOrderNo: o.no, actorCode: sales.code, lines: [{ ...two[0], unitCost: 60 }, { ...two[1], unitCost: 30 }] });
  check("with a cost on every line the quote is saved and the margin is worked out", saved.marginPct != null && Math.abs(Number(saved.marginPct) - 0.4) < 0.001, String(saved.marginPct));

  console.log("第 12 条 所有 PO 都要审批");
  const sup = await createSupplier({ actorCode: pur.code, name: `TEST d2 Supplier ${tag}` });
  const po = await createPurchaseOrder({ actorCode: pur.code, supplierId: sup.id, vatRate: 0.07, lines: [{ partSku: part.sku, description: "TEST d2 bolt", qty: 1, unitPrice: 1 }] });
  check("a 1-baht PO cannot be sent or received before approval", /PO_NOT_APPROVED/.test(await msg(sendPurchaseOrder({ no: po.no, actorCode: pur.code }))) && /PO_NOT_APPROVED/.test(await msg(receivePurchaseOrder({ poNo: po.no, actorCode: pur.code, received: [{ lineNo: 1, qty: 1 }] }))));
  check("only what was asked can be decided; only the MD decides", /PO_NOT_WAITING/.test(await msg(decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: true }))) && (await msg(askPoApproval({ no: po.no, actorCode: pur.code }))) === "ok" && /MD_ONLY/.test(await msg(decidePurchaseOrder({ no: po.no, actorCode: pur.code, approve: true }))));
  check("a refusal needs a reason and sends it back", /REASON_REQUIRED/.test(await msg(decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: false }))) && (await msg(decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: false, note: "price" }))) === "ok" && /PO_NOT_APPROVED/.test(await msg(sendPurchaseOrder({ no: po.no, actorCode: pur.code }))));
  await askPoApproval({ no: po.no, actorCode: pur.code }); await decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: true });
  check("approved: sent, then received", (await msg(sendPurchaseOrder({ no: po.no, actorCode: pur.code }))) === "ok" && (await msg(receivePurchaseOrder({ poNo: po.no, actorCode: pur.code, received: [{ lineNo: 1, qty: 1 }] }))) === "ok");

  await prisma.serviceOrder.update({ where: { no: o.no }, data: { status: "CANCELLED" } });
  await prisma.employee.updateMany({ where: { id: { in: [sales.id, pur.id] } }, data: { active: false } });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
