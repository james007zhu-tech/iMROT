/**
 * 统一角色权限表 (需求清单 v3 第 1 节, P0-01～04, P0-12, P1-06): what each role may see and do, checked at the server —
 * the functions the pages call, the scope of orders, and what an API answer contains. npx tsx scripts/dev/probe-perms.ts
 */
import { prisma } from "../../src/lib/db";
import { onboardAsset } from "../../src/server/alm";
import { advanceServiceOrder, confirmCustomerPo, createServiceOrder, getServiceOrder, poLinesFromQuote } from "../../src/server/slm";
import { createInspection, recordAcceptance, suggestPrice } from "../../src/server/slm-docs";
import { issueTaxInvoice } from "./_probe";
import { recordPayment } from "./_probe";
import { createCustomer } from "../../src/server/crm";
import { createPurchaseOrder, createSupplier } from "../../src/server/purchasing";
import { recordStockDoc } from "../../src/server/scm";
import { createEmployee, updateEmployee } from "../../src/server/opd";
import { issueResetLink } from "../../src/server/password-reset";
import { hiddenFor } from "../../src/server/perm";
import { mayOpenOrder, mayAccept, customerScope, assetScope, orderScope, docTypeAllowed } from "../../src/server/scope";
import { stripMoney } from "../../src/lib/caps";
import { noticesFor } from "../../src/server/notify";
import { allocateNumber } from "../../src/lib/numbering-db";
import { setQuoteLines } from "./_probe";

let bad = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) bad++; };
const msg = (p: Promise<unknown>) => p.then(() => "ok", (e) => String(e.message).split("\n")[0]);

