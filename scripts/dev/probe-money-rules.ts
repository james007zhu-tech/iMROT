/** 钱的规矩 (测试报告 P0-14): finance pays; above 50,000 THB or own invoice waits for the MD; nobody pays their own claim. */
import { prisma } from "../../src/lib/db";
import { approvePayment, paySupplierInvoice } from "../../src/server/srm";
import { decideExpense, payExpense } from "../../src/server/expense";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => String(e.message));

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const tag = Date.now().toString().slice(-5);
  const mk = (n: string, role: "FINANCE" | "ENGINEER" | "MANAGER", managerId = md.id) => prisma.employee.create({ data: { code: `ETH16${n}${tag.slice(-3)}`, entityId: md.entityId, name: `Money Probe ${role} ${tag}`, role, managerId, joinedAt: new Date("2030-01-01") } });
  const fin = await mk("11", "FINANCE"), fin2 = await mk("12", "FINANCE"), mgr = await mk("13", "MANAGER"), eng = await mk("14", "ENGINEER", mgr.id);
  const po = await prisma.purchaseOrder.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
  const inv = (no: string, payable: number, by: string) => prisma.supplierInvoice.create({ data: { entityId: po.entityId, supplierId: po.supplierId, purchaseOrderId: po.id, invoiceNo: `MP-${tag}-${no}`, invoiceDate: new Date(), subtotal: payable, vatAmount: 0, total: payable, whtRate: 0, whtAmount: 0, payable, dueDate: new Date(), createdById: by } });
  const claim = (who: string, amount: number) => prisma.expenseClaim.create({ data: { entityId: md.entityId, employeeId: who, spentOn: new Date("2019-05-05"), category: "FUEL", description: "probe", amount } as never });
  const ids: string[] = [], claims: string[] = [];
  try {
    const small = await inv("A", 12000, eng.id), big = await inv("B", 80000, eng.id), own = await inv("C", 900, fin.id);
    ids.push(small.id, big.id, own.id);
    check("the MD does not pay", /FINANCE_PAYS/.test(await msg(paySupplierInvoice({ id: small.id, actorCode: md.code }))));
    check("an engineer does not pay", /FINANCE_PAYS/.test(await msg(paySupplierInvoice({ id: small.id, actorCode: eng.code }))));
    check("finance pays an ordinary invoice", (await msg(paySupplierInvoice({ id: small.id, actorCode: fin.code }))) === "ok");
    check("above 50,000 THB waits for the MD", /PAY_NEEDS_MD/.test(await msg(paySupplierInvoice({ id: big.id, actorCode: fin.code }))));
    check("finance cannot release it", /MD_ONLY/.test(await msg(approvePayment({ id: big.id, actorCode: fin.code }))));
    await approvePayment({ id: big.id, actorCode: md.code });
    check("released by the MD, finance pays it", (await msg(paySupplierInvoice({ id: big.id, actorCode: fin.code }))) === "ok");
    check("the person who registered an invoice does not pay it alone", /PAY_NEEDS_MD/.test(await msg(paySupplierInvoice({ id: own.id, actorCode: fin.code }))));
    check("another finance person may", (await msg(paySupplierInvoice({ id: own.id, actorCode: fin2.code }))) === "ok");

    const c1 = await claim(eng.id, 800), c2 = await claim(eng.id, 60000), c3 = await claim(fin.id, 500);
    claims.push(c1.id, c2.id, c3.id);
    await decideExpense({ id: c1.id, actorCode: mgr.code, decision: "APPROVED" });
    check("a manager cannot approve a claim above 50,000", /EXPENSE_NEEDS_MD/.test(await msg(decideExpense({ id: c2.id, actorCode: mgr.code, decision: "APPROVED" }))));
    check("the MD does not pay an engineer's claim", /FINANCE_PAYS/.test(await msg(payExpense({ id: c1.id, actorCode: md.code }))));
    check("finance pays it", (await msg(payExpense({ id: c1.id, actorCode: fin.code }))) === "ok");
    await decideExpense({ id: c3.id, actorCode: md.code, decision: "APPROVED" });
    check("finance does not pay their own claim", /EXPENSE_OWN_PAY/.test(await msg(payExpense({ id: c3.id, actorCode: fin.code }))));
    check("the MD pays the finance person's claim", (await msg(payExpense({ id: c3.id, actorCode: md.code }))) === "ok");
  } finally {
    const paid = await prisma.supplierInvoice.findMany({ where: { id: { in: ids } }, select: { paymentNo: true } });
    const nos = paid.map((p) => p.paymentNo).filter((n): n is string => !!n).sort().reverse();
    await prisma.document.deleteMany({ where: { no: { in: nos } } });
    for (const n of nos) await prisma.docSequence.updateMany({ where: { prefix: "PV", last: Number(n.slice(-2)) }, data: { last: { decrement: 1 } } }).catch(() => null);
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: ids } } });
    await prisma.expenseClaim.deleteMany({ where: { id: { in: claims } } });
    for (const x of [eng, mgr, fin, fin2]) { await prisma.auditLog.deleteMany({ where: { actorId: x.id } }); await prisma.employee.delete({ where: { id: x.id } }); }
    await prisma.auditLog.deleteMany({ where: { actorId: md.id, target: { startsWith: `MP-${tag}` } } });
  }
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
