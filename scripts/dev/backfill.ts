/**
 * Idempotent data fixes that follow a schema change. The dev container runs this after every `prisma db push`
 * (scripts/dev/container-entry.sh), so a merged PR brings old rows along without anyone running anything.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/db";
import { parseDbdResponse } from "../../src/server/dbd";
import { ensureCategories } from "../../src/server/knowledge";
import { searchTextOf, slugify } from "../../src/lib/knowledge";

async function main() {
  // 2026-11-15 暂估应付: POTHs received before accruals existed get theirs (idempotent — one row per POTH, kept in step).
  { const { syncAccrual } = await import("../../src/server/srm"); let n = 0;
    for (const po of await prisma.purchaseOrder.findMany({ where: { kind: "PARTS", status: { in: ["PARTIAL", "RECEIVED"] } }, select: { id: true, receipts: { orderBy: { movedAt: "desc" }, take: 1, select: { movedAt: true } }, invoices: { where: { accrued: true }, select: { id: true } } } })) {
      if (po.invoices.length) continue;
      if (await syncAccrual(po.id, po.receipts[0]?.movedAt)) n++;
    }
    console.log(`backfill: ${n} 暂估应付 written for goods already received`); }

  // 2026-11-17 所有 PO 都要 MD 审批: POs that had already gone out before the rule stand as approved (by the rule's date).
  { const n = await prisma.purchaseOrder.updateMany({ where: { approvedAt: null, status: { in: ["SENT", "PARTIAL", "RECEIVED"] } }, data: { approvedAt: new Date(), approvedBy: "before-rule" } });
    console.log(`backfill: ${n.count} purchase order(s) already sent before the approval rule marked approved`); }

  // 2026-11-17 记账汇率标明「中国银行价 + 日期」: documents written before the rate's day was kept get it from the rate
  // table — the newest Bank of China row with exactly that rate, on or before the document's day.
  { let n = 0;
    const dayOf = async (currency: string, rate: unknown, at: Date) => currency === "CNY" ? new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
      : (await prisma.fxRate.findFirst({ where: { currency, source: "BOC", rateToCny: rate as never, rateDate: { lte: new Date(at.getTime() + 86400000) } }, orderBy: { rateDate: "desc" } }))?.rateDate;
    for (const o of await prisma.serviceOrder.findMany({ where: { fxRateToCny: { not: null }, fxSource: null }, select: { id: true, currency: true, fxRateToCny: true, updatedAt: true } })) { const d = await dayOf(o.currency, o.fxRateToCny, o.updatedAt); if (d) { await prisma.$executeRaw`UPDATE "ServiceOrder" SET "fxRateDate" = ${d}::date, "fxSource" = 'BOC' WHERE id = ${o.id}`; n++; } } // raw: updatedAt stays what it was
    for (const o of await prisma.purchaseOrder.findMany({ where: { fxRateToCny: { not: null }, fxSource: null }, select: { id: true, currency: true, fxRateToCny: true, createdAt: true } })) { const d = await dayOf(o.currency, o.fxRateToCny, o.createdAt); if (d) { await prisma.purchaseOrder.update({ where: { id: o.id }, data: { fxRateDate: d, fxSource: "BOC" } }); n++; } }
    for (const o of await prisma.taxInvoice.findMany({ where: { fxSource: null }, select: { id: true, currency: true, fxRateToCny: true, issuedAt: true } })) { const d = await dayOf(o.currency, o.fxRateToCny, o.issuedAt); if (d) { await prisma.taxInvoice.update({ where: { id: o.id }, data: { fxRateDate: d, fxSource: "BOC" } }); n++; } }
    console.log(`backfill: ${n} document(s) given the day of their Bank of China rate`); }

  // 2026-11-17 付款三步: invoices paid before the rule get their payment row (PAID, "before-rule"), so that the amount
  // paid is on file and a payment entered by mistake can be reversed (冲回) like any other.
  { let n = 0;
    for (const inv of await prisma.supplierInvoice.findMany({ where: { status: "PAID", payments: { none: {} } } })) {
      const no = inv.paymentNo ?? `PV-${inv.invoiceNo}`;
      if (await prisma.supplierPayment.findUnique({ where: { no } })) continue;
      await prisma.supplierPayment.create({ data: { no, entityId: inv.entityId, supplierInvoiceId: inv.id, account: "before-rule", amount: inv.payable, whtAmount: inv.whtAmount, payDate: inv.paidAt ?? new Date(), status: "PAID", requestedBy: "before-rule", paidBy: "before-rule", paidAt: inv.paidAt, paymentRef: inv.paymentRef } });
      await prisma.supplierInvoice.update({ where: { id: inv.id }, data: { paidAmount: inv.payable } }); n++;
    }
    console.log(`backfill: ${n} payment(s) made before the three-step rule put on file`); }

  // 2026-11-17 需求清单 v4 V4-P0-02: 负责销售. A customer whose orders all belong to one Sales person is theirs; the rest
  // stay with the MD until he says who (customer page).
  { let n = 0;
    for (const c of await prisma.customer.findMany({ where: { salesId: null }, select: { id: true, serviceOrders: { select: { salesId: true, sales: { select: { role: true, extraRoles: true } } } } } })) {
      const owners = [...new Set(c.serviceOrders.filter((o) => o.salesId && (o.sales?.role === "SALES" || o.sales?.extraRoles.includes("SALES"))).map((o) => o.salesId!))];
      if (owners.length === 1) { await prisma.customer.update({ where: { id: c.id }, data: { salesId: owners[0] } }); n++; }
    }
    console.log(`backfill: ${n} customer(s) given to the Sales person of their orders`); }

  // 2026-11-16 六角色 (朱总 16:31): 内勤 → Sales, 仓库 → PUR, 经理 → ENG + 本组审批人; whoever has people reporting to them approves for them.
  { const moved: string[] = [];
    for (const [from, to, approver] of [["ADMIN", "SALES", false], ["WAREHOUSE", "PURCHASING", false], ["MANAGER", "ENGINEER", true]] as const) {
      const n = await prisma.employee.updateMany({ where: { role: from }, data: { role: to, ...(approver ? { approver: true } : {}) } });
      if (n.count) moved.push(`${n.count} ${from} → ${to}`);
    }
    const leads = await prisma.employee.updateMany({ where: { approver: false, reports: { some: {} } }, data: { approver: true } });
    await prisma.roleMenu.deleteMany({ where: { role: { in: ["ADMIN", "WAREHOUSE", "MANAGER"] } } });
    console.log(`backfill: six roles — ${moved.join(", ") || "nobody to move"}; ${leads.count} more team approver(s)`); }

  // 2026-11-16 需求清单 v3 P0-16 / P1-22: every live tax invoice has its 请款单 (older ones were issued without), and
  // "paid" is said only of invoices with nothing left to collect (a part payment used to stamp paidAt).
  { const { writeInvoice, outstandingOf } = await import("../../src/server/to"); let made = 0, cleared = 0;
    for (const ti of await prisma.taxInvoice.findMany({ where: { voidedAt: null, invoices: { none: {} } }, include: { serviceOrder: { include: { customer: true } } } })) {
      const loose = await prisma.invoice.findFirst({ where: { serviceOrderId: ti.serviceOrderId, taxInvoiceId: null, cancelledAt: null } }); // billed before the tax invoice: tie the two, do not bill twice
      if (loose) { await prisma.invoice.update({ where: { id: loose.id }, data: { taxInvoiceId: ti.id } }); continue; }
      const doc = await prisma.document.findFirst({ where: { no: ti.no }, select: { createdBy: { select: { id: true, code: true } } } });
      const actor = doc?.createdBy; if (!actor) continue;
      await prisma.$transaction((tx) => writeInvoice(tx, { order: ti.serviceOrder, actor, issuedAt: ti.issuedAt, taxInvoice: ti })); made++;
    }
    for (const i of await prisma.invoice.findMany({ where: { paidAt: { not: null }, cancelledAt: null } })) if (outstandingOf(i) > 0.005) { await prisma.invoice.update({ where: { id: i.id }, data: { paidAt: null } }); cleared++; }
    console.log(`backfill: ${made} 请款单 written for tax invoices that had none, ${cleared} part-paid invoice(s) no longer marked paid`); }

  // 2026-11-09 business modes: orders created before modes existed take the mode their kind implies.
  const m = await prisma.serviceOrder.updateMany({ where: { mode: "REPAIR", kind: { in: ["MAINTENANCE", "OVERHAUL", "CONTRACT"] } }, data: { mode: "MAINTENANCE" } });
  const t = await prisma.serviceOrder.updateMany({ where: { mode: "REPAIR", kind: "PARTS_SALE" }, data: { mode: "DOMESTIC_TRADE" } });
  console.log(`backfill: ${m.count} orders → 维保, ${t.count} → 国内贸易`);

  // 2026-11-10 knowledge base: categories, URL names for brands and series, and old fault codes into the review flow.
  await ensureCategories();
  for (const b of await prisma.brand.findMany({ where: { slug: null } })) await prisma.brand.update({ where: { id: b.id }, data: { slug: await freeSlug(slugify(b.name), (x) => prisma.brand.count({ where: { slug: x } })) } });
  for (const s of await prisma.series.findMany({ where: { slug: null } })) await prisma.series.update({ where: { id: s.id }, data: { slug: await freeSlug(slugify(s.name), (x) => prisma.series.count({ where: { brandId: s.brandId, slug: x } })) } });
  const old = await prisma.faultCode.findMany({ where: { publicText: { equals: Prisma.DbNull } } });
  for (const c of old) {
    await prisma.faultCode.update({ where: { id: c.id }, data: {
      status: c.reviewed ? "APPROVED" : "DRAFT",
      publicText: { zh: { title: c.title, ...(c.meaning ? { meaning: c.meaning } : {}), ...(c.firstChecks ? { checks: c.firstChecks.split(/\r?\n|；|;/).map((x) => x.trim()).filter(Boolean) } : {}) } },
      searchText: searchTextOf([c.code, c.title, c.meaning, c.firstChecks]),
    } });
  }
  console.log(`backfill: ${old.length} fault codes moved into the knowledge base`);
  // 朱总 2026-11-14: the company's Thai name is ตูเฉิง — the master data carried a stray tone mark (ตู้เฉิง) and every printed document showed it
  const named = await prisma.$executeRaw`UPDATE "LegalEntity" SET "nameLocal" = replace("nameLocal", 'ตู้เฉิง', 'ตูเฉิง') WHERE "nameLocal" LIKE '%ตู้เฉิง%'`;
  console.log(`backfill: ${named} legal entity name(s) corrected to ตูเฉิง`);
  // 2026-11-14: registered addresses read from DBD stopped at the moo ("7/666 หมู่ที่ 6"); the stored registry answer
  // has the sub-district, district and province, so the short ones are completed from it
  let longer = 0;
  for (const c of await prisma.customer.findMany({ where: { dbdData: { not: Prisma.DbNull }, addressLocal: { not: null } }, select: { id: true, addressLocal: true, billingAddress: true, dbdData: true } })) {
    const full = parseDbdResponse(c.dbdData)?.addressTh;
    const cur = c.addressLocal!.replace(/\s+/g, " ").trim();
    if (!full || full === cur || !full.startsWith(cur)) continue;
    await prisma.customer.update({ where: { id: c.id }, data: { addressLocal: full, billingAddress: c.billingAddress?.replace(/\s+/g, " ").trim() === cur ? full : undefined } });
    longer++;
  }
  console.log(`backfill: ${longer} registered address(es) completed with sub-district, district and province`);
}

async function freeSlug(base: string, taken: (s: string) => Promise<number>) {
  for (let i = 1; ; i++) { const s = i === 1 ? base : `${base}-${i}`; if (!(await taken(s))) return s; }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
