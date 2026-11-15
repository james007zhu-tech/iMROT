/** 暂估应付 and 三单匹配 (测试报告 P0-10): goods in → accrued payable; invoice → real payable; a mismatch waits for the MD. */
import { prisma } from "../../src/lib/db";
import { createPurchaseOrder, createSupplier, receivePurchaseOrder } from "../../src/server/purchasing";
import { approvePayment, paySupplierInvoice, registerSupplierInvoice } from "../../src/server/srm";
import { buildCashPlan } from "../../src/server/cash-plan";
import { financeReport } from "../../src/server/fin-report";
import { localIso } from "../../src/lib/dates";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => String(e.message));

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const tag = Date.now().toString().slice(-6);
  const fin = await prisma.employee.create({ data: { code: `ETH15${tag.slice(-5)}`, entityId: md.entityId, name: `Accrual Probe Finance ${tag}`, role: "FINANCE", managerId: md.id, joinedAt: new Date("2030-01-01") } });
  const sup = await createSupplier({ actorCode: md.code, name: `TEST Accrual Supplier ${tag}` });
  await prisma.supplier.update({ where: { id: sup.id }, data: { paymentMode: "PER_ORDER" } });
  const sku = `TEST-ACC-${tag}`;
  const pos: string[] = [];
  try {
    const po = await createPurchaseOrder({ actorCode: md.code, supplierId: sup.id, vatRate: 0.07, lines: [{ vendorPartNo: sku, description: "TEST contactor", qty: 10, unitPrice: 1000 }] });
    pos.push(po.id);
    await prisma.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT" } });
    await receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 6 }] });
    const acc1 = await prisma.supplierInvoice.findFirst({ where: { purchaseOrderId: po.id, accrued: true } });
    check("a receipt of 6 × 1,000 accrues 6,000 + VAT 420", Number(acc1?.subtotal) === 6000 && Number(acc1?.payable) === 6420, `${acc1?.invoiceNo} ${acc1?.subtotal} ${acc1?.payable}`);
    await receivePurchaseOrder({ poNo: po.no, actorCode: md.code, received: [{ lineNo: 1, qty: 4 }] });
    const acc2 = await prisma.supplierInvoice.findMany({ where: { purchaseOrderId: po.id, accrued: true } });
    check("the second receipt moves the same accrual to 10,000 (one row per POTH)", acc2.length === 1 && Number(acc2[0].subtotal) === 10000 && Number(acc2[0].payable) === 10700, `${acc2.length} rows, ${acc2[0]?.payable}`);
    check("an accrual cannot be paid", /PAYABLE_ACCRUED/.test(await msg(paySupplierInvoice({ id: acc2[0].id, actorCode: fin.code }))));
    const month = localIso(new Date())!.slice(0, 7);
    const plan = await buildCashPlan(md.entityId, month);
    const line = plan.lines.find((l) => l.ref === po.no);
    check("the cash plan of the due month carries it once, VAT included", !!line && line.amount === 10700 && plan.lines.filter((l) => l.ref === po.no).length === 1, String(line?.amount));
    const rep0 = await financeReport(md.entityId, new Date().getFullYear(), { withPayroll: false });
    const m0 = rep0.months.find((m) => m.month === month)!;

    const inv = await registerSupplierInvoice({ poNo: po.no, actorCode: md.code, invoiceNo: `TEST-INV-${tag}`, invoiceDate: new Date(), subtotal: 10000 });
    const left = await prisma.supplierInvoice.count({ where: { purchaseOrderId: po.id, accrued: true } });
    check("the invoice replaces the accrual: 已到票, matched", left === 0 && Number(inv.matchDiff) === 0 && Number(inv.payable) === 10700, `diff ${inv.matchDiff}`);
    const rep1 = await financeReport(md.entityId, new Date().getFullYear(), { withPayroll: false });
    const m1 = rep1.months.find((m) => m.month === month)!;
    check("purchases counted once (accrual, then invoice); input VAT only once the invoice is in", Math.abs(m1.purchases - m0.purchases) < 0.01 && Math.abs(m1.vatIn - m0.vatIn - 700) < 0.01, `purchases ${m0.purchases}→${m1.purchases}, vatIn +${(m1.vatIn - m0.vatIn).toFixed(2)}`);
    check("a matched invoice is paid by finance", (await msg(paySupplierInvoice({ id: inv.id, actorCode: fin.code }))) === "ok");

    // an invoice that does not match what came in
    const po2 = await createPurchaseOrder({ actorCode: md.code, supplierId: sup.id, vatRate: 0.07, lines: [{ vendorPartNo: sku, description: "TEST contactor", qty: 10, unitPrice: 1000 }], allowRepeat: true });
    pos.push(po2.id);
    await prisma.purchaseOrder.update({ where: { id: po2.id }, data: { status: "SENT" } });
    await receivePurchaseOrder({ poNo: po2.no, actorCode: md.code, received: [{ lineNo: 1, qty: 5 }] });
    check("an invoice above the POTH is refused", /INVOICE_EXCEEDS_PO/.test(await msg(registerSupplierInvoice({ poNo: po2.no, actorCode: md.code, invoiceNo: `TEST-INV-${tag}-X`, invoiceDate: new Date(), subtotal: 12000 }))));
    const off = await registerSupplierInvoice({ poNo: po2.no, actorCode: md.code, invoiceNo: `TEST-INV-${tag}-B`, invoiceDate: new Date(), subtotal: 5800 });
    check("5,800 invoiced against 5,000 received is flagged (+800)", Number(off.matchDiff) === 800, String(off.matchDiff));
    check("and waits for the MD before it can be paid", /PAY_NEEDS_MD/.test(await msg(paySupplierInvoice({ id: off.id, actorCode: fin.code }))));
    await approvePayment({ id: off.id, actorCode: md.code });
    check("released by the MD, it is paid", (await msg(paySupplierInvoice({ id: off.id, actorCode: fin.code }))) === "ok");
  } finally {
    const invs = await prisma.supplierInvoice.findMany({ where: { purchaseOrderId: { in: pos } } });
    const nos = invs.map((i) => i.paymentNo).filter((n): n is string => !!n).sort().reverse();
    await prisma.document.deleteMany({ where: { no: { in: nos } } });
    for (const n of nos) await prisma.docSequence.updateMany({ where: { prefix: "PV", last: Number(n.slice(-2)) }, data: { last: { decrement: 1 } } }).catch(() => null);
    await prisma.supplierInvoice.deleteMany({ where: { purchaseOrderId: { in: pos } } });
    await prisma.auditLog.deleteMany({ where: { actorId: fin.id } });
    await prisma.employee.delete({ where: { id: fin.id } });
  }
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
