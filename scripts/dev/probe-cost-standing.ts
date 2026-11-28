/**
 * 总成本 = 系统单据 + 报价时写、没有单据的成本 (朱总 2026-11-28). A 服务咨询 order whose line cost the MD wrote on the quote,
 * with three approved expenses booked to it:
 *   npx tsx scripts/dev/probe-cost-standing.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { attachAcceptSheet, recordAcceptance } from "../../src/server/slm-docs";
import { fileExpense, decideExpense } from "../../src/server/expense";
import { confirmOrderCost, lineCosts, orderCost, standingTotal } from "../../src/server/job-cost";
import { issueTaxInvoice } from "../../src/server/to";
import { setQuoteLines } from "./_probe";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`COST-STANDING FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (f: () => Promise<unknown>, re: RegExp, m: string) => { try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 60)})`); return; } throw new Error(`COST-STANDING FAIL: ${m} — was not refused`); };

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Cost Probe ${stamp} Co.`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "SERVICE_CONSULTING", requestLines: [{ description: "Technical service and consulting", qty: 1 }] });
  await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ description: "Technical service and consulting", descriptionLocal: "ค่าบริการทางเทคนิค", qty: 1, unit: "lot", unitPrice: 700934.58, unitCost: 90947 }] });
  await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${stamp}`, poLines: await poLinesFromQuote(o.no) });
  await attachAcceptSheet({ orderNos: [o.no], actorCode: md.code, files: [{ name: "signed.pdf", url: "/api/uploads/probe-cost.pdf" }] });
  await recordAcceptance({ serviceOrderNo: o.no, actorCode: md.code, status: "ACCEPTED", deliverables: [{ deliverable: "service", result: "done" }] });
  const ids: string[] = [];
  for (const amount of [25000, 200000, 50000]) { const c = await fileExpense({ actorCode: md.code, spentOn: new Date(), category: "OTHER", description: `consulting cost ${amount}`, amount, serviceOrderNo: o.no }); await decideExpense({ id: c.id, actorCode: md.code, decision: "APPROVED" }); ids.push(c.id); }

  console.log("1. the cost written on the quote counts on top of the records");
  const c = await orderCost(o.id);
  const lines = await lineCosts(o.id, c);
  assert(c.total === 275000 && c.expenses.length === 3 && c.expenses[0].what.includes("consulting cost"), "records: three approved expenses = 275,000.00, each named");
  assert(lines[0].ask && lines[0].stands && lines[0].choice === "keep" && lines[0].real === 90947 && standingTotal(lines) === 90947, "line 1: the 90,947.00 written on the quote stands (no record behind it)");
  console.log("2. finance may say the written cost IS one of the records — then it is not counted twice");
  const first = `exp:${c.expenses[0].ref}:0`;
  const swapped = await lineCosts(o.id, c, { "1": first });
  assert(!swapped[0].stands && swapped[0].real === 25000 && standingTotal(swapped) === 0, "line 1 → that expense: total stays 275,000.00");
  assert(standingTotal(await lineCosts(o.id, c, { "1": "none" })) === 0, "line 1 → nothing spent: total stays 275,000.00");
  console.log("3. recognised total and the invoice");
  await refused(() => issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code }), /COST_NOT_CONFIRMED/, "no tax invoice before the cost is recognised");
  const r = await confirmOrderCost({ no: o.no, actorCode: md.code });
  const row = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: o.id } });
  const d = row.costDetail as { total: number; recordsTotal: number; standing: number };
  assert(r.total === 365947 && Number(row.costActual) === 365947 && d.recordsTotal === 275000 && d.standing === 90947, "recognised: 275,000.00 + 90,947.00 = 365,947.00");
  const late = await fileExpense({ actorCode: md.code, spentOn: new Date(), category: "OTHER", description: "late cost", amount: 1000, serviceOrderNo: o.no });
  await decideExpense({ id: late.id, actorCode: md.code, decision: "APPROVED" });
  await refused(() => issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code }), /COST_CHANGED:366947\.00/, "a cost booked afterwards asks for recognition again, at 366,947.00");
  await confirmOrderCost({ no: o.no, actorCode: md.code });
  const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code });
  assert(/TITH/.test(ti.no), `recognised again → tax invoice ${ti.no}`);
  console.log(`\nCOST-STANDING PASSED — ${o.no}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
