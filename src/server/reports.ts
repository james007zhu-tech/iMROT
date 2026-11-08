/**
 * Report generation: a registered document number → the DCiT Word template it belongs to → field values from the
 * event data → .docx (and .pdf when LibreOffice is installed). Nothing is typed by hand; the template layout is untouched.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { sofficePath } from "./office";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/db";
import { fillDocx, type FieldValues } from "@/lib/docx/fill";
import { maskNamesIn } from "@/lib/mask";
import { englishAmount, thaiAmount } from "@/lib/amount-words";

const exec = promisify(execFile);
const TEMPLATES = path.join(process.cwd(), "templates", "word");
const OUT = process.env.DOCS_DIR ?? path.join(process.cwd(), "uploads", "documents");

const TEMPLATE_FILES: Record<string, string> = {
  "04": "04_Repair_Service_Proposal.docx", "06": "06_Order_Confirmation.docx", "07": "07_Equipment_Receiving.docx",
  "08": "08_Diagnostic_Report.docx", "09": "09_Repair_Report.docx", "10": "10_Field_Service_Report.docx",
  "11": "11_Preventive_Maintenance_Record.docx", "12": "12_Service_Completion.docx", "13": "13_Customer_Acceptance.docx", "19": "19_Delivery_Note.docx",
  "20": "20_Tax_Invoice.docx", "21": "21_Invoice.docx", "22": "22_Receipt.docx", "23": "23_Statement.docx",
};

/** Withholding tax shown on invoices as the customer's expected deduction on services — PLACEHOLDER rate (decision 2026-11-08: rate is a placeholder). */
export const WHT_RATE_PLACEHOLDER = 0.03;
const money = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctLabel = (r: unknown) => `${(Number(r) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * 86_400_000);

type Bank = { bank?: string; branch?: string; bankCode?: string; branchCode?: string; accountName?: string; swift?: string; accounts?: Record<string, string> };
/** One line per item (rule: no " · " joins): bank + branch, each account, account name, SWIFT. */
function bankLines(b: Bank | null | undefined, currency?: string): string {
  if (!b) return "";
  const accounts = Object.entries(b.accounts ?? {});
  const shown = currency && accounts.some(([c]) => c === currency) ? accounts.filter(([c]) => c === currency || c === "THB") : accounts;
  return [[b.bank, b.branch ? `${b.branch}${b.bankCode ? ` (${b.bankCode}-${b.branchCode ?? ""})` : ""}` : ""].filter(Boolean).join(", "), ...shown.map(([c, a]) => `${c} ${a}`), b.accountName ? `Account name: ${b.accountName}` : "", b.swift ? `SWIFT ${b.swift}` : ""].filter(Boolean).join("\n");
}
type TiLine = { descriptionLocal?: string; descriptionEn?: string; description?: string; qty: number | string; unit?: string; unitPrice: number | string; amount: number | string };
const tiLines = (lines: TiLine[]) => ({
  L_NO: lines.map((_, i) => i + 1), L_DESC: lines.map((l) => [l.descriptionLocal, l.descriptionEn ?? l.description].filter((x, i, a) => x && a.indexOf(x) === i).join("\n")),
  L_QTY: lines.map((l) => String(Number(l.qty))), L_UNIT: lines.map((l) => l.unit ?? ""), L_PRICE: lines.map((l) => money(l.unitPrice)), L_AMOUNT: lines.map((l) => money(l.amount)),
});
const branchLabel = (code?: string | null, plant?: { name: string } | null) => [code, plant?.name ? `(${plant.name})` : ""].filter(Boolean).join(" ");

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
type TestRow = { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean };
const col = (tests: TestRow[] | null | undefined, k: keyof TestRow, n = 4) => Array.from({ length: n }, (_, i) => (tests?.[i]?.[k] as string | undefined) ?? "");

/** Build the field map for one document. Returns template code + values. */
async function buildFieldsRaw(no: string, templateHint?: string): Promise<{ template: string; values: FieldValues }> {
  const doc = await prisma.document.findUniqueOrThrow({ where: { no }, include: { entity: true, customer: true, createdBy: true, serviceOrder: { include: { plant: true, customer: true, assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } } } } } });
  const o = doc.serviceOrder;
  const a = o?.assets[0]?.asset;
  const common = {
    DOC_NO: no,
    ISSUE_DATE: d(doc.issuedAt),
    CUSTOMER_SITE: [o?.customer.name, o?.plant?.name, a?.location].filter(Boolean).join(" · "),
    CUSTOMER_NAME: o?.customer.name ?? doc.customer?.name ?? "",
    SITE: [o?.plant?.name, a?.location].filter(Boolean).join(" · "),
    JOB_PO: [o?.no, o?.customerRef].filter(Boolean).join(" / "),
    PO_JOB: [o?.customerRef, o?.no].filter(Boolean).join(" / "),
    MODEL_SERIAL: a ? `${a.model ? `${a.model.series.brand.name} ${a.model.series.name} ${a.model.code}` : a.type} · ${a.code} · S/N ${a.serialNumber}` : "",
  };

  switch (doc.type) {
    case "IN": {
      const i = await prisma.inspection.findUniqueOrThrow({ where: { no }, include: { engineer: true, asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } });
      const tests = i.tests as TestRow[] | null;
      return { template: "08", values: { ...common, DATE_TECHNICIAN: `${d(i.inspectedAt)} · ${i.engineer.code} ${i.engineer.name}`, SYMPTOMS: i.symptoms ?? o?.reportedSymptom ?? "", CONDITIONS: i.conditions ?? "", FINDINGS_CAUSE: [i.findings, i.probableCause].filter(Boolean).join("\n"), RECOMMENDATION_AUTHORIZATION: i.recommendation ?? "", APPROVED_CRITERION: col(tests, "criterion"), MEASURED_RESULT: col(tests, "result"), RECORD_ID: col(tests, "recordId"), INSTRUMENT_CALIBRATION: i.instruments ?? "", ATTACHMENT_IDS: [i.attachmentRefs, ((i.attachments as { name: string }[] | null) ?? []).map((x) => x.name).join(", ")].filter(Boolean).join(" · "), OPEN_ISSUES: i.openIssues ?? "", CONCLUSION_LIMITATIONS: i.conclusion ?? "" } };
    }
    case "RP":
    case "PM": {
      const j = await prisma.repairJob.findUniqueOrThrow({ where: { no }, include: { engineer: true } });
      const tests = j.tests as TestRow[] | null;
      const parts = ((j.partsReplaced as { partSku: string; qty: number; oldSerial?: string; newSerial?: string; obthNo?: string }[] | null) ?? []).map((p) => `${p.partSku} ×${p.qty}${p.newSerial ? ` (S/N ${p.newSerial})` : ""}${p.obthNo ? ` · ${p.obthNo}` : ""}`).join("\n");
      const base = { ...common, DATE_TECHNICIAN: `${d(j.finishedAt ?? j.startedAt)} · ${j.engineer.code} ${j.engineer.name}`, APPROVED_CRITERION: col(tests, "criterion"), MEASURED_RESULT: col(tests, "result"), RECORD_ID: col(tests, "recordId"), INSTRUMENT_CALIBRATION: "", ATTACHMENT_IDS: ((j.attachments as { name: string }[] | null) ?? []).map((x) => x.name).join(", "), OPEN_ISSUES: j.openIssues ?? "", CONCLUSION_LIMITATIONS: j.conclusion ?? "" };
      if (doc.templateCode === "11" || j.kind === "MAINTENANCE") {
        const escort = j.escortContactId ? (await prisma.contact.findUnique({ where: { id: j.escortContactId } }))?.name : undefined; // masked with the other contact names below
        const items = (j.checklist as { item: string; criterion?: string; measured?: string; verdict?: string }[] | null) ?? [];
        return { template: "11", values: { ...base,
          ASSET_CONDITION: [j.conditionRating, j.runHours != null ? `${j.runHours} h` : "", j.level].filter(Boolean).join(" · ") || (j.confirmedFault ?? ""),
          PM_TASKS: [items.length ? items.map((x, i) => `${i + 1}. ${x.item}${x.criterion ? ` [${x.criterion}]` : ""}: ${x.measured ?? ""}${x.verdict ? ` — ${x.verdict}` : ""}`).join("\n") : (j.workPerformed ?? ""), j.consumables ? `Consumables / parts: ${j.consumables}` : ""].filter(Boolean).join("\n"),
          DATE_TECHNICIAN: `${base.DATE_TECHNICIAN}${escort ? ` · Customer: ${escort}` : ""}`,
          ABNORMALITIES: [j.hazards, j.handled ? `Handled: ${j.handled}` : ""].filter(Boolean).join("\n") || (j.rootCause ?? ""),
          NEXT_ACTIONS: [j.recommendation, j.nextDueAt ? `Next: ${d(j.nextDueAt)}` : "", j.nextDueHours ? `or +${j.nextDueHours} h` : ""].filter(Boolean).join(" · ") || (j.openIssues ?? "") } };
      }
      if (doc.templateCode === "10" || j.location === "SITE") {
        return { template: "10", values: { ...base, ISSUE_SCOPE: [j.confirmedFault, j.rootCause].filter(Boolean).join("\n"), PERMIT_ISOLATION: "", ACTIVITY_TIME: `${j.workPerformed ?? ""}${j.laborHours ? `\n${Number(j.laborHours)} h` : ""}`, RESTORATION_HANDOVER: j.conclusion ?? "" } };
      }
      return { template: "09", values: { ...base, CONFIRMED_FAULT: [j.confirmedFault, j.rootCause].filter(Boolean).join("\n"), WORK_PERFORMED: j.workPerformed ?? "", PARTS_REPLACED: parts, CONFIG_BACKUP: j.configBackupRef ?? "" } };
    }
    case "ER": {
      const ev = await prisma.assetEvent.findFirstOrThrow({ where: { sourceDocNo: no }, include: { asset: true } });
      const pl = (ev.payload as Record<string, string> | null) ?? {};
      return { template: "07", values: { ...common, JOB_NO: o?.no ?? "", EQUIPMENT_SERIAL: `${ev.asset.code} · S/N ${ev.asset.serialNumber}`, SENDER: pl.sender ?? "", RECEIVED_AT: d(ev.occurredAt), ACCESSORIES: pl.accessories ?? "", CONDITION: pl.condition ?? "", FAULT: pl.fault ?? "", PHOTO_REFERENCES: pl.photoRefs ?? "", HANDLING_RESTRICTIONS: pl.handlingRestrictions ?? "" } };
    }
    case "QT": {
      const lines = await prisma.quoteLine.findMany({ where: { serviceOrderId: o!.id }, orderBy: { lineNo: "asc" } });
      const entity = doc.entity;
      const want = templateHint ?? doc.templateCode ?? "13";
      if (want === "04") {
        const insp = await prisma.inspection.findFirst({ where: { serviceOrderId: o!.id }, orderBy: { inspectedAt: "desc" } });
        return { template: "04", values: { ...common, EQUIPMENT_ID: common.MODEL_SERIAL, FAULT_SYMPTOM: o?.reportedSymptom ?? "", OPERATIONAL_IMPACT: o?.productionImpact ?? "", REQUIRED_COMPLETION_DATE: "", DIAGNOSTIC_DELIVERABLE: insp?.findings ?? "", REPAIR_SCOPE: lines.map((l) => `${l.description} ×${Number(l.qty)}`).join("\n"), TEST_METHOD_AND_CRITERIA: insp?.recommendation ?? "", DELIVERY_AND_REPORT: "Repair Report 09 / Field Service Report 10, Service Completion 12, Customer Acceptance 13", EXCLUSIONS: "", CUSTOMER_INFORMATION_AND_ACCESS: "", QUOTE_REF: o?.no ?? "", PRICE_CURRENCY: `${o?.currency} ${Number(o?.total ?? 0).toFixed(2)} (incl. VAT ${(Number(entity.vatRate) * 100).toFixed(0)}%)`, VAT_TREATMENT: `VAT ${(Number(entity.vatRate) * 100).toFixed(0)}% shown separately`, PAYMENT_MILESTONES: `${o?.customer.paymentTermDays ?? 30} days after invoice`, LEAD_TIME: "", WARRANTY: "", ACCEPTANCE_CRITERIA: "", VALID_UNTIL: "", MILESTONE_1: "Diagnosis", OWNER_1: "DCiT", DATE_1: "", MILESTONE_2: "Repair & test", OWNER_2: "DCiT", DATE_2: "", MILESTONE_3: "Acceptance", OWNER_3: "Customer", DATE_3: "" } };
      }
      if (want === "06") {
        return { template: "06", values: { ...common, CUSTOMER_PO: o?.customerRef ?? "", QUOTE_REF: o?.no ?? "", DELIVERY_ADDRESS: [o?.customer.addressLocal, o?.plant?.address].filter(Boolean).join(" / "), ITEM: lines.map((l) => l.description).join("\n"), QTY: lines.map((l) => `${Number(l.qty)} ${l.unit}`).join("\n"), SCOPE: o?.reportedSymptom ?? "", DELIVERY_DATE: "", AMOUNT_CURRENCY: `${o?.currency} ${Number(o?.total ?? 0).toFixed(2)}`, PAYMENT_TERMS: `${o?.customer.paymentTermDays ?? 30} days`, DEVIATIONS: "", WARRANTY: "" } };
      }
      // 12 Service Completion / 13 Customer Acceptance are both rendered from the acceptance record under the QTTH
      const acc = await prisma.acceptance.findUnique({ where: { serviceOrderId: o!.id } });
      const dv = (acc?.deliverables as { deliverable: string; criterion?: string; result?: string }[] | null) ?? [];
      const values: FieldValues = { ...common, REPORT_REF: (await prisma.document.findMany({ where: { serviceOrderId: o!.id, type: { in: ["IN", "RP", "PM"] } } })).map((x) => x.no).join(", "), PUNCH_LIST: acc?.punchList ?? "", DATE: d(acc?.acceptedAt), STATUS: acc?.status ?? "", WARRANTY: [d(acc?.warrantyStart), acc?.warrantyTerms].filter(Boolean).join(" · ") };
      for (let i = 0; i < 3; i++) { values[`DELIVERABLE_${i + 1}`] = dv[i]?.deliverable ?? ""; values[`CRITERION_${i + 1}`] = dv[i]?.criterion ?? ""; values[`RESULT_${i + 1}`] = dv[i]?.result ?? ""; }
      return { template: want === "12" ? "12" : "13", values };
    }
    case "DN": {
      const dn = await prisma.deliveryNote.findUniqueOrThrow({ where: { no }, include: { driver: true } });
      const lines = dn.lines as { kind: string; description: string; assetCode?: string; delivered: number; poLineNo?: number; source?: string }[];
      const plant = dn.plantId ? await prisma.plant.findUnique({ where: { id: dn.plantId } }) : null;
      const list = (f: (l: (typeof lines)[number]) => boolean) => lines.filter((l) => f(l) && l.delivered > 0).map((l) => `${l.poLineNo ? `${l.poLineNo}. ` : ""}${l.description}${l.assetCode ? ` (${l.assetCode})` : ""} × ${l.delivered}${l.source ? ` · ${l.source}` : ""}`).join("\n");
      return { template: "19", values: { ...common, ISSUE_DATE: d(dn.deliverOn), DELIVER_TO: [o?.customer.name, plant?.name, dn.address ?? plant?.address].filter(Boolean).join(" · "), DRIVER_VEHICLE: [dn.driver ? `${dn.driver.code} ${dn.driver.name}` : "", dn.vehicle].filter(Boolean).join(" · "), DELIVER_ON: d(dn.deliverOn),
        // The repaired machine itself goes back too; PO lines are the parts and items the customer ordered.
        PO_ITEMS: list((l) => l.kind === "PO"), EQUIPMENT: [...new Set(lines.filter((l) => l.delivered > 0 && l.assetCode).map((l) => l.assetCode!))].map((c) => { const x = o?.assets.find((y) => y.asset.code === c)?.asset; return x ? `${x.code} · ${x.model ? `${x.model.series.brand.name} ${x.model.code} · ` : ""}S/N ${x.serialNumber}` : c; }).join("\n"),
        RETURNED_ACCESSORIES: list((l) => l.kind === "RETURN" && (l.source ?? "").startsWith("ER")), RETURNED_PARTS: list((l) => l.kind === "RETURN" && !(l.source ?? "").startsWith("ER")), REMARKS: [dn.remark, dn.overrideReason ? `MD: ${dn.overrideReason}` : ""].filter(Boolean).join("\n") } };
    }
    case "TI": {
      const ti = await prisma.taxInvoice.findUniqueOrThrow({ where: { no } });
      const c = o!.customer; const e = doc.entity;
      const dns = await prisma.deliveryNote.findMany({ where: { serviceOrderId: o!.id, status: { in: ["ISSUED", "SIGNED"] } }, select: { no: true } });
      return { template: "20", values: { ...common, BOOK_NO: "001", ISSUE_DATE: d(ti.issuedAt),
        CUSTOMER_NAME_TH: c.nameLocal ?? c.name, CUSTOMER_NAME_EN: c.nameLocal ? c.name : "", CUSTOMER_ADDRESS: c.billingAddress ?? c.addressLocal ?? c.addressEn ?? "", CUSTOMER_TAX_ID: ti.buyerTaxId ?? c.taxId ?? "", CUSTOMER_BRANCH: branchLabel(ti.buyerBranch ?? c.branchCode, o!.plant),
        REFERENCE: [o!.no, o!.customerRef ? `PO ${o!.customerRef}` : ""].filter(Boolean).join("\n"), PAYMENT_TERMS: `${c.paymentTermDays} วัน\ndue ${d(addDays(ti.issuedAt, c.paymentTermDays))}`, DELIVERY_NOTE: dns.map((x) => x.no).join("\n") || "—",
        ...tiLines(ti.lines as TiLine[]), SUBTOTAL: money(ti.subtotal), VAT_LABEL: pctLabel(ti.vatRate), VAT_AMOUNT: money(ti.vatAmount), CURRENCY: ti.currency, TOTAL: money(ti.total),
        TOTAL_WORDS_TH: thaiAmount(Number(ti.total), ti.currency), TOTAL_WORDS_EN: englishAmount(Number(ti.total), ti.currency), BANK_LINES: bankLines(e.bankDetails as Bank | null, ti.currency), NOTES: ti.voidedAt ? `ยกเลิก / VOID ${d(ti.voidedAt)} ${ti.voidReason ?? ""}` : "",
        RECEIVED_BY: "", ISSUED_BY: doc.createdBy.name, AUTHORISED_BY: e.signatoryName ?? "", VAT_REG_DATE: d(e.vatRegisteredFrom) } };
    }
    case "IV": {
      const iv = await prisma.invoice.findUniqueOrThrow({ where: { no }, include: { taxInvoice: true, receipts: true } });
      const c = o!.customer; const e = doc.entity;
      const lines: TiLine[] = (iv.taxInvoice?.lines as TiLine[] | undefined) ?? (await prisma.quoteLine.findMany({ where: { serviceOrderId: o!.id }, orderBy: { lineNo: "asc" } })).map((l) => ({ description: l.description, descriptionLocal: l.descriptionLocal ?? undefined, qty: Number(l.qty), unit: l.unit, unitPrice: Number(l.unitPrice), amount: Number(l.qty) * Number(l.unitPrice) }));
      const subtotal = iv.taxInvoice ? Number(iv.taxInvoice.subtotal) : round2(lines.reduce((s, l) => s + Number(l.amount), 0));
      const vatRate = iv.taxInvoice ? Number(iv.taxInvoice.vatRate) : Number(e.vatRate);
      const vat = iv.taxInvoice ? Number(iv.taxInvoice.vatAmount) : round2(subtotal * vatRate);
      const total = Number(iv.amountDue);
      const settled = round2(iv.receipts.reduce((s, r) => s + Number(r.settledAmount), 0));
      const wht = settled ? 0 : round2(subtotal * WHT_RATE_PLACEHOLDER);
      const lf = tiLines(lines);
      return { template: "21", values: { ...common, ISSUE_DATE: d(iv.issuedAt), DUE_DATE: d(iv.dueAt ?? addDays(iv.issuedAt, c.paymentTermDays)), TAX_INVOICE_NO: iv.taxInvoice?.no ?? "—", REFERENCE: [o!.no, o!.customerRef ? `PO ${o!.customerRef}` : ""].filter(Boolean).join("\n"),
        BILL_TO: c.name, BILL_BRANCH: [o!.plant?.name, c.branchCode ? `branch ${c.branchCode}` : ""].filter(Boolean).join(", "), BILL_ADDRESS: c.billingAddress ?? c.addressEn ?? c.addressLocal ?? "", CUSTOMER_TAX_ID: c.taxId ?? "", ATTN: "Accounts Payable",
        L_NO: lf.L_NO, L_DESC: lines.map((l) => l.descriptionEn ?? l.description ?? l.descriptionLocal ?? ""), L_QTY: lf.L_QTY, L_PRICE: lf.L_PRICE, L_AMOUNT: lf.L_AMOUNT,
        SUBTOTAL: money(subtotal), VAT_LABEL: pctLabel(vatRate), VAT_AMOUNT: money(vat), INVOICE_TOTAL: money(total), SETTLED_TO_DATE: money(settled), WHT_LABEL: wht ? `${pctLabel(WHT_RATE_PLACEHOLDER)} on ${money(subtotal)}` : "", WHT_AMOUNT: wht ? `(${money(wht)})` : money(0), CURRENCY: iv.currency, AMOUNT_PAYABLE: money(round2(total - settled - wht)),
        BANK_LINES: bankLines(e.bankDetails as Bank | null, iv.currency), ACCOUNTS_EMAIL: e.email ?? "", TAX_INVOICE_NOTE_TH: iv.taxInvoice ? `ใบแจ้งหนี้นี้ไม่ใช่ใบกำกับภาษี ใบกำกับภาษีคือ ${iv.taxInvoice.no} ที่แนบมาด้วย` : "", TAX_INVOICE_NOTE_EN: iv.taxInvoice ? `This invoice is not a tax invoice; the tax invoice is ${iv.taxInvoice.no}, attached.` : "",
        PREPARED_BY: doc.createdBy.name, AUTHORISED_BY: e.signatoryName ?? "" } };
    }
    case "RC": {
      const rc = await prisma.receipt.findUniqueOrThrow({ where: { no }, include: { invoice: { include: { receipts: true, taxInvoice: true } } } });
      const c = o!.customer; const e = doc.entity;
      const before = rc.invoice.receipts.filter((r) => r.receivedAt <= rc.receivedAt && r.id !== rc.id).reduce((s, r) => s + Number(r.settledAmount), 0);
      const outstanding = round2(Number(rc.invoice.amountDue) - before - Number(rc.settledAmount));
      return { template: "22", values: { ...common, PAYER_NAME_TH: c.nameLocal ?? c.name, PAYER_NAME_EN: c.nameLocal ? c.name : "", PAYER_BRANCH: branchLabel(c.branchCode, o!.plant), PAYER_TAX_ID: c.taxId ?? "",
        RECEIVED_ON: d(rc.receivedAt), METHOD: rc.bankRef ? "Bank transfer  โอนเงิน" : "Cash  เงินสด", BANK_REF: rc.bankRef ?? "", TAX_INVOICE_NO: rc.taxInvoiceNo ?? rc.invoice.taxInvoice?.no ?? "—", INVOICE_NO: rc.invoice.no, CURRENCY: rc.currency,
        TI_TOTAL: money(rc.invoice.taxInvoice?.total ?? rc.invoice.amountDue), CASH_RECEIVED: money(rc.cashAmount), WHT_LABEL: Number(rc.whtAmount) ? pctLabel(Number(rc.whtAmount) / Number(rc.invoice.taxInvoice?.subtotal ?? rc.invoice.amountDue)) : "", WHT_CERT: rc.whtCertRef ? `certificate ${rc.whtCertRef}` : "", WHT_AMOUNT: money(rc.whtAmount), SETTLED: money(rc.settledAmount), OUTSTANDING: money(Math.max(0, outstanding)),
        CASH_WORDS_TH: thaiAmount(Number(rc.cashAmount), rc.currency), CASH_WORDS_EN: englishAmount(Number(rc.cashAmount), rc.currency), RECEIVED_BY: doc.createdBy.name, AUTHORISED_BY: e.signatoryName ?? "" } };
    }
    case "BL": {
      const bl = await prisma.monthlyStatement.findUniqueOrThrow({ where: { no }, include: { invoices: { include: { taxInvoice: true, serviceOrder: true, receipts: true }, orderBy: { issuedAt: "asc" } } } });
      const c = await prisma.customer.findUniqueOrThrow({ where: { id: bl.customerId } }); const e = doc.entity;
      const y = 2000 + Number(bl.period.slice(0, 2)), m = Number(bl.period.slice(2, 4));
      const start = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 0));
      const at = bl.issuedAt;
      const paid = (iv: (typeof bl.invoices)[number]) => round2(iv.receipts.reduce((s, r) => s + Number(r.settledAmount), 0));
      const outstanding = (iv: (typeof bl.invoices)[number]) => round2(Number(iv.amountDue) - paid(iv));
      const age = (iv: (typeof bl.invoices)[number]) => { const due = iv.dueAt ?? addDays(iv.issuedAt, c.paymentTermDays); return Math.floor((at.getTime() - due.getTime()) / 86_400_000); };
      const bucket = (f: (days: number) => boolean) => money(bl.invoices.filter((iv) => f(age(iv))).reduce((s, iv) => s + outstanding(iv), 0));
      const received = await prisma.receipt.findMany({ where: { invoice: { serviceOrder: { customerId: c.id } }, receivedAt: { gte: start, lte: addDays(end, 1) } } });
      return { template: "23", values: { ...common, CUSTOMER_NAME: c.name, CUSTOMER_CODE: c.code, CUSTOMER_ADDRESS: c.billingAddress ?? c.addressEn ?? c.addressLocal ?? "", CUSTOMER_TAX_ID: c.taxId ?? "", ATTN: "Accounts Payable",
        PERIOD: `${d(start)} → ${d(end)}`, ISSUE_DATE: d(bl.issuedAt), CREDIT_TERMS: `${c.paymentTermDays} days`, CURRENCY: bl.currency,
        L_IVTH: bl.invoices.map((iv) => iv.no), L_TITH: bl.invoices.map((iv) => iv.taxInvoice?.no ?? "—"), L_DATE: bl.invoices.map((iv) => d(iv.issuedAt)), L_DUE: bl.invoices.map((iv) => d(iv.dueAt ?? addDays(iv.issuedAt, c.paymentTermDays))),
        L_REF: bl.invoices.map((iv) => [iv.serviceOrder.no, iv.serviceOrder.customerRef ? `PO ${iv.serviceOrder.customerRef}` : "", iv.issuedAt < start ? "(brought forward)" : ""].filter(Boolean).join("\n")), L_AMOUNT: bl.invoices.map((iv) => money(iv.amountDue)), L_PAID: bl.invoices.map((iv) => money(paid(iv))), L_OUTSTANDING: bl.invoices.map((iv) => money(outstanding(iv))),
        INVOICED_PERIOD: money(bl.invoices.filter((iv) => iv.issuedAt >= start && iv.issuedAt <= addDays(end, 1)).reduce((s, iv) => s + Number(iv.amountDue), 0)), RECEIVED_PERIOD: money(received.reduce((s, r) => s + Number(r.settledAmount), 0)), TOTAL_OUTSTANDING: money(bl.invoices.reduce((s, iv) => s + outstanding(iv), 0)),
        AGE_CURRENT: bucket((n) => n <= 0), AGE_30: bucket((n) => n > 0 && n <= 30), AGE_60: bucket((n) => n > 30 && n <= 60), AGE_90: bucket((n) => n > 60 && n <= 90), AGE_OVER: bucket((n) => n > 90),
        PREPARED_BY: doc.createdBy.name, AUTHORISED_BY: e.signatoryName ?? "" } };
    }
    default:
      throw new Error(`no Word template for document type ${doc.type}`);
  }
}

/** Render a document to .docx (+ .pdf when soffice exists). Stores files under uploads/documents and sets Document.pdfUrl. */
/**
 * Customer-facing documents never print a customer person's full name (decision 2026-11-04): every contact name of
 * this customer, and any signatory typed by hand, is replaced by its masked form wherever it appears in a field.
 */
export async function buildFields(no: string, templateHint?: string): Promise<{ template: string; values: FieldValues }> {
  const r = await buildFieldsRaw(no, templateHint);
  const doc = await prisma.document.findUniqueOrThrow({ where: { no }, select: { customerId: true, serviceOrderId: true } });
  const [contacts, acc, dns] = await Promise.all([
    doc.customerId ? prisma.contact.findMany({ where: { customerId: doc.customerId }, select: { name: true } }) : Promise.resolve([]),
    doc.serviceOrderId ? prisma.acceptance.findUnique({ where: { serviceOrderId: doc.serviceOrderId }, select: { customerSignatory: true } }) : Promise.resolve(null),
    doc.serviceOrderId ? prisma.deliveryNote.findMany({ where: { serviceOrderId: doc.serviceOrderId }, select: { signedBy: true } }) : Promise.resolve([]),
  ]);
  const names = [...new Set([...contacts.map((c) => c.name), acc?.customerSignatory, ...dns.map((x) => x.signedBy)].filter((x): x is string => !!x && x.trim().length > 1))].sort((a, b) => b.length - a.length);
  return { template: r.template, values: maskNamesIn(r.values, names) };
}

/** The DCiT templates are bilingual by design, so every document renders once — no per-language copies (decision 2026-11-03). */
export async function renderDocument(no: string, template?: string): Promise<{ docxPath: string; pdfPath?: string; unfilled: string[] }> {
  const { template: tpl, values } = await buildFields(no, template);
  const file = TEMPLATE_FILES[template ?? tpl];
  if (!file) throw new Error(`unknown template ${template ?? tpl}`);
  const { docx, unfilled } = fillDocx(await readFile(path.join(TEMPLATES, file)), values);
  await mkdir(OUT, { recursive: true });
  const docxPath = path.join(OUT, `${no}${template ? `-${template}` : ""}.docx`);
  await writeFile(docxPath, docx);
  let pdfPath: string | undefined;
  try {
    const soffice = await sofficePath();
    if (!soffice) throw new Error("no LibreOffice");
    await exec(soffice, ["--headless", "--convert-to", "pdf", "--outdir", OUT, docxPath], { timeout: 120000 });
    pdfPath = path.join(OUT, `${no}${template ? `-${template}` : ""}.pdf`);
    if (!template) await prisma.document.update({ where: { no }, data: { pdfUrl: `/api/documents/${no}/pdf`, templateCode: tpl } });
  } catch {
    // LibreOffice not installed on this host: the .docx is still delivered
  }
  return { docxPath, pdfPath, unfilled };
}
