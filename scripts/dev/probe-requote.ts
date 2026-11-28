/**
 * 开票前可改价格和成本 (朱总 2026-11-28). The quote can be revised after the customer's PO and after acceptance, until an
 * invoice stands on the order; after acceptance by the MD alone, prices / costs / wording only.
 *   npx tsx scripts/dev/probe-requote.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { attachAcceptSheet, recordAcceptance, setQuoteLines as rawSet } from "../../src/server/slm-docs";
import { confirmOrderCost } from "../../src/server/job-cost";
import { recordStockDoc } from "../../src/server/scm";
import { issueTaxInvoice, setQuoteLines } from "./_probe";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`REQUOTE FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (f: () => Promise<unknown>, re: RegExp, m: string) => { try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 60)})`); return; } throw new Error(`REQUOTE FAIL: ${m} — was not refused`); };

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const sales = await prisma.employee.findFirstOrThrow({ where: { role: "SALES", active: true, NOT: { extraRoles: { hasSome: ["FINANCE", "MD"] } } } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Requote Probe ${stamp} Co.`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30, salesId: sales.id } });
  });
  const line = (price: number, cost: number, qty = 1) => ({ description: "Technical service", descriptionLocal: "ค่าบริการทางเทคนิค", qty, unit: "lot", unitPrice: price, unitCost: cost });
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "SERVICE_CONSULTING", requestLines: [{ description: "Technical service", qty: 1 }] });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [line(100000, 20000)] });
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
  const get = () => prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });

  console.log("1. after the customer's PO, before acceptance");
  await rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: [line(110000, 25000)] });
  let r = await get();
  assert(r.status === "IN_PROGRESS" && Number(r.subtotal) === 110000 && Number(r.costTotal) === 25000 && !r.poStaleAt, "price and cost changed; the order stays in progress, the PO still stands");
  assert((await prisma.auditLog.count({ where: { target: o.no, action: "QUOTE_REVISED_AFTER_PO" } })) === 1, "the change is in the log");

  console.log("2. after acceptance: locked, yet the MD may still change price and cost until the invoice");
  await attachAcceptSheet({ orderNos: [o.no], actorCode: md.code, files: [{ name: "s.pdf", url: "/api/uploads/probe-rq.pdf" }] });
  await recordAcceptance({ serviceOrderNo: o.no, actorCode: md.code, status: "ACCEPTED", deliverables: [{ deliverable: "service", result: "done" }] });
  await confirmOrderCost({ no: o.no, actorCode: md.code });
  r = await get();
  assert(r.status === "ACCEPTED" && !!r.lockedAt && !!r.costConfirmedAt && Number(r.costActual) === 25000, "accepted, locked, cost recognised at 25,000.00");
  await refused(() => rawSet({ serviceOrderNo: o.no, actorCode: sales.code, lines: [line(120000, 25000)] }), /QUOTE_LOCKED_MD/, "Sales cannot change it after acceptance");
  await refused(() => rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: [line(120000, 25000, 2)] }), /QUOTE_LOCKED_ITEMS/, "the quantity the customer accepted cannot change");
  await refused(() => rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: [line(120000, 25000), line(5000, 1000)] }), /QUOTE_LOCKED_ITEMS/, "no line can be added");
  await rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ ...line(120000, 30000), description: "Technical service and consulting" }] });
  r = await get();
  assert(r.status === "ACCEPTED" && !!r.lockedAt && Number(r.subtotal) === 120000 && Number(r.total) === 128400 && Number(r.costTotal) === 30000, "the MD changed price, cost and wording: 120,000.00 (128,400.00 with VAT), cost 30,000.00; still accepted and locked");
  assert(!r.costConfirmedAt && r.costActual == null, "the cost recognised before is cleared — it is recognised again");
  assert((await prisma.auditLog.count({ where: { target: o.no, action: "QUOTE_REVISED_AFTER_ACCEPTANCE" } })) === 1, "the change is in the log");
  const part = await prisma.part.findFirstOrThrow();
  await refused(() => recordStockDoc({ actorCode: md.code, direction: "OUT", warehouse: "RAYONG", serviceOrderNo: o.no, costCurrency: "THB", lines: [{ partSku: part.sku, qty: 1 }] }), /ORDER_LOCKED/, "everything else stays locked: no stock issue to the order");

  console.log("3. the invoice carries the revised price; after it nothing changes");
  await refused(() => issueTaxInvoice0(o.no, md.code), /COST_NOT_CONFIRMED/, "no invoice until the cost is recognised again");
  const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code });
  const t = await prisma.taxInvoice.findUniqueOrThrow({ where: { no: ti.no } });
  assert(Number(t.subtotal) === 120000 && Number(t.total) === 128400, `${ti.no} is for the revised 128,400.00`);
  await refused(() => rawSet({ serviceOrderNo: o.no, actorCode: md.code, lines: [line(130000, 30000)] }), /QUOTE_AFTER_INVOICE/, "once invoiced the quote cannot be changed");
  console.log(`\nREQUOTE PASSED — ${o.no}`);
  process.exit(0);
}
import { issueTaxInvoice as issueTaxInvoice00 } from "../../src/server/to";
const issueTaxInvoice0 = (no: string, actorCode: string) => issueTaxInvoice00({ serviceOrderNo: no, actorCode });
main().catch((e) => { console.error(e); process.exit(1); });
