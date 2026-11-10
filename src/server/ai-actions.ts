/**
 * AI 动作 — what the assistant can DO, not only look up (方案 "iMROT 的 i", 朱总 2026-11-10: start wide, restrict later).
 * Every action calls the same server function as its page, so numbering, margin floor, locks and closures apply
 * unchanged, and it runs as the signed-in person. Two tiers:
 *   auto     runs at once; written to AuditLog as AI:<tool> (customer, contact, machine, order, assignment, quote,
 *            customer PO, supplier inquiry, delivery note, pro-forma)
 *   confirm  irreversible towards the tax office, the bank or the outside world (tax invoice + invoice, payment);
 *            stored as AiAction PENDING and executed when the person presses confirm (/api/ai/confirm)
 * A tool returns {ok, summary, href?} or {pending: id, summary}; errors go back to the model as text so it can ask.
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { addContact, createCustomer } from "@/server/crm";
import { onboardAsset, findModelByCode } from "@/server/alm";
import { advanceServiceOrder, catchUpOrder, confirmCustomerPo, createServiceOrder, poLinesFromQuote } from "@/server/slm";
import { setQuoteLines } from "@/server/slm-docs";
import { autoInquiryForOrder } from "@/server/purchasing";
import { deliveryPlan, issueDelivery, signDelivery } from "@/server/delivery";
import { issueProforma } from "@/server/export";
import { issueInvoice, issueTaxInvoice, recordPayment } from "@/server/to";
import { MODES } from "@/lib/modes";
import { addCredential, updateEmployee, updateOwnContacts } from "@/server/opd";

type In = Record<string, unknown>;
export interface ActionCtx { employeeCode: string }
export interface ActionResult { ok?: true; pending?: string; summary: string; href?: string; data?: unknown }
export interface ActionTool { name: string; tier: "auto" | "confirm"; description: string; input_schema: Record<string, unknown>; summarize?: (i: In) => string; run: (i: In, ctx: ActionCtx) => Promise<ActionResult> }

const str = (v: unknown) => (v == null ? undefined : String(v).trim() || undefined);
const num = (v: unknown) => (v == null || v === "" ? undefined : Number(v));
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required });
const S = { type: "string" }, N = { type: "number" };

/** One customer from a code or (part of) a name; several or none → an error the model can act on. */
async function customerBy(q: unknown) {
  const s = str(q);
  if (!s) throw new Error("customer is required (code or name)");
  const byCode = await prisma.customer.findUnique({ where: { code: s.toUpperCase() } });
  if (byCode) return byCode;
  const like = { contains: s.replace(/\b(co\.?,?\s*ltd\.?|company limited|limited|ltd\.?|pcl|inc\.?)\b/gi, "").trim(), mode: "insensitive" as const };
  const hits = await prisma.customer.findMany({ where: { OR: [{ name: like }, { nameLocal: like }] }, take: 6 });
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`no customer matches "${s}" — create it first with create_customer (ask for missing data)`);
  throw new Error(`several customers match "${s}": ${hits.map((h) => `${h.code} ${h.name}`).join("; ")} — ask which one`);
}

/** An employee from a code or (part of) a name; empty = the signed-in person. */
async function employeeBy(q: unknown, selfCode: string) {
  const s = str(q);
  if (!s || /^(me|self|我|本人|自己)$/i.test(s)) return prisma.employee.findUniqueOrThrow({ where: { code: selfCode } });
  const hits = await prisma.employee.findMany({ where: { OR: [{ code: s.toUpperCase() }, { name: { contains: s, mode: "insensitive" } }, { nameLocal: { contains: s, mode: "insensitive" } }] }, take: 5 });
  if (hits.length === 1) return hits[0];
  throw new Error(hits.length ? `several employees match "${s}": ${hits.map((h) => `${h.code} ${h.name}`).join("; ")} — ask which one` : `no employee matches "${s}"`);
}