(async () => {
  const md = await prisma.employee.findUniqueOrThrow({ where: { code: "ETH2611001" } });
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { id: md.entityId } });
  const tag = Date.now().toString().slice(-6);
  let n = 0;
  const mk = (role: string, managerId?: string, more: object = {}) => prisma.employee.create({ data: { ...more, code: `ETH14${tag.slice(-3)}${String(++n).padStart(2, "0")}`, entityId: md.entityId, name: `TEST Perm ${role} ${tag}`, role: role as never, managerId: managerId ?? md.id, joinedAt: new Date("2030-01-01") } });
  const mgr = await mk("ENGINEER", undefined, { approver: true }), e1 = await mk("ENGINEER", mgr.id), e2 = await mk("ENGINEER"), sales = await mk("SALES"), adm = await mk("SALES", undefined, { extraRoles: ["PURCHASING"] }), hr = await mk("HR"), fin = await mk("FINANCE"), wh = await mk("PURCHASING");
  const made: string[] = [];
  try {
    const customer = await prisma.$transaction(async (tx) => { const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: md.code, entityId: entity.id }); return tx.customer.create({ data: { code, entityId: entity.id, name: `TEST Perm Customer ${tag}`, taxId: "0105566666666", branchCode: "00000", paymentTermDays: 30 } }); });
    const model = await prisma.model.findFirstOrThrow();
    const part = await prisma.part.create({ data: { sku: `GEN-TEST-PERM-${tag}`, vendorPartNo: `TEST-PERM-${tag}`, name: "TEST perm fan" } });
    await recordStockDoc({ actorCode: md.code, direction: "IN", lines: [{ partSku: part.sku, qty: 5, unitCost: 6543.21 }] });
    const vfd = await onboardAsset({ createdByEmployeeCode: md.code, type: "VFD", serialNumber: `TESTPERM-${tag}`, modelId: model.id, customerId: customer.id, origin: "TAKEOVER" });
    check("V4-P0-02 Sales cannot open an order for a customer that is not theirs", /NO_PERMISSION/.test(await msg(createServiceOrder({ createdByEmployeeCode: sales.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "TEST trips" }))));
    await prisma.customer.update({ where: { id: customer.id }, data: { salesId: sales.id } });
    const o = await createServiceOrder({ createdByEmployeeCode: sales.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "TEST trips" });
    made.push(o.no);
    await advanceServiceOrder(o.no, "ASSIGNED", md.code, undefined, e1.code);
    await createInspection({ serviceOrderNo: o.no, assetCode: vfd.code, engineerCode: e1.code, findings: "fan dead" });

    console.log("1. 数据范围");
    { const idv = (await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).id;
      check("V4-P0-02 the customer's Sales person sees the order; a person who is Sales + PUR sees all orders but not this customer", (await mayOpenOrder(sales, idv)) && (await mayOpenOrder(adm, idv)) && (await prisma.customer.count({ where: { AND: [{ id: customer.id }, await customerScope(adm)] } })) === 0 && (await prisma.customer.count({ where: { AND: [{ id: customer.id }, await customerScope(sales)] } })) === 1);
      check("V4-P0-02 HR and PUR see no customer and no machine; the engineer sees this one", (await prisma.customer.count({ where: await customerScope(hr) })) === 0 && (await prisma.customer.count({ where: await customerScope(wh) })) === 0 && (await prisma.asset.count({ where: await assetScope(hr) })) === 0 && (await prisma.asset.count({ where: { AND: [{ code: vfd.code }, await assetScope(e1)] } })) === 1 && (await prisma.asset.count({ where: { AND: [{ code: vfd.code }, await assetScope(e2)] } })) === 0);
      check("V4-P0-02 an engineer opens repair and maintenance only, and only for their customers", /NO_PERMISSION/.test(await msg(createServiceOrder({ createdByEmployeeCode: e1.code, customerId: customer.id, mode: "DOMESTIC_TRADE", requestLines: [{ sku: part.sku, qty: 1, unit: "pcs" }] } as never))) && /NO_PERMISSION/.test(await msg(createServiceOrder({ createdByEmployeeCode: e2.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "x" }))) && /NO_PERMISSION/.test(await msg(createServiceOrder({ createdByEmployeeCode: hr.code, customerId: customer.id, assetCodes: [vfd.code], kind: "REPAIR", reportedSymptom: "x" }))));
      check("V4-P0-03 PUR, FIN and HR cannot sign an acceptance; the engineer and Sales of the order can", !(await mayAccept(wh, idv)) && !(await mayAccept(fin, idv)) && !(await mayAccept(hr, idv)) && !(await mayAccept(e2, idv)) && (await mayAccept(e1, idv)) && (await mayAccept(sales, idv)) && (await mayAccept(mgr, idv)));
      check("V4-P0-03 recordAcceptance refuses PUR on the server", /NO_PERMISSION/.test(await msg(recordAcceptance({ serviceOrderNo: o.no, actorCode: wh.code, status: "ACCEPTED", signedByName: "x" } as never))));
      check("V4-P0-04 documents by the menu table: PUR has IB / OB / PO, not QT / TI; FIN all; ENG its OB, no PO; HR none", docTypeAllowed(wh, "IB") && docTypeAllowed(wh, "OB") && docTypeAllowed(wh, "PO") && !docTypeAllowed(wh, "TI") && docTypeAllowed(fin, "PV") && docTypeAllowed(fin, "IB") && docTypeAllowed(e1, "OB") && !docTypeAllowed(e1, "PO") && !docTypeAllowed(e1, "TI") && docTypeAllowed(sales, "DN") && !docTypeAllowed(hr, "IB"));
    }
    const id = (await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } })).id;
    check("the assigned engineer opens the order; another engineer does not; the supervisor of the first does", (await mayOpenOrder(e1, id)) && !(await mayOpenOrder(e2, id)) && (await mayOpenOrder(mgr, id)));
    check("Sales, PUR, FIN see all orders; HR none", (await mayOpenOrder(sales, id)) && (await mayOpenOrder(wh, id)) && (await mayOpenOrder(fin, id)) && !(await mayOpenOrder(hr, id)));
    check("the other engineer's list does not contain it", (await prisma.serviceOrder.count({ where: { AND: [await orderScope(e2)], no: o.no } })) === 0);

    console.log("2. 定价是销售和 MD 的事");
    const items = await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: e1.code, lines: [{ assetCode: vfd.code, partSku: part.sku, description: "Fan", qty: 1, unitPrice: 99999, unitCost: 1 }, { description: "Labour", qty: 2, unit: "h", unitPrice: 88888 }] }));
    const after = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no }, include: { lines: true } });
    check("the engineer saves parts and hours; any price he sends is not taken, the order does not move", items === "ok" && after.lines.length === 2 && after.lines.every((l) => Number(l.unitPrice) === 0) && after.status === "DIAGNOSING", `${items} · ${after.status} · prices ${after.lines.map((l) => Number(l.unitPrice)).join("/")}`);
    check("sales is told a price is wanted", (await noticesFor(sales)).some((x) => x.kind === "needsPrice" && x.ref === o.no));
    await suggestPrice({ no: o.no, actorCode: e1.code, note: "customer says last time was cheaper" });
    check("建议改价 reaches sales", (await noticesFor(sales)).some((x) => x.kind === "priceHint" && x.ref === o.no));
    check("the other engineer cannot touch the quote", /NO_PERMISSION/.test(await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: e2.code, lines: [{ description: "x", qty: 1, unitPrice: 1 }] }))));
    check("finance and HR do not write quotes", /NO_PERMISSION/.test(await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: fin.code, lines: [{ description: "x", qty: 1, unitPrice: 1 }] }))) && /NO_PERMISSION/.test(await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: hr.code, lines: [{ description: "x", qty: 1, unitPrice: 1 }] }))));
    await setQuoteLines({ serviceOrderNo: o.no, actorCode: sales.code, lines: [{ assetCode: vfd.code, partSku: part.sku, description: "Fan", qty: 1, unitPrice: 12345.67 }, { description: "Labour", qty: 2, unit: "h", unitPrice: 1500 }] });
    const priced = await prisma.serviceOrder.findUniqueOrThrow({ where: { no: o.no } });
    check("sales prices it and it goes to the customer; the hint is cleared", priced.status === "QUOTE_PENDING" && priced.priceHint === null && Number(priced.subtotal) === 15345.67, `${priced.status} ${priced.subtotal}`);
    check("once the customer has the quote the engineer cannot change it", /QUOTE_PRICED_SALES_ONLY/.test(await msg(setQuoteLines({ serviceOrderNo: o.no, actorCode: e1.code, lines: [{ description: "Fan", qty: 3, unitPrice: 0 }] }))));
    const c1 = await msg(confirmCustomerPo({ no: o.no, actorCode: e1.code, poLines: await poLinesFromQuote(o.no) })), c2 = await msg(confirmCustomerPo({ no: o.no, actorCode: adm.code, customerRef: "TEST-PO", poLines: await poLinesFromQuote(o.no) }));
    check("the engineer cannot confirm the customer's PO; Sales can", /NO_PERMISSION/.test(c1) && c2 === "ok", `${c1} / ${c2}`.slice(0, 200));

    console.log("3. 开票、收款、关闭、建客户、采购");
    for (const [who, e] of [["engineer", e1], ["supervisor", mgr], ["sales", sales], ["Sales+PUR", adm], ["HR", hr], ["PUR", wh]] as const)
      check(`${who} cannot issue a tax invoice`, /NO_PERMISSION/.test(await msg(issueTaxInvoice({ serviceOrderNo: o.no, actorCode: e.code }))));
    check("the engineer cannot record a payment", /FINANCE_COLLECTS/.test(await msg((await import("../../src/server/collect")).requestReceipt({ invoiceNo: "TEST-IVTH00000000", actorCode: e1.code, account: "CASH", cashAmount: 1, receivedOn: new Date() }))));
    check("the engineer and the supervisor cannot close the order", /NO_PERMISSION/.test(await msg(advanceServiceOrder(o.no, "CLOSED", e1.code))) && /NO_PERMISSION/.test(await msg(advanceServiceOrder(o.no, "CLOSED", mgr.code))));
    const cc = await msg(createCustomer({ actorCode: e1.code, entityCode: entity.code, name: "TEST x" } as never));
    check("the engineer cannot create a customer", /NO_PERMISSION/.test(cc), cc.slice(0, 160));
    check("the engineer, Sales and FIN cannot raise a POTH or a supplier; a person who is Sales + PUR can", /NO_PERMISSION/.test(await msg(createPurchaseOrder({ actorCode: e1.code, supplierId: "x", lines: [] } as never))) && /NO_PERMISSION/.test(await msg(createPurchaseOrder({ actorCode: sales.code, supplierId: "x", lines: [] } as never))) && /NO_PERMISSION/.test(await msg(createSupplier({ actorCode: fin.code, name: "TEST x" }))) && !/NO_PERMISSION/.test(await msg(createPurchaseOrder({ actorCode: adm.code, supplierId: "x", lines: [] } as never))) && /NO_PERMISSION/.test(await msg(recordStockDoc({ actorCode: sales.code, direction: "IN", lines: [{ partSku: part.sku, qty: 1 }] }))) && /NO_PERMISSION/.test(await msg(createSupplier({ actorCode: e1.code, name: "TEST x" }))));
    await recordStockDoc({ actorCode: e1.code, direction: "IN", lines: [{ partSku: part.sku, qty: 1, unitCost: 1 }] });
    check("a unit cost typed by an engineer on a receipt is not taken", Number((await prisma.part.findUniqueOrThrow({ where: { sku: part.sku } })).lastCost) === 6543.21);

    console.log("4. 接口里没有这些数字");
    const full = JSON.parse(JSON.stringify(await getServiceOrder(o.no)));
    const forEng = JSON.stringify(stripMoney(full, "ENGINEER")), forPur = JSON.stringify(stripMoney(full, "PURCHASING")), forSales = JSON.stringify(stripMoney(full, "SALES"));
    check("engineer and supervisor: no price, no cost, no margin in the order", !/12345\.67|15345\.67|6543\.21|marginPct|costTotal|unitPrice/.test(forEng) && JSON.stringify(stripMoney(full, mgr)) === forEng);
    check("PUR: no price, no margin", !/12345\.67|15345\.67|marginPct|unitPrice/.test(forPur));
    check("Sales: price — no cost, no margin, never what we paid (派修单 v4 第 2 条)", /12345\.67/.test(forSales) && !/unitCost|costTotal|marginPct|lastCost|costRef|6543\.21/.test(forSales));

    console.log("5. 菜单和单据");
    const hid = async (r: string) => hiddenFor(r as never);
    const eng = await hid("ENGINEER"), mgrH = await hiddenFor(mgr), both = await hiddenFor(adm), hrH = await hid("HR"), finH = await hid("FINANCE");
    check("engineer and supervisor: no finance, tax, system menus", ["ledger", "cashPlan", "finReports", "billing", "taxInvoices", "receipts", "entities", "permissions", "paymentVouchers", "statements"].every((k) => eng.has(k) && mgrH.has(k)) && !eng.has("stock") && !eng.has("opportunities"));
    check("HR: staff and pay only; finance: no permissions page, has reports", hrH.has("customers") && hrH.has("opportunities") && !hrH.has("payroll") && !hrH.has("talent") && finH.has("permissions") && !finH.has("finReports") && !finH.has("entities"));
    check("two roles: the menu is the union", !both.has("customers") && !both.has("suppliers") && both.has("ledger") && (await hid("SALES")).has("suppliers") && (await hid("PURCHASING")).has("customers"));
    check("documents by role", !docTypeAllowed("ENGINEER", "TI") && !docTypeAllowed("ENGINEER", "QT") && docTypeAllowed("ENGINEER", "RP") && !docTypeAllowed("PURCHASING", "IV") && !docTypeAllowed("PURCHASING", "QT") && docTypeAllowed("SALES", "TI") && !docTypeAllowed("SALES", "PV") && !docTypeAllowed("HR", "RP"));

    console.log("6. HR");
    const newbie = await createEmployee({ actorCode: hr.code, entityCode: entity.code, name: `TEST Perm Newbie ${tag}`, role: "ENGINEER", email: `test.perm.${tag}@dcit.test` } as never);
    check("HR creates a staff file without ever typing a password", !!newbie.code);
    check("HR cannot create an MD, set a password, or change a role", /MD_ONLY/.test(await msg(createEmployee({ actorCode: hr.code, entityCode: entity.code, name: "x", role: "MD", email: `x${tag}@dcit.test` } as never))) && /MD_ONLY/.test(await msg(createEmployee({ actorCode: hr.code, entityCode: entity.code, name: "x", role: "ENGINEER", email: `y${tag}@dcit.test`, password: "secret12" } as never))) && /MD_ONLY/.test(await msg(updateEmployee({ actorCode: hr.code, code: newbie.code, role: "FINANCE" }))));
    check("HR hands out the link for a new person's own password, never for the MD", !!(await issueResetLink({ employeeCode: newbie.code, actorCode: hr.code })).token && /MD_ONLY/.test(await msg(issueResetLink({ employeeCode: md.code, actorCode: hr.code }))));
    check("an engineer cannot create staff", /STAFF_ONLY/.test(await msg(createEmployee({ actorCode: e1.code, entityCode: entity.code, name: "x", role: "ENGINEER", email: `z${tag}@dcit.test` } as never))));
    await prisma.passwordReset.deleteMany({ where: { employeeId: newbie.id } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: newbie.id }, { target: newbie.code }] } });
    await prisma.employee.delete({ where: { id: newbie.id } });
  } finally {
    for (const no of made) await prisma.serviceOrder.update({ where: { no }, data: { status: "CANCELLED" } }).catch(() => null);
    for (const x of [e1, e2, mgr, sales, adm, hr, fin, wh]) await prisma.employee.update({ where: { id: x.id }, data: { active: false } }).catch(() => null);
  }
  console.log(bad ? `\n${bad} FAILED` : "\nall passed");
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
