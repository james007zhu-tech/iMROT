/**
 * 新建 BLTH (朱总 2026-11-28): finance picks the customer, sees the issued and unpaid tax invoices, ticks some, and the
 * BLTH of the month is made from them.
 *   npx tsx scripts/dev/probe-statement.ts
 */
import { prisma } from "../../src/lib/db";
import { createServiceOrder, confirmCustomerPo, poLinesFromQuote } from "../../src/server/slm";
import { attachAcceptSheet, recordAcceptance } from "../../src/server/slm-docs";
import { billableWhere, issueInvoice, issueMonthlyStatement } from "../../src/server/to";
import { buildFields } from "../../src/server/reports";
import { pathAllows } from "../../src/lib/caps";
import { issueTaxInvoice, setQuoteLines } from "./_probe";
import { allocateNumber } from "../../src/lib/numbering-db";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`STATEMENT FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (f: () => Promise<unknown>, re: RegExp, m: string) => { try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 60)})`); return; } throw new Error(`STATEMENT FAIL: ${m} — was not refused`); };

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const fin = await prisma.employee.findFirst({ where: { active: true, OR: [{ role: "FINANCE" }, { extraRoles: { has: "FINANCE" } }], NOT: { role: "MD" } } });
  const sales = await prisma.employee.findFirstOrThrow({ where: { role: "SALES", active: true, NOT: { extraRoles: { hasSome: ["FINANCE", "MD"] } } } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { countryCode: "TH" } });
  const stamp = Date.now().toString().slice(-6);
  const customer = await prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id });
    return tx.customer.create({ data: { code, entityId: entity.id, name: `Statement Probe ${stamp} Co.`, taxId: `01055${Date.now().toString().slice(-8)}`, branchCode: "00000", paymentTermDays: 30 } });
  });
  const invoiced = async (price: number) => {
    const o = await createServiceOrder({ createdByEmployeeCode: md.code, customerId: customer.id, mode: "SERVICE_CONSULTING", requestLines: [{ description: "Service", qty: 1 }] });
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: md.code, lines: [{ description: "Service", descriptionLocal: "บริการ", qty: 1, unit: "lot", unitPrice: price, unitCost: 100 }] });
    await confirmCustomerPo({ no: o.no, actorCode: md.code, customerRef: `PO-${price}`, poLines: await poLinesFromQuote(o.no) });
    await attachAcceptSheet({ orderNos: [o.no], actorCode: md.code, files: [{ name: "s.pdf", url: "/api/uploads/probe-bl.pdf" }] });
    await recordAcceptance({ serviceOrderNo: o.no, actorCode: md.code, status: "ACCEPTED", deliverables: [{ deliverable: "service", result: "done" }] });
    const ti = await issueTaxInvoice({ serviceOrderNo: o.no, actorCode: md.code });
    return issueInvoice({ serviceOrderNo: o.no, actorCode: md.code, taxInvoiceNo: ti.no, issuedAt: new Date() });
  };
  const [a, b, c] = [await invoiced(10000), await invoiced(20000), await invoiced(30000)];

  console.log("1. who may, and what is offered");
  assert(pathAllows(md, "/statements/new") && (!fin || pathAllows(fin, "/statements/new")) && !pathAllows(sales, "/statements/new"), "新建 BLTH: the MD and finance; not Sales");
  const open = await prisma.invoice.findMany({ where: billableWhere(customer.id) });
  assert(open.length === 3 && !customer.monthlyStatement, "the customer's three issued, unpaid invoices are offered (the customer was not marked 月结)");
  await refused(() => issueMonthlyStatement(customer.code, "2611", sales.code, [a.id]), /NO_PERMISSION|FORBIDDEN|NOT_ALLOWED/i, "Sales cannot create a BLTH");
  await refused(() => issueMonthlyStatement(customer.code, "2613", md.code, [a.id]), /BL_PERIOD/, "a month that does not exist is refused");

  console.log("2. the ticked invoices make the BLTH of the month");
  const bl = await issueMonthlyStatement(customer.code, "2611", (fin ?? md).code, [a.id, c.id]);
  const row = await prisma.monthlyStatement.findUniqueOrThrow({ where: { id: bl.id }, include: { invoices: true } });
  assert(/^(TEST-)?BLTH/.test(bl.no) && row.period === "2611" && row.invoices.length === 2 && Number(row.total) === 42800, `${bl.no}: two invoices, 10,700 + 32,100 = 42,800.00 with VAT`);
  assert((await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } })).monthlyStatement, "the customer is a 月结 customer from now on");
  const left = await prisma.invoice.findMany({ where: billableWhere(customer.id) });
  assert(left.length === 1 && left[0].id === b.id, "the invoice that was not ticked is still offered; the two billed ones are not");
  await refused(() => issueMonthlyStatement(customer.code, "2611", md.code, [a.id]), /BL_NOTHING|BL_NOT_BILLABLE/, "an invoice already on a BLTH cannot go on another");
  const f = await buildFields(bl.no);
  assert(f.template === "23" && (f.values.L_IVTH as string[]).length === 2, "statement 23 prints the two invoices");

  console.log("3. a voided tax invoice is not offered");
  await prisma.taxInvoice.update({ where: { id: b.taxInvoiceId! }, data: { voidedAt: new Date() } });
  assert((await prisma.invoice.count({ where: billableWhere(customer.id) })) === 0, "the invoice of a voided TITH is not offered");
  console.log(`\nSTATEMENT PASSED — ${bl.no}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
