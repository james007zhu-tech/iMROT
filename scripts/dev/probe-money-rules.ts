/** 钱的规矩: 付款三步、两人 (MD 2026-11-17) — finance asks with an account, the MD approves every amount, finance confirms with the slip; nobody pays their own claim. */
import { prisma } from "../../src/lib/db";
import { confirmPayment, decidePayment, requestPayment, voidPayment } from "../../src/server/pay";
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
    const slip = [{ name: "slip.jpg", url: "/uploads/probe-slip.jpg" }];
    const ask = (id: string, who: string, extra: { account?: string; amount?: number } = {}) => requestPayment({ invoiceId: id, actorCode: who, account: "account" in extra ? extra.account! : "CASH", amount: extra.amount });
    check("the MD does not start a payment", /FINANCE_PAYS/.test(await msg(ask(small.id, md.code))));
    check("an engineer does not start a payment", /FINANCE_PAYS/.test(await msg(ask(small.id, eng.code))));
    check("no account chosen: refused", /PAY_ACCOUNT_REQUIRED/.test(await msg(ask(small.id, fin.code, { account: "" }))));
    check("an account that is not ours: refused", /PAY_ACCOUNT_REQUIRED/.test(await msg(ask(small.id, fin.code, { account: "SOMEWHERE" }))));
    check("more than what is open: refused", /PAY_OVER/.test(await msg(ask(small.id, fin.code, { amount: 12000.5 }))));
    // one baht
    const one = await ask(own.id, fin.code, { amount: 1 });
    const st = async (id: string) => (await prisma.supplierInvoice.findUniqueOrThrow({ where: { id } }));
    check("asking pays nothing: a PVTH, REQUESTED, the invoice untouched", /^PVTH/.test(one.no) && one.status === "REQUESTED" && (await st(own.id)).status === "OPEN" && Number((await st(own.id)).paidAmount) === 0, one.no);
    check("1 baht cannot be confirmed before the MD approves", /PAY_NEEDS_MD/.test(await msg(confirmPayment({ id: one.id, actorCode: fin.code, paymentRef: "x", slip }))));
    check("finance cannot approve", /MD_ONLY/.test(await msg(decidePayment({ id: one.id, actorCode: fin.code, approve: true }))));
    check("a refusal needs a reason", /REASON_REQUIRED/.test(await msg(decidePayment({ id: one.id, actorCode: md.code, approve: false }))));
    await decidePayment({ id: one.id, actorCode: md.code, approve: true });
    check("approved is still not paid", (await st(own.id)).status === "OPEN" && Number((await st(own.id)).paidAmount) === 0);
    check("the MD does not confirm", /FINANCE_PAYS/.test(await msg(confirmPayment({ id: one.id, actorCode: md.code, paymentRef: "x", slip }))));
    check("no bank slip: not paid", /PAY_SLIP_REQUIRED/.test(await msg(confirmPayment({ id: one.id, actorCode: fin.code, paymentRef: "x", slip: [] }))));
    check("no transfer reference: not paid", /PAY_REF_REQUIRED/.test(await msg(confirmPayment({ id: one.id, actorCode: fin.code, paymentRef: " ", slip }))));
    await confirmPayment({ id: one.id, actorCode: fin.code, paymentRef: "TRX-1", slip });
    const part = await st(own.id);
    check("with slip and reference: 1 paid of 900, 899 open, the invoice stays open", part.status === "OPEN" && Number(part.paidAmount) === 1, `${part.status} ${part.paidAmount}`);
    check("the rest cannot be over-asked", /PAY_OVER/.test(await msg(ask(own.id, fin.code, { amount: 900 }))));
    const rest = await ask(own.id, fin.code);
    check("the rest defaults to what is open (899)", Number(rest.amount) === 899, String(rest.amount));
    check("while it waits, nothing more can be asked", /PAY_AMOUNT_REQUIRED|PAY_OVER/.test(await msg(ask(own.id, fin.code))));
    await decidePayment({ id: rest.id, actorCode: md.code, approve: true });
    await confirmPayment({ id: rest.id, actorCode: fin.code, paymentRef: "TRX-2", slip });
    check("the second payment settles it: PAID", (await st(own.id)).status === "PAID" && Number((await st(own.id)).paidAmount) === 900);
    // 冲回
    check("a reversal needs a reason", /REASON_REQUIRED/.test(await msg(voidPayment({ id: rest.id, actorCode: fin.code, reason: "" }))));
    check("an engineer cannot reverse", /NO_PERMISSION/.test(await msg(voidPayment({ id: rest.id, actorCode: eng.code, reason: "x" }))));
    await voidPayment({ id: rest.id, actorCode: md.code, reason: "probe: entered by mistake" });
    const back = await st(own.id);
    check("reversed: the invoice is open again with 899 to pay, the PVTH stays as VOID", back.status === "OPEN" && Number(back.paidAmount) === 1 && (await prisma.supplierPayment.findUniqueOrThrow({ where: { id: rest.id } })).status === "VOID", `${back.status} ${back.paidAmount}`);
    // refused by the MD
    const r = await ask(big.id, fin.code);
    await decidePayment({ id: r.id, actorCode: md.code, approve: false, note: "probe: wrong supplier account" });
    check("refused by the MD: cannot be confirmed, the invoice can be asked again", /PAY_NOT_WAITING/.test(await msg(confirmPayment({ id: r.id, actorCode: fin.code, paymentRef: "x", slip }))) && (await msg(ask(big.id, fin.code).then((p) => voidPayment({ id: p.id, actorCode: fin.code, reason: "probe" })))) === "ok");
    // withholding tax → 50 ทวิ
    const w = await prisma.supplierInvoice.create({ data: { entityId: po.entityId, supplierId: po.supplierId, purchaseOrderId: po.id, invoiceNo: `MP-${tag}-W`, invoiceDate: new Date(), subtotal: 10000, vatAmount: 700, total: 10700, whtRate: 0.03, whtAmount: 300, payable: 10400, dueDate: new Date(), createdById: eng.id } });
    ids.push(w.id);
    const wp = await ask(w.id, fin.code);
    check("with withholding tax the 50 ทวิ number comes by itself (WT…), 300 withheld", /^WTTH/.test(wp.whtCertNo ?? "") && Number(wp.whtAmount) === 300 && Number(wp.amount) === 10400, `${wp.whtCertNo} ${wp.whtAmount}`);
    check("without withholding tax there is none", one.whtCertNo === null);
    const half = await ask(small.id, fin.code, { amount: 6000 });
    check("an invoice without WHT, half asked: no certificate", half.whtCertNo === null && Number(half.amount) === 6000);

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
    const pays = await prisma.supplierPayment.findMany({ where: { supplierInvoiceId: { in: ids } } });
    const nos = pays.map((p) => p.no).sort().reverse();
    await prisma.document.deleteMany({ where: { no: { in: nos } } });
    for (const n of nos) await prisma.docSequence.updateMany({ where: { prefix: "PV", last: Number(n.slice(-2)) }, data: { last: { decrement: 1 } } }).catch(() => null);
    await prisma.docSequence.updateMany({ where: { prefix: "WT" }, data: { last: { decrement: pays.filter((p) => p.whtCertNo).length } } }).catch(() => null);
    await prisma.auditLog.deleteMany({ where: { target: { in: nos } } });
    await prisma.supplierInvoice.deleteMany({ where: { id: { in: ids } } });
    await prisma.expenseClaim.deleteMany({ where: { id: { in: claims } } });
    for (const x of [eng, mgr, fin, fin2]) { await prisma.auditLog.deleteMany({ where: { actorId: x.id } }); await prisma.employee.delete({ where: { id: x.id } }); }
    await prisma.auditLog.deleteMany({ where: { actorId: md.id, target: { startsWith: `MP-${tag}` } } });
  }
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})();
