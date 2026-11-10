/**
 * AI actions end to end without the model: the same calls the assistant makes (src/server/ai-actions.ts).
 * Overseas customer → export order with lines → quote → customer PO → pro-forma; then a domestic sale through
 * delivery to the tax invoice, which must wait for confirmation and run exactly once.  npx tsx scripts/dev/probe-ai-actions.ts
 */
import { prisma } from "@/lib/db";
import { decideAction, documentChain, runAction } from "@/server/ai-actions";

const ctx = { employeeCode: process.env.PROBE_ACTOR ?? "ETH2611001" };
let failed = 0;
const check = (name: string, ok: boolean, detail = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failed++; };

(async () => {
  const tag = Date.now().toString(36).toUpperCase();
  const cust = await runAction("create_customer", { name: `AI Probe Machinery ${tag} Co., Ltd.`, overseas: true, addressEn: "25 Tran Hung Dao, Hanoi, Vietnam", contacts: [{ name: `An ${tag}`, email: "an@example.vn", birthday: "11-25" }] }, ctx);
  check("create_customer (overseas, with a contact and birthday)", !!cust.ok && /^C/.test(cust.summary), cust.summary);
  const code = (cust.data as { code: string }).code;
  const dupe = await runAction("create_customer", { name: `AI Probe Machinery ${tag} Co., Ltd.`, overseas: true }, ctx).catch((e) => String(e.message));
  check("the same customer twice is refused", typeof dupe === "string" && /CUSTOMER_EXISTS/.test(dupe), String(dupe).slice(0, 60));

  const ord = await runAction("create_order", { mode: "INTERNATIONAL_TRADE", customer: `ai probe machinery ${tag}`, customerRef: `RFQ-${tag}`, contactName: `An ${tag}`,
    lines: [{ sku: "6SL3210-1PE21-8UL0", description: "SINAMICS G120 PM240-2 7.5kW", qty: 4, unit: "pcs", neededBy: "2026-12-15", hsCode: "8504.40", origin: "DE" }],
    tradeTerms: { currency: "USD", incoterm: "CIF", place: "Hai Phong", destCountry: "Vietnam", destPort: "Hai Phong", shipMode: "SEA", paymentTerms: "T/T 30% advance, 70% before shipment", paymentDays: 0 } }, ctx);
  const no = (ord.data as { no: string }).no;
  const o1 = await prisma.serviceOrder.findUniqueOrThrow({ where: { no } });
  check("create_order finds the customer by part of its name, keeps lines and terms", o1.currency === "USD" && (o1.requestLines as unknown[]).length === 1 && o1.customerRef === `RFQ-${tag}` && !!o1.reportedById, `${no} ${o1.currency}`);
  const missing = await runAction("create_order", { mode: "INTERNATIONAL_TRADE", customer: code, lines: [{ description: "x", qty: 1 }], tradeTerms: { currency: "USD" } }, ctx).catch((e) => String(e.message));
  check("missing trade terms come back as an error the model can ask about", /TRADE_TERMS_REQUIRED/.test(String(missing)), String(missing).slice(0, 50));

  const q = await runAction("set_quote", { no, lines: [{ description: "SINAMICS G120 PM240-2 7.5kW 6SL3210-1PE21-8UL0", qty: 4, unit: "pcs", unitPrice: 1500, unitCost: 1100 }] }, ctx);
  const o2 = await prisma.serviceOrder.findUniqueOrThrow({ where: { no } });
  check("set_quote prices the order, zero VAT on export, status QUOTE_PENDING", o2.status === "QUOTE_PENDING" && Number(o2.total) === 6000 && Number(o2.vatAmount) === 0, q.summary);
  await runAction("confirm_customer_po", { no, customerRef: `PO-${tag}` }, ctx);
  const pf = await runAction("issue_proforma", { no }, ctx).catch((e) => ({ ok: undefined, summary: String(e.message) }));
  const chain = (await documentChain(no)) as { documents: { no: string; type: string }[] };
  check("customer PO starts the work; the pro-forma is in the document chain", (await prisma.serviceOrder.findUniqueOrThrow({ where: { no } })).status === "IN_PROGRESS" && chain.documents.some((d) => d.type === "PF"), `${pf.summary} · chain ${chain.documents.map((d) => d.no).join(" → ")}`);

  // confirm tier: parked, owner only, once
  const park = await runAction("issue_tax_invoice", { no }, ctx);
  const before = await prisma.taxInvoice.count({ where: { serviceOrder: { no } } });
  check("issue_tax_invoice is parked, nothing issued", !!park.pending && before === 0, park.summary);
  const other = await prisma.employee.findFirst({ where: { active: true, code: { not: ctx.employeeCode } } });
  const stranger = other ? await decideAction(park.pending!, other.code, true).catch((e) => String(e.message)) : "AI_ACTION_NOT_FOUND";
  check("another person cannot confirm it", /AI_ACTION_NOT_FOUND/.test(String(stranger)));
  const run = await decideAction(park.pending!, ctx.employeeCode, true).catch((e) => String(e.message));
  check("confirming runs the real rule (an export order takes no Thai tax invoice) and records the failure", typeof run === "string" && (await prisma.aiAction.findUniqueOrThrow({ where: { id: park.pending! } })).status === "FAILED", String(run).slice(0, 60));
  const again = await decideAction(park.pending!, ctx.employeeCode, true).catch((e) => String(e.message));
  check("a decided action cannot run again", /AI_ACTION_FAILED/.test(String(again)));
  const park2 = await runAction("record_payment", { invoiceNo: "IVTH00000000", paidAt: "2026-11-10", paidAmount: 100 }, ctx);
  await decideAction(park2.pending!, ctx.employeeCode, false);
  check("cancel leaves it cancelled", (await prisma.aiAction.findUniqueOrThrow({ where: { id: park2.pending! } })).status === "CANCELLED");
  const logs = await prisma.auditLog.count({ where: { action: { startsWith: "AI:" }, actor: { code: ctx.employeeCode } } });
  check("every executed action is in the audit log", logs >= 5, `${logs} entries`);
  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
})();