const TOOLS: ActionTool[] = [
  { name: "create_customer", tier: "auto",
    description: "Create a customer file. Thai companies need the 13-digit tax ID and the Thai name; overseas companies (overseas=true) need only the name. Contacts are optional.",
    input_schema: obj({ name: S, nameLocal: S, overseas: { type: "boolean" }, taxId: S, branchCode: S, addressEn: S, addressLocal: S, phone: S, paymentTermDays: N, currency: S, contacts: { type: "array", items: obj({ name: S, title: S, phone: S, email: S, birthday: { type: "string", description: "MM-DD" } }, ["name"]) } }, ["name"]),
    run: async (i, ctx) => {
      const actor = await prisma.employee.findUniqueOrThrow({ where: { code: ctx.employeeCode }, include: { entity: true } });
      const c = await createCustomer({ actorCode: actor.code, entityCode: actor.entity.code, overseas: !!i.overseas, name: str(i.name)!, nameLocal: str(i.nameLocal) ?? "", taxId: str(i.taxId) ?? "", branchCode: str(i.branchCode) ?? "00000", addressEn: str(i.addressEn), addressLocal: str(i.addressLocal), phone: str(i.phone), paymentTermDays: num(i.paymentTermDays) ?? 30, defaultCurrency: str(i.currency) ?? "THB", source: "AI assistant", plants: [{ code: "HQ", name: str(i.name)!, address: str(i.addressEn) ?? str(i.addressLocal) }], contacts: (i.contacts as In[] | undefined)?.map((k) => ({ name: str(k.name)!, title: str(k.title), phone: str(k.phone), email: str(k.email), birthday: str(k.birthday) })) ?? [] });
      return { ok: true, summary: `${c.code} ${c.name}`, href: `/customers/${c.code}`, data: { code: c.code } };
    } },
  { name: "add_contact", tier: "auto", description: "Add a contact person to a customer (birthday as MM-DD feeds the message centre).",
    input_schema: obj({ customer: S, name: S, title: S, phone: S, email: S, lineId: S, birthday: S }, ["customer", "name"]),
    run: async (i) => { const c = await customerBy(i.customer); await addContact(c.code, { name: str(i.name)!, title: str(i.title), phone: str(i.phone), email: str(i.email), lineId: str(i.lineId), birthday: str(i.birthday) }); return { ok: true, summary: `${c.code} ${c.name}: contact added`, href: `/customers/${c.code}` }; } },
  { name: "create_asset", tier: "auto", description: "Open an equipment file (ATH). The serial number is mandatory and copied verbatim; modelCode is the type code on the nameplate (e.g. 6SL3210-1PE21-8UL0).",
    input_schema: obj({ customer: S, type: { type: "string", enum: ["VFD", "MOTOR", "PLC", "PANEL", "DRIVE_TRAIN", "SENSOR", "OTHER"] }, serialNumber: S, modelCode: S, location: S, customerAssetNo: S }, ["customer", "type", "serialNumber"]),
    run: async (i, ctx) => {
      const c = await customerBy(i.customer);
      const model = str(i.modelCode) ? await findModelByCode(str(i.modelCode)!) : null;
      const a = await onboardAsset({ createdByEmployeeCode: ctx.employeeCode, type: str(i.type) as "VFD", serialNumber: str(i.serialNumber)!, modelId: model?.id, customerId: c.id, location: str(i.location), customerAssetNo: str(i.customerAssetNo), initialStatus: "IN_SERVICE" });
      return { ok: true, summary: `${a.code} · S/N ${a.serialNumber}${str(i.modelCode) && !model ? ` (model ${str(i.modelCode)} is not in the product series yet)` : ""}`, href: `/assets/${a.code}`, data: { code: a.code } };
    } },
  { name: "create_order", tier: "auto",
    description: `Open a business order (QTTH). mode: ${MODES.join(" | ")}. Repair / partner repair / maintenance need assetCodes (ATH…). Trade modes take lines (the customer's inquiry). INTERNATIONAL_TRADE also needs tradeTerms {currency, incoterm, place, destCountry, destPort?, shipMode SEA|AIR|LAND|COURIER, paymentTerms, paymentDays}. AUTOMATION_PROJECT needs projectName. Short stock on trade lines is sent out for supplier quotes automatically.`,
    input_schema: obj({ mode: { type: "string", enum: [...MODES] }, customer: S, assetCodes: { type: "array", items: S }, symptom: S, alarm: S, productionImpact: { type: "string", enum: ["STOPPED", "DEGRADED", "NONE"] }, customerRef: { type: "string", description: "customer's inquiry / PO number, verbatim" }, contactName: S,
      lines: { type: "array", items: obj({ sku: S, description: S, qty: N, unit: S, neededBy: { type: "string", description: "YYYY-MM-DD" }, hsCode: S, origin: S }) }, tradeTerms: { type: "object" }, projectName: S, projectDue: S, projectScope: S }, ["mode", "customer"]),
    run: async (i, ctx) => {
      const c = await customerBy(i.customer);
      const mode = str(i.mode) as (typeof MODES)[number];
      let contactId: string | undefined;
      if (str(i.contactName)) { const k = await prisma.contact.findFirst({ where: { customerId: c.id, name: { equals: str(i.contactName)!, mode: "insensitive" } } }) ?? await addContact(c.code, { name: str(i.contactName)! }); contactId = k.id; }
      const o = await createServiceOrder({ createdByEmployeeCode: ctx.employeeCode, customerId: c.id, mode, assetCodes: (i.assetCodes as string[] | undefined) ?? [], reportedSymptom: str(i.symptom), reportedAlarm: str(i.alarm), productionImpact: str(i.productionImpact), customerRef: str(i.customerRef), reportedByContactId: contactId,
        requestLines: i.lines as never, tradeTerms: mode === "INTERNATIONAL_TRADE" ? (i.tradeTerms as In | undefined) ?? {} : undefined, project: mode === "AUTOMATION_PROJECT" ? { name: str(i.projectName) ?? "", dueDate: str(i.projectDue), scope: str(i.projectScope) } : undefined, currency: "THB" });
      return { ok: true, summary: `${o.no} · ${c.name} · ${mode}`, href: `/service-orders/${o.no}`, data: { no: o.no } };
    } },
  { name: "assign_order", tier: "auto", description: "Give an order to an engineer (employee code ETH… or name).", input_schema: obj({ no: S, engineer: S, note: S }, ["no", "engineer"]),
    run: async (i, ctx) => {
      const q = str(i.engineer)!;
      const e = await prisma.employee.findFirst({ where: { active: true, OR: [{ code: q.toUpperCase() }, { name: { contains: q, mode: "insensitive" } }, { nameLocal: { contains: q, mode: "insensitive" } }] } });
      if (!e) throw new Error(`no active employee matches "${q}"`);
      await advanceServiceOrder(str(i.no)!, "ASSIGNED", ctx.employeeCode, str(i.note), e.code);
      return { ok: true, summary: `${str(i.no)} → ${e.name}`, href: `/service-orders/${str(i.no)}` };
    } },
  { name: "set_quote", tier: "auto", description: "Write the quote lines of an order (replaces the whole set) and mark the quote as issued. Prices are in the order's currency, before VAT. Give unitCost when known so the margin is right; a margin under the floor waits for the MD.",
    input_schema: obj({ no: S, warrantyDays: N, lines: { type: "array", items: obj({ description: S, descriptionLocal: S, partSku: S, assetCode: S, qty: N, unit: S, unitPrice: N, unitCost: N }, ["description", "qty", "unitPrice"]) } }, ["no", "lines"]),
    run: async (i, ctx) => {
      const no = str(i.no)!;
      const o = await setQuoteLines({ serviceOrderNo: no, actorCode: ctx.employeeCode, warrantyDays: num(i.warrantyDays), lines: (i.lines as In[]).map((l) => ({ description: str(l.description)!, descriptionLocal: str(l.descriptionLocal), partSku: str(l.partSku), assetCode: str(l.assetCode), qty: Number(l.qty), unit: str(l.unit) ?? "pcs", unitPrice: Number(l.unitPrice), unitCost: num(l.unitCost) })) });
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no } });
      if (["RECEIVED", "ASSIGNED", "DIAGNOSING"].includes(cur.status)) await catchUpOrder(no, "QUOTE_PENDING", ctx.employeeCode);
      return { ok: true, summary: `${no} quote ${o.currency} ${Number(o.total).toFixed(2)} incl. VAT, margin ${o.marginPct == null ? "?" : `${Math.round(Number(o.marginPct) * 100)}%`}${o.marginApproval === "PENDING" ? " — below the floor, waits for the MD" : ""}`, href: `/service-orders/${no}/quote` };
    } },
  { name: "confirm_customer_po", tier: "auto", description: "The customer accepted the quote: record their PO number and start the work. PO lines are taken from the quote.", input_schema: obj({ no: S, customerRef: S, note: S }, ["no"]),
    run: async (i, ctx) => { const no = str(i.no)!; await confirmCustomerPo({ no, actorCode: ctx.employeeCode, customerRef: str(i.customerRef), poLines: await poLinesFromQuote(no), note: str(i.note) }); return { ok: true, summary: `${no}: PO ${str(i.customerRef) ?? ""} confirmed, work started`, href: `/service-orders/${no}` }; } },
  { name: "request_supplier_quotes", tier: "auto", description: "Send what the shelf cannot cover on an order out for supplier quotes (PRTH).", input_schema: obj({ no: S }, ["no"]),
    run: async (i, ctx) => { const pr = await autoInquiryForOrder(str(i.no)!, ctx.employeeCode); return pr ? { ok: true, summary: `${pr} for ${str(i.no)}`, href: `/purchasing/inquiries/${pr}` } : { ok: true, summary: `${str(i.no)}: nothing short, or an inquiry is already open`, href: `/service-orders/${str(i.no)}` }; } },
  { name: "issue_delivery", tier: "auto", description: "Issue the delivery note (DNTH) for everything still due on an order.", input_schema: obj({ no: S, deliverOn: { type: "string", description: "YYYY-MM-DD, default today" }, remark: S }, ["no"]),
    run: async (i, ctx) => {
      const no = str(i.no)!;
      const plan = await deliveryPlan(no);
      const delivered = Object.fromEntries(plan.lines.map((l) => [l.key, Math.max(0, l.expected - l.deliveredBefore)]).filter(([, q]) => (q as number) > 0));
      if (!Object.keys(delivered).length) throw new Error(`${no}: nothing left to deliver`);
      const dn = await issueDelivery({ serviceOrderNo: no, actorCode: ctx.employeeCode, deliverOn: new Date(str(i.deliverOn) ?? new Date().toISOString().slice(0, 10)), delivered, remark: str(i.remark) });
      return { ok: true, summary: `${dn.no} for ${no}`, href: `/service-orders/${no}/deliver/${dn.no}`, data: { no: dn.no } };
    } },
  { name: "sign_delivery", tier: "auto", description: "The customer signed the delivery note: record who and when.", input_schema: obj({ dn: S, signedBy: S, signedAt: S }, ["dn", "signedBy"]),
    run: async (i, ctx) => { const dn = await signDelivery({ no: str(i.dn)!, actorCode: ctx.employeeCode, signedBy: str(i.signedBy)!, signedAt: str(i.signedAt) ? new Date(str(i.signedAt)!) : undefined }); return { ok: true, summary: `${dn.no} signed by the customer` }; } },
  { name: "issue_proforma", tier: "auto", description: "International trade: issue the pro-forma invoice (PFTH) for an order whose PO is confirmed.", input_schema: obj({ no: S }, ["no"]),
    run: async (i, ctx) => { const pf = await issueProforma(str(i.no)!, ctx.employeeCode); return { ok: true, summary: `${pf} for ${str(i.no)}`, href: `/service-orders/${str(i.no)}/ship` }; } },
  { name: "update_employee_profile", tier: "auto",
    description: "Write facts into an employee file (人才池). employee = code ETH… or name; leave empty for the signed-in person's own file. Fields: taxNo (personal tax ID), ssoNo, bankName, bankAccount, nationality, birthDate (YYYY-MM-DD), position, workLocation, phone, phone2, lineId, wechatId, personalEmail, address, emergencyName, emergencyRelation, emergencyPhone. Only the MD may change another person's file or the non-contact fields; everyone may change their own contact details.",
    input_schema: obj({ employee: S, taxNo: S, ssoNo: S, bankName: S, bankAccount: S, nationality: S, birthDate: S, position: S, workLocation: S, phone: S, phone2: S, lineId: S, wechatId: S, personalEmail: S, address: S, emergencyName: S, emergencyRelation: S, emergencyPhone: S }),
    run: async (i, ctx) => {
      const actor = await prisma.employee.findUniqueOrThrow({ where: { code: ctx.employeeCode } });
      const e = await employeeBy(i.employee, actor.code);
      const fields = Object.fromEntries(Object.entries(i).filter(([k, v]) => k !== "employee" && str(v))) as Record<string, string>;
      if (!Object.keys(fields).length) throw new Error("nothing to write");
      const CONTACT = ["phone", "phone2", "lineId", "wechatId", "personalEmail", "address", "emergencyName", "emergencyRelation", "emergencyPhone"];
      if (actor.role === "MD") await updateEmployee({ actorCode: actor.code, code: e.code, ...fields });
      else if (e.code === actor.code && Object.keys(fields).every((k) => CONTACT.includes(k))) await updateOwnContacts(actor.code, fields);
      else throw new Error("only the MD may change these fields; a person may change their own contact details");
      return { ok: true, summary: `${e.code} ${e.name}: ${Object.keys(fields).join(", ")}`, href: `/people/${e.code}` };
    } },
  { name: "add_employee_document", tier: "auto",
    description: "File a document in an employee file with its number, dates and the attached file: PASSPORT, ID_CARD, VISA, WORK_PERMIT, REPORT_90, CONTRACT, DEGREE, CERTIFICATE, DRIVING_LICENCE, OTHER (give a title, e.g. 'Taxpayer ID card'). employee empty = the signed-in person. file = {name, url} of an attached file. The expiry date feeds the message centre. MD only.",
    input_schema: obj({ employee: S, kind: { type: "string", enum: ["PASSPORT", "ID_CARD", "VISA", "WORK_PERMIT", "REPORT_90", "CONTRACT", "DEGREE", "CERTIFICATE", "DRIVING_LICENCE", "OTHER"] }, title: S, number: S, issuedAt: S, expiresAt: S, note: S, file: obj({ name: S, url: S }, ["name", "url"]) }, ["kind"]),
    run: async (i, ctx) => {
      const e = await employeeBy(i.employee, ctx.employeeCode);
      const f = i.file as { name?: string; url?: string } | undefined;
      if (f?.url && !/^\/api\/uploads\/[A-Za-z0-9._-]+$/.test(f.url)) throw new Error("file.url must be the url of a file attached in this conversation");
      await addCredential(ctx.employeeCode, e.code, { kind: str(i.kind) as "OTHER", title: str(i.title), number: str(i.number), issuedAt: str(i.issuedAt), expiresAt: str(i.expiresAt), note: str(i.note), file: f?.url ? { name: f.name ?? "file", url: f.url } : undefined });
      return { ok: true, summary: `${e.code} ${e.name}: ${str(i.title) ?? str(i.kind)}${str(i.number) ? ` ${str(i.number)}` : ""}${f?.url ? " + file" : ""}`, href: `/people/${e.code}` };
    } },
  { name: "issue_tax_invoice", tier: "confirm", description: "Issue the tax invoice (TITH) and the invoice (IVTH) for an accepted order. A tax invoice number cannot be taken back, so the person confirms first.", input_schema: obj({ no: S }, ["no"]),
    summarize: (i) => `Issue tax invoice + invoice for ${str(i.no)}`,
    run: async (i, ctx) => { const ti = await issueTaxInvoice({ serviceOrderNo: str(i.no)!, actorCode: ctx.employeeCode }); const iv = await issueInvoice({ serviceOrderNo: str(i.no)!, actorCode: ctx.employeeCode, taxInvoiceNo: ti.no }); return { ok: true, summary: `${ti.no} + ${iv.no} · ${ti.currency} ${Number(ti.total).toFixed(2)}`, href: `/service-orders/${str(i.no)}/invoice` }; } },
  { name: "record_payment", tier: "confirm", description: "Record money received against an invoice (IVTH/PFTH). The person confirms the amount first.", input_schema: obj({ invoiceNo: S, paidAt: { type: "string", description: "YYYY-MM-DD" }, paidAmount: N, whtAmount: N, bankRef: S, whtCertRef: S }, ["invoiceNo", "paidAt", "paidAmount"]),
    summarize: (i) => `Record payment ${Number(i.paidAmount).toFixed(2)}${num(i.whtAmount) ? ` + WHT ${Number(i.whtAmount).toFixed(2)}` : ""} on ${str(i.invoiceNo)} (${str(i.paidAt)})`,
    run: async (i, ctx) => { await recordPayment({ invoiceNo: str(i.invoiceNo)!, actorCode: ctx.employeeCode, paidAt: new Date(str(i.paidAt)!), paidAmount: Number(i.paidAmount), whtAmount: num(i.whtAmount) ?? 0, bankRef: str(i.bankRef), whtCertRef: str(i.whtCertRef) }); return { ok: true, summary: `${str(i.invoiceNo)}: payment recorded` }; } },
];

