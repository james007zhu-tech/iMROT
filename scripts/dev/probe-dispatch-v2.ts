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
  // 朱总 2026-11-18: Sales may estimate. The part's last purchase cost stands (Sales does not see it); a line the system
  // has no cost for takes Sales' estimate and is marked 预估; without one it is named and refused.
  const { setQuoteLines: rawSet } = await import("../../src/server/slm-docs");
  check("Sales: a line without any cost is named and asked for an estimate", /QUOTE_EST_REQUIRED:2$/.test(await msg(rawSet({ serviceOrderNo: o.no, actorCode: sales.code, lines: two }))));
  const s1 = await rawSet({ serviceOrderNo: o.no, actorCode: sales.code, lines: [{ ...two[0], unitCost: 999 }, { ...two[1], unitCost: 20 }] });
  const st1 = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no }, include: { lines: { orderBy: { lineNo: "asc" } } } });
  check("Sales estimates: the part keeps the last purchase cost 40 (999 ignored), freight takes the estimate 20 and is marked 预估, margin (250 − 100) ÷ 250 = 60 %, the quote goes out", Number(st1.lines[0].unitCost) === 40 && !st1.lines[0].costEst && Number(st1.lines[1].unitCost) === 20 && st1.lines[1].costEst && Math.abs(Number(s1.marginPct) - 0.6) < 0.001 && st1.status === "QUOTE_PENDING", `${st1.lines.map((l) => `${l.unitCost}/${l.costEst}`)} ${s1.marginPct} ${st1.status}`);
  check("MD: a line without cost is named and refused", /QUOTE_COST_REQUIRED:2$/.test(await msg(rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: two }))));
  await rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: [two[0], { ...two[1], unitCost: 30 }] });
  const saved = await rawSet({ serviceOrderNo: o.no, actorCode: sales.code, lines: [{ ...two[0], unitCost: 999 }, { ...two[1], unitCost: 999 }] });
  const st2 = await prisma.quoteLine.findMany({ where: { serviceOrderId: st1.id }, orderBy: { lineNo: "asc" } });
  check("once the MD wrote the cost, Sales cannot change it: margin (250 − 110) ÷ 250 = 56 %, no longer 预估", Math.abs(Number(saved.marginPct) - 0.56) < 0.001 && Number(st2[1].unitCost) === 30 && !st2[1].costEst, String(saved.marginPct));

  console.log("第 12 条 所有 PO 都要审批");
  const sup = await createSupplier({ actorCode: pur.code, name: `TEST d2 Supplier ${tag}` });
  const po = await createPurchaseOrder({ actorCode: pur.code, supplierId: sup.id, vatRate: 0.07, lines: [{ partSku: part.sku, description: "TEST d2 bolt", qty: 1, unitPrice: 1 }] });
  check("a 1-baht PO cannot be sent or received before approval", /PO_NOT_APPROVED/.test(await msg(sendPurchaseOrder({ no: po.no, actorCode: pur.code }))) && /PO_NOT_APPROVED/.test(await msg(receivePurchaseOrder({ poNo: po.no, actorCode: pur.code, received: [{ lineNo: 1, qty: 1 }] }))));
  check("only what was asked can be decided; only the MD decides", /PO_NOT_WAITING/.test(await msg(decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: true }))) && (await msg(askPoApproval({ no: po.no, actorCode: pur.code }))) === "ok" && /MD_ONLY/.test(await msg(decidePurchaseOrder({ no: po.no, actorCode: pur.code, approve: true }))));
  check("a refusal needs a reason and sends it back", /REASON_REQUIRED/.test(await msg(decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: false }))) && (await msg(decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: false, note: "price" }))) === "ok" && /PO_NOT_APPROVED/.test(await msg(sendPurchaseOrder({ no: po.no, actorCode: pur.code }))));
  await askPoApproval({ no: po.no, actorCode: pur.code }); await decidePurchaseOrder({ no: po.no, actorCode: md.code, approve: true });
  check("approved: sent, then received", (await msg(sendPurchaseOrder({ no: po.no, actorCode: pur.code }))) === "ok" && (await msg(receivePurchaseOrder({ poNo: po.no, actorCode: pur.code, received: [{ lineNo: 1, qty: 1 }] }))) === "ok");

  console.log("第 1 条 记账汇率：中国银行价 + 日期；财务手工覆盖留痕");
  { const { rateFor, overrideRate, removeOverride } = await import("../../src/server/fx");
    const fin = await mk("FINANCE");
    const day = (n: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - n)); };
    await prisma.fxRate.deleteMany({ where: { currency: "XTS" } });
    await prisma.fxRate.create({ data: { currency: "XTS", rateDate: day(1), rateToCny: 0.2, source: "BOC" } });
    const r0 = await rateFor("XTS");
    check("the rate is the Bank of China one, with its day", r0?.source === "BOC" && r0.rateToCny === 0.2 && r0.rateDate.getTime() === day(1).getTime());
    check("Sales cannot set a rate", /NO_PERMISSION/.test(await msg(overrideRate({ actorCode: sales.code, currency: "XTS", rateDate: day(0), rateToCny: 0.21, note: "x" }))));
    check("an override needs a reason", /REASON_REQUIRED/.test(await msg(overrideRate({ actorCode: fin.code, currency: "XTS", rateDate: day(0), rateToCny: 0.21, note: " " }))));
    check("not for a day to come, not zero", /FX_FUTURE/.test(await msg(overrideRate({ actorCode: fin.code, currency: "XTS", rateDate: day(-1), rateToCny: 0.21, note: "x" }))) && /FX_RATE_REQUIRED/.test(await msg(overrideRate({ actorCode: fin.code, currency: "XTS", rateDate: day(0), rateToCny: 0, note: "x" }))));
    const row = await overrideRate({ actorCode: fin.code, currency: "xts", rateDate: day(0), rateToCny: 0.21, note: "TEST bank slip rate" });
    const r1 = await rateFor("XTS");
    check("finance's rate of today stands in front", r1?.source === "MANUAL" && r1.rateToCny === 0.21 && r1.rateDate.getTime() === day(0).getTime());
    check("yesterday's documents still get the Bank of China rate", (await rateFor("XTS", day(1)))?.source === "BOC");
    const sup2 = await createSupplier({ actorCode: md.code, name: `TEST d2 fx supplier ${tag}` });
    const fxPo = await createPurchaseOrder({ actorCode: pur.code, supplierId: sup2.id, currency: "XTS", vatRate: 0, lines: [{ vendorPartNo: part.vendorPartNo!, description: "TEST d2 bolt", qty: 1, unitPrice: 100 }], allowRepeat: true } as never);
    const kept = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no: fxPo.no } });
    check("a new document keeps rate, day and source (财务手工价 + today)", Number(kept.fxRateToCny) === 0.21 && kept.fxSource === "MANUAL" && kept.fxRateDate?.getTime() === day(0).getTime() && (kept.fxBy ?? "").startsWith(fin.code) && Number(kept.totalCny) === 21, `${kept.fxRateToCny} ${kept.fxSource} ${kept.totalCny}`);
    const a1 = await prisma.auditLog.findFirst({ where: { action: "FX_OVERRIDE", actorId: fin.id } });
    check("the override is on record: who, the rate, the Bank of China rate it replaced, why", (a1?.detail as { boc?: number; note?: string })?.boc === 0.2 && (a1?.detail as { note?: string })?.note === "TEST bank slip rate");
    check("removing needs a reason; a Bank of China rate cannot be removed", /REASON_REQUIRED/.test(await msg(removeOverride({ actorCode: fin.code, id: row.id, note: "" }))) && /FX_NOT_MANUAL/.test(await msg(removeOverride({ actorCode: fin.code, id: (await prisma.fxRate.findFirstOrThrow({ where: { currency: "XTS", source: "BOC" } })).id, note: "x" }))));
    await removeOverride({ actorCode: fin.code, id: row.id, note: "TEST done" });
    check("removed: back to the Bank of China rate, and the removal is on record; the document keeps what it was written with", (await rateFor("XTS"))?.source === "BOC" && !!(await prisma.auditLog.findFirst({ where: { action: "FX_OVERRIDE_REMOVED", actorId: fin.id } })) && (await prisma.purchaseOrder.findUniqueOrThrow({ where: { no: fxPo.no } })).fxSource === "MANUAL");
    await prisma.purchaseOrder.update({ where: { no: fxPo.no }, data: { status: "CANCELLED" } }).catch(() => null);
    await prisma.fxRate.deleteMany({ where: { currency: "XTS" } });
    await prisma.employee.update({ where: { id: fin.id }, data: { active: false } }); }

  await prisma.serviceOrder.update({ where: { no: o.no }, data: { status: "CANCELLED" } });
  await prisma.employee.updateMany({ where: { id: { in: [sales.id, pur.id] } }, data: { active: false } });
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