export const ACTION_TOOLS = TOOLS;

/** Called from the assistant's tool loop: run an auto action, or park a confirm action for the person. */
export async function runAction(name: string, input: In, ctx: ActionCtx): Promise<ActionResult> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`unknown action ${name}`);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: ctx.employeeCode } });
  if (tool.tier === "confirm") {
    const summary = tool.summarize?.(input) ?? name;
    const p = await prisma.aiAction.create({ data: { employeeId: actor.id, tool: name, input: input as Prisma.InputJsonValue, summary } });
    return { pending: p.id, summary };
  }
  const r = await tool.run(input, ctx);
  await prisma.aiAction.create({ data: { employeeId: actor.id, tool: name, input: input as Prisma.InputJsonValue, summary: r.summary, status: "DONE", result: r as unknown as Prisma.InputJsonValue, decidedAt: new Date() } });
  await audit(actor.id, `AI:${name}`, r.summary.slice(0, 120), { input } as Record<string, unknown>);
  return r;
}

/** The person pressed confirm (or cancel) on a parked action. Only its owner may decide; it runs once. */
export async function decideAction(id: string, employeeCode: string, go: boolean): Promise<ActionResult> {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: employeeCode } });
  const p = await prisma.aiAction.findUnique({ where: { id } });
  if (!p || p.employeeId !== actor.id) throw new Error("AI_ACTION_NOT_FOUND");
  if (p.status !== "PENDING") throw new Error(`AI_ACTION_${p.status}`);
  if (!go) { await prisma.aiAction.update({ where: { id }, data: { status: "CANCELLED", decidedAt: new Date() } }); return { summary: p.summary }; }
  const claimed = await prisma.aiAction.updateMany({ where: { id, status: "PENDING" }, data: { status: "RUNNING" } });
  if (!claimed.count) throw new Error("AI_ACTION_RUNNING");
  const tool = TOOLS.find((t) => t.name === p.tool)!;
  try {
    const r = await tool.run(p.input as In, { employeeCode });
    await prisma.aiAction.update({ where: { id }, data: { status: "DONE", result: r as unknown as Prisma.InputJsonValue, decidedAt: new Date() } });
    await audit(actor.id, `AI:${p.tool}`, r.summary.slice(0, 120), { input: p.input, confirmed: true } as Record<string, unknown>);
    return r;
  } catch (e) {
    await prisma.aiAction.update({ where: { id }, data: { status: "FAILED", result: { error: (e as Error).message }, decidedAt: new Date() } });
    throw e;
  }
}

/** 单据链: every numbered document of an order, in the order it was issued — what L2C looks like on one order. */
export async function documentChain(no: string) {
  const o = await prisma.serviceOrder.findUnique({ where: { no }, select: { id: true, no: true, mode: true, status: true, customerRef: true, total: true, currency: true, customer: { select: { name: true } } } });
  if (!o) return `no order ${no}`;
  const [docs, prs, pos] = await Promise.all([
    prisma.document.findMany({ where: { serviceOrderId: o.id }, orderBy: { issuedAt: "asc" }, select: { no: true, type: true, issuedAt: true } }),
    prisma.purchaseInquiry.findMany({ where: { serviceOrderId: o.id }, select: { no: true, status: true } }),
    prisma.purchaseOrder.findMany({ where: { serviceOrderId: o.id }, select: { no: true, status: true } }),
  ]);
  return { order: o, documents: docs.map((d) => ({ no: d.no, type: d.type, date: d.issuedAt?.toISOString().slice(0, 10) })), supplierInquiries: prs, purchaseOrders: pos };
}
