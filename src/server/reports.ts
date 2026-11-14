/**
 * Report generation: a registered document number → the DCiT Word template it belongs to → field values from the
 * event data → .docx (and .pdf when LibreOffice is installed). Nothing is typed by hand; the template layout is untouched.
 */
import { localIso } from "@/lib/dates";
import { bankLines, type BankDetails } from "@/lib/bank";
import { PHASE_NAME, paymentScheduleLines, type ProjectInfo } from "@/lib/project";
import type { RequestLine } from "@/lib/modes";
import { EXPORT_VAT_RATE, incotermLine, shipTotals, transportDoc, type Shipping, type TradeTerms } from "@/lib/export";
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { convertToPdf } from "./office";
import path from "node:path";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { fillDocx, type FieldValues } from "@/lib/docx/fill";
import { maskNamesIn } from "@/lib/mask";
import { englishAmount, thaiAmount } from "@/lib/amount-words";

const TEMPLATES = path.join(process.cwd(), "templates", "word");
const OUT = process.env.DOCS_DIR ?? path.join(process.cwd(), "uploads", "documents");

const TEMPLATE_FILES: Record<string, string> = {
  "04": "04_Repair_Service_Proposal.docx", "06": "06_Order_Confirmation.docx", "07": "07_Equipment_Receiving.docx",
  "08": "08_Diagnostic_Report.docx", "09": "09_Repair_Report.docx", "10": "10_Field_Service_Report.docx",
  "11": "11_Preventive_Maintenance_Record.docx", "12": "12_Service_Completion.docx", "13": "13_Customer_Acceptance.docx", "19": "19_Delivery_Note.docx",
  "20": "20_Tax_Invoice.docx", "21": "21_Invoice.docx", "22": "22_Receipt.docx", "23": "23_Statement.docx",
  "24": "24_Purchase_Inquiry.docx", "25": "25_Purchase_Order.docx", "26": "26_Goods_Receipt.docx", "27": "27_Stock_Issue.docx",
  "30": "30_Sales_Quotation.docx", "31": "31_Sales_Order_Confirmation.docx", "33": "33_Commercial_Invoice.docx", "34": "34_Packing_List.docx", "35": "35_Proforma_Invoice.docx",
  "28": "28_Subcontract_Dispatch.docx", "29": "29_Subcontract_Return.docx",
};

/**
 * Withholding tax the customer is expected to deduct from a service / hire-of-work invoice: 3 % when payer and payee
 * are both Thai juristic persons (Revenue Department rate table; confirmed 2026-11-08). Pure sale of goods is not
 * withheld; transport 1 %, advertising 2 %, rent 5 % — a repair with parts supplied is hire of work → 3 %.
 */
export const WHT_SERVICE_RATE = 0.03;
const money = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pctLabel = (r: unknown) => `${(Number(r) * 100).toFixed(2).replace(/\.?0+$/, "")}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const addDays = (x: Date, n: number) => new Date(x.getTime() + n * 86_400_000);

type TiLine = { descriptionLocal?: string; descriptionEn?: string; description?: string; qty: number | string; unit?: string; unitPrice: number | string; amount: number | string };
const tiLines = (lines: TiLine[]) => ({
  L_NO: lines.map((_, i) => i + 1), L_DESC: lines.map((l) => [l.descriptionLocal, l.descriptionEn ?? l.description].filter((x, i, a) => x && a.indexOf(x) === i).join("\n")),
  L_QTY: lines.map((l) => String(Number(l.qty))), L_UNIT: lines.map((l) => l.unit ?? ""), L_PRICE: lines.map((l) => money(l.unitPrice)), L_AMOUNT: lines.map((l) => money(l.amount)),
});
const DISPOSITION: Record<string, string> = { SCRAP: "Scrap at DCiT\nทิ้งที่ DCiT", RETURN_TO_CUSTOMER: "Return to customer\nคืนลูกค้า", KEEP_FOR_ANALYSIS: "Keep for analysis\nเก็บวิเคราะห์" };
const branchLabel = (code?: string | null, plant?: { name: string } | null) => [code, plant?.name ? `(${plant.name})` : ""].filter(Boolean).join(" ");

const d = (x: Date | null | undefined) => (x ? localIso(x)!.slice(0, 10) : "");
type TestRow = { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean };

const KIND: Record<string, string> = { REPAIR: "Repair\nซ่อม", MAINTENANCE: "Maintenance\nบำรุงรักษา", OVERHAUL: "Overhaul\nยกเครื่อง", CONTRACT: "Contract service\nบริการตามสัญญา", PARTS_SALE: "Parts supply\nจำหน่ายอะไหล่" };
const IMPACT: Record<string, string> = { STOPPED: "Line stopped\nไลน์ผลิตหยุด", DEGRADED: "Running degraded\nผลิตได้แต่ช้าลง", NONE: "No production impact\nไม่กระทบการผลิต" };
/** Report names as the customer reads them — never template numbers ("Repair Report 09"). */
const REPORT_NAME: Record<string, [string, string]> = { IN: ["Diagnostic report", "รายงานการตรวจสอบ"], RP: ["Repair report", "รายงานการซ่อม"], PM: ["Maintenance record", "บันทึกการบำรุงรักษา"], FS: ["Field service report", "รายงานบริการนอกสถานที่"] };
const both = (n?: [string, string]) => (n ? `${n[0]}  ${n[1]}` : "");
const lines_ = (...xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x && !!x.trim()).join("\n");
const CHECK = (on: boolean) => (on ? "☒" : "☐");
const SIGN_HINT = "Name / date  ชื่อ / วันที่";
const NONE = "None  ไม่มี";
const hm = (x: Date) => localIso(x)!.slice(11, 16);

type FullAsset = { code: string; serialNumber: string; type: string; location: string | null; model: { code: string; series: { name: string; brand: { name: string } } } | null };
const assetFull = { model: { include: { series: { include: { brand: true } } } } } as const;

/** Customer block (left of every customer document): local name bold, then English name, plant, address, tax ID, contact — one item per line. */
function partyFields(c: { name: string; nameLocal: string | null; addressLocal: string | null; addressEn: string | null; taxId: string | null }, plant?: { name: string; address: string | null } | null, contact?: { name: string; title: string | null } | null) {
  return { CUSTOMER_NAME: c.nameLocal ?? c.name, CUSTOMER_DETAILS: lines_(c.nameLocal ? c.name : "", plant?.name, plant?.address ?? c.addressLocal ?? c.addressEn, c.taxId ? `Tax ID  ${c.taxId}` : "", contact ? `Attn: ${contact.name}${contact.title ? `, ${contact.title}` : ""}` : "") };
}
/** Equipment rows [[L_EQ_*]] — brand and series above the model code, plant above the machine's location. */
function equipmentRows(assets: FullAsset[], plantName?: string | null) {
  return {
    L_EQ_ASSET: assets.map((a) => a.code),
    L_EQ_MODEL: assets.map((a) => (a.model ? lines_(`${a.model.series.brand.name} ${a.model.series.name}`, a.model.code) : a.type)),
    L_EQ_SERIAL: assets.map((a) => a.serialNumber),
    L_EQ_LOCATION: assets.map((a) => lines_(plantName, a.location) || "—"),
  };
}
/** Line rows for a table; nothing to list → one row saying so, so the table never stands empty. */
function rowsOf<T>(items: T[], cols: Record<string, (x: T, i: number) => string | number>, empty: string): FieldValues {
  const keys = Object.keys(cols);
  if (!items.length) return Object.fromEntries(keys.map((k, i) => [k, [i === 0 ? "—" : i === 1 ? empty : ""]]));
  return Object.fromEntries(keys.map((k) => [k, items.map((x, i) => cols[k](x, i))]));
}
const testRows = (tests: TestRow[] | null | undefined) => rowsOf(tests ?? [], {
  L_T_NO: (_, i) => i + 1, L_T_TEST: (t) => t.test ?? "", L_T_CRITERION: (t) => t.criterion ?? "", L_T_RECORD: (t) => t.recordId ?? "",
  L_T_RESULT: (t) => t.result || (t.pass === true ? "Pass  ผ่าน" : t.pass === false ? "Fail  ไม่ผ่าน" : ""),
}, "No tests recorded  ไม่มีการบันทึกการทดสอบ");
const LEVEL: Record<string, string> = { QUARTERLY: "Quarterly\nรายไตรมาส", HALF_YEAR: "Half-yearly\nราย 6 เดือน", ANNUAL: "Annual\nรายปี", CONTRACT: "Contract visit\nตามสัญญา" };
const CONDITION: Record<string, string> = { GOOD: "Good  ดี", GOOD_WITH_ISSUE: "Good, with findings  ดี มีข้อสังเกต", POOR: "Poor  ไม่ดี" };
const VERDICT: Record<string, string> = { OK: "OK  ปกติ", HANDLED: "Fixed  แก้ไขแล้ว", HAZARD: "Hazard  มีความเสี่ยง", WATCH: "Watch  เฝ้าระวัง" };
const PLACE: Record<string, string> = { SITE: "On site\nหน้างาน", WORKSHOP: "Workshop\nโรงซ่อม" };
/** Warranty on 12 / 13: start, end from the promised days, then any terms typed at acceptance — one item per line. */
function warrantyLines(start: Date | null | undefined, days: number | null | undefined, terms: string | null | undefined): string {
  const until = start && days != null ? new Date(start.getTime() + days * 86_400_000) : null;
  return lines_(start ? `From  เริ่ม  ${d(start)}` : "", until ? `Until  ถึง  ${d(until)}  (${days} days  ${days} วัน)` : "", terms);
}

/**
 * 04 service proposal · 06 order confirmation · 12 service completion · 13 customer acceptance — all under the QTTH.
 * Built by scripts/templates/build_service_templates.py (v0.3 print system); only what the order forms record (rule 21).
 */
async function serviceFields(doc: { no: string; issuedAt: Date; createdBy: { name: string; phone: string | null }; entity: { vatRate: unknown; signatoryName: string | null }; serviceOrderId: string | null }, want: string): Promise<FieldValues> {
  const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { id: doc.serviceOrderId! }, include: {
    customer: true, plant: true, reportedBy: true, assignee: true,
    assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } },
    lines: { orderBy: { lineNo: "asc" }, include: { part: { select: { sku: true } } } }, acceptance: { include: { customerContact: true } },
    documents: { where: { voidedAt: null, type: { in: ["IN", "RP", "PM"] } }, orderBy: { issuedAt: "asc" }, select: { no: true, type: true, templateCode: true } },
    deliveries: { where: { status: { not: "DRAFT" } }, orderBy: { deliverOn: "asc" }, select: { no: true } },
    events: { where: { type: "ORDER_CONFIRMED" }, orderBy: { occurredAt: "asc" }, take: 1, include: { actor: true } },
    repairJobs: { where: { finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, take: 1, include: { engineer: true } },
    milestones: { orderBy: { seq: "asc" } },
  } });
  const c = o.customer;
  const party = partyFields(c, o.plant, o.reportedBy);
  const equipment = equipmentRows(o.assets.map((x) => x.asset), o.plant?.name);
  const po = o.customerRef ?? "—";
  const tt = o.tradeTerms as TradeTerms | null; // 国际贸易: the terms fixed on the order
  // 自动化项目: instalments by milestone, each invoiced when the milestone is done (src/lib/project.ts)
  const pj = o.mode === "AUTOMATION_PROJECT" ? (o.project as unknown as ProjectInfo | null) : null;
  const schedule = pj ? paymentScheduleLines(o.milestones.map((m) => ({ seq: m.seq, phase: m.phase, payPct: m.payPct == null ? null : Number(m.payPct), doneAt: m.doneAt })), PHASE_NAME) : "";
  const terms = tt ? lines_(tt.paymentTerms, tt.paymentDays ? `${tt.paymentDays} days from invoice` : "") : pj ? lines_(schedule, `Each instalment due ${c.paymentTermDays} days from its invoice`, `ชำระภายใน ${c.paymentTermDays} วันนับจากวันที่ใบแจ้งหนี้แต่ละงวด`) : `${c.paymentTermDays} days from invoice\n${c.paymentTermDays} วันนับจากวันที่ใบแจ้งหนี้`;
  const onSite = o.documents.some((x) => x.templateCode === "10");
  const trade = want === "30" || want === "31";
  const docs = pj ? lines_("Project solution and drawings  แบบและเอกสารโครงการ", "Factory and site test records  บันทึกการทดสอบ", "Delivery note  ใบส่งของ", "Customer acceptance record  บันทึกการตรวจรับงาน", "Tax invoice and receipt per instalment  ใบกำกับภาษีและใบเสร็จรับเงินตามงวด") : tt ? lines_("Commercial invoice  ใบกำกับสินค้า", "Packing list  รายการบรรจุหีบห่อ", "Receipt  ใบเสร็จรับเงิน") : trade ? lines_("Delivery note  ใบส่งของ", "Tax invoice and receipt  ใบกำกับภาษีและใบเสร็จรับเงิน") : lines_(
    o.kind !== "PARTS_SALE" && o.kind !== "MAINTENANCE" ? both(REPORT_NAME.IN) : "",
    // 合作维修: the partner's work is never shown to the customer — our retest gates the delivery, there is no RPTH
    both(o.kind === "MAINTENANCE" ? REPORT_NAME.PM : o.kind !== "PARTS_SALE" && o.mode !== "PARTNER_REPAIR" ? (onSite ? REPORT_NAME.FS : REPORT_NAME.RP) : undefined),
    "Delivery note  ใบส่งของ",
    o.kind !== "PARTS_SALE" ? "Service completion confirmation  ใบยืนยันงานบริการแล้วเสร็จ" : "",
    o.kind !== "PARTS_SALE" ? "Customer acceptance record  บันทึกการตรวจรับงาน" : "",
    "Tax invoice and receipt  ใบกำกับภาษีและใบเสร็จรับเงิน",
  );
  const signHint = SIGN_HINT;
  // What we promise the customer (quote page, rule 26: partner work is back-to-back on the same days); runs from acceptance.
  const promise = o.warrantyDays != null ? `${o.warrantyDays} days from acceptance\n${o.warrantyDays} วันนับจากวันตรวจรับงาน` : "—";

  if (want === "04" || want === "06" || trade) {
    const subtotal = o.subtotal != null ? Number(o.subtotal) : round2(o.lines.reduce((s, l) => s + Number(l.amount), 0));
    const vatRate = tt ? EXPORT_VAT_RATE : Number(doc.entity.vatRate);
    const vat = o.vatAmount != null ? Number(o.vatAmount) : round2(subtotal * vatRate);
    const total = o.total != null ? Number(o.total) : round2(subtotal + vat);
    const priced = {
      L_NO: o.lines.map((l) => l.lineNo), L_DESC: o.lines.map((l) => lines_(l.descriptionLocal && l.descriptionLocal !== l.description ? l.descriptionLocal : "", l.description)),
      L_ASSET: o.lines.map((l) => l.assetCode ?? ""), L_SKU: o.lines.map((l) => l.part?.sku ?? ""), L_QTY: o.lines.map((l) => String(Number(l.qty))), L_UNIT: o.lines.map((l) => l.unit), L_PRICE: o.lines.map((l) => money(l.unitPrice)), L_AMOUNT: o.lines.map((l) => money(l.amount)),
      SUBTOTAL: money(subtotal), VAT_LABEL: pctLabel(vatRate), VAT_AMOUNT: money(vat), CURRENCY: o.currency, TOTAL: money(total),
      TOTAL_WORDS_TH: thaiAmount(total, o.currency), TOTAL_WORDS_EN: englishAmount(total, o.currency),
    };
    if (want === "30") {
      const owner = o.assignee ?? doc.createdBy;
      return { ...party, ...priced, ISSUE_DATE: d(o.quoteSentAt ?? doc.issuedAt), CUSTOMER_REF: o.customerRef ?? "—", OUR_CONTACT: lines_(owner.name, owner.phone), PAYMENT_TERMS: terms, DELIVERABLE_DOCS: docs,
        DELIVERY_TERMS: pj ? lines_(pj.name, `Delivered, installed and commissioned at ${o.plant?.name ?? c.name}${pj.dueDate ? `, by ${pj.dueDate}` : ""}`, `ส่งมอบ ติดตั้ง และทดสอบเดินเครื่อง ณ ${o.plant?.name ?? c.nameLocal ?? c.name}`) : tt ? lines_(incotermLine(tt), [tt.destPort, tt.destCountry].filter(Boolean).join(", ")) : lines_(`Delivered to ${o.plant?.name ?? c.name}`, `ส่งถึง ${o.plant?.name ?? c.nameLocal ?? c.name}`),
        TO_PROCEED: `Please send your purchase order quoting ${o.no}.\nกรุณาส่งใบสั่งซื้อโดยอ้างอิงเลขที่ ${o.no}`,
        PREPARED_BY: doc.createdBy.name, AUTHORISED_BY: doc.entity.signatoryName ?? "", CUSTOMER_SIGNATORY: signHint };
    }
    if (want === "04") {
      const insp = await prisma.inspection.findFirst({ where: { serviceOrderId: o.id, draft: false }, orderBy: { inspectedAt: "desc" } });
      const owner = o.assignee ?? doc.createdBy;
      return { ...party, ...equipment, ...priced, ISSUE_DATE: d(o.quoteSentAt ?? doc.issuedAt), REQUESTED_ON: d(o.reportedAt), SERVICE_KIND: KIND[o.kind] ?? o.kind, OUR_CONTACT: lines_(owner.name, owner.phone),
        SYMPTOM: lines_(o.reportedSymptom, o.reportedAlarm ? `Alarm  ${o.reportedAlarm}` : "") || "—", IMPACT: IMPACT[o.productionImpact ?? ""] ?? (o.productionImpact || "—"),
        FINDINGS: lines_(insp?.findings, insp?.probableCause ? `Probable cause: ${insp.probableCause}` : "") || "—", RECOMMENDATION: insp?.recommendation || "—",
        PAYMENT_TERMS: terms, WARRANTY: promise, DELIVERABLE_DOCS: docs,
        TO_PROCEED: `Please send your purchase order quoting ${o.no}. Work starts when the purchase order is received.\nกรุณาส่งใบสั่งซื้อโดยอ้างอิงเลขที่ ${o.no} งานจะเริ่มเมื่อได้รับใบสั่งซื้อ`,
        PREPARED_BY: doc.createdBy.name, AUTHORISED_BY: doc.entity.signatoryName ?? "", CUSTOMER_SIGNATORY: signHint };
    }
    const confirmed = o.events[0];
    return { ...party, ...equipment, ...priced, CONFIRMED_ON: d(confirmed?.occurredAt ?? o.quoteConfirmedAt ?? doc.issuedAt), CUSTOMER_PO: po, QUOTE_REF: lines_(o.no, d(o.quoteSentAt ?? doc.issuedAt)), PAYMENT_TERMS: terms,
      DELIVER_TO: tt ? lines_(incotermLine(tt), [tt.destPort, tt.destCountry].filter(Boolean).join(", ")) : lines_(c.name, o.plant?.name, o.plant?.address ?? c.addressLocal ?? c.addressEn), WARRANTY: promise,
      CONFIRMED_BY: confirmed?.actor?.name ?? doc.createdBy.name, AUTHORISED_BY: doc.entity.signatoryName ?? "", CUSTOMER_SIGNATORY: signHint };
  }

  // 12 / 13: from the acceptance record
  const acc = o.acceptance;
  const dv = (acc?.deliverables as { deliverable: string; criterion?: string; result?: string }[] | null) ?? [];
  const reports = o.documents.map((x) => `${x.no}  ${(x.type === "RP" && x.templateCode === "10" ? REPORT_NAME.FS : REPORT_NAME[x.type])?.[0] ?? ""}`.trim()); // English name only: one report per line in a narrow cell
  const shared = { ...party, ...equipment, CUSTOMER_PO: po, REPORTS: reports.join("\n") || "—", DELIVERY_NOTES: o.deliveries.map((x) => x.no).join("\n") || "—",
    L_DV_NO: dv.map((_, i) => i + 1), L_DV_ITEM: dv.map((x) => x.deliverable), L_DV_CRITERION: dv.map((x) => x.criterion ?? ""), L_DV_RESULT: dv.map((x) => x.result ?? ""),
    PUNCH_LIST: acc?.punchList?.trim() || "None  ไม่มี", WARRANTY: warrantyLines(acc?.warrantyStart ?? acc?.acceptedAt, o.warrantyDays, acc?.warrantyTerms) || "—",
    CUSTOMER_SIGNATORY: acc?.customerSignatory ?? acc?.customerContact?.name ?? signHint };
  const job = o.repairJobs[0];
  if (want === "12") return { ...shared, COMPLETED_ON: d(job?.finishedAt ?? acc?.acceptedAt ?? doc.issuedAt), COMPLETED_BY: acc?.dcitSignatory ?? job?.engineer.name ?? doc.createdBy.name };
  return { ...shared, ACCEPTED_ON: d(acc?.acceptedAt ?? doc.issuedAt), CHK_ACCEPTED: CHECK(acc?.status === "ACCEPTED"), CHK_CONDITIONAL: CHECK(acc?.status === "CONDITIONAL"), CHK_REJECTED: CHECK(acc?.status === "REJECTED"),
    RECORDED_BY: acc?.dcitSignatory ?? doc.createdBy.name };
}

// ── 国际贸易: 33 commercial invoice (the IVTH) and 34 packing list (the DNTH) — src/server/export.ts ──────────────
type ExportDoc = { issuedAt: Date; createdBy: { name: string }; entity: { signatoryName: string | null; bankDetails: unknown } };
type ExportOrder = { id: string; no: string; customerRef: string | null; tradeTerms: unknown; requestLines: unknown };

async function shipmentOf(orderId: string) {
  const dn = await prisma.deliveryNote.findFirst({ where: { serviceOrderId: orderId, status: { not: "DRAFT" }, shipping: { not: Prisma.AnyNull } }, orderBy: { createdAt: "asc" } });
  return dn ? { no: dn.no, shipping: dn.shipping as unknown as Shipping } : null;
}
function shipmentValues(s: Shipping | undefined, tt: TradeTerms | null) {
  return {
    PORT_LOADING: s?.portLoading || "—", PORT_DISCHARGE: s?.portDischarge || tt?.destPort || "—", DEST_COUNTRY: tt?.destCountry ?? "—",
    TRANSPORT: s ? lines_(SHIP_MODE_EN[s.shipMode] ?? s.shipMode, s.vessel, s.forwarder) : "—",
    DEPARTURE: s ? lines_(s.shippedAt ? `Shipped on ${s.shippedAt}` : s.etd ? `ETD ${s.etd}` : "", s.eta ? `ETA ${s.eta}` : "") || "—" : "—",
    TRANSPORT_DOC: s?.blNo ? `${transportDoc(s.shipMode)} ${s.blNo}` : "—", EXPORT_ENTRY: s?.exportEntryNo || "—", MARKS: s?.marks?.trim() || "N/M",
  };
}
const SHIP_MODE_EN: Record<string, string> = { SEA: "By sea  ทางเรือ", AIR: "By air  ทางอากาศ", ROAD: "By road  ทางบก", COURIER: "Courier  บริการขนส่งด่วน" };

async function commercialInvoiceFields(no: string, doc: ExportDoc, o: ExportOrder, common: FieldValues, party: FieldValues): Promise<FieldValues> {
  const iv = await prisma.invoice.findUniqueOrThrow({ where: { no } });
  const tt = o.tradeTerms as TradeTerms | null;
  const ship = await shipmentOf(o.id);
  const byLine = new Map((ship?.shipping.lines ?? []).map((l) => [l.lineNo, l]));
  const q = await prisma.quoteLine.findMany({ where: { serviceOrderId: o.id }, orderBy: { lineNo: "asc" }, include: { part: { select: { sku: true } } } });
  const asked = (o.requestLines as RequestLine[] | null) ?? []; // before the goods are packed: HS code and origin as inquired
  const cust = (l: (typeof q)[number], i: number) => byLine.get(l.lineNo) ?? asked.find((x) => x.sku && x.sku === l.part?.sku) ?? (l.part ? asked[i] : undefined);
  const subtotal = round2(q.reduce((s, l) => s + Number(l.amount), 0));
  const total = Number(iv.amountDue), vat = round2(total - subtotal);
  return { ...common, ...party, ISSUE_DATE: d(iv.issuedAt), CUSTOMER_PO: lines_(o.customerRef, `Our quotation ${o.no}`), INCOTERMS: tt ? incotermLine(tt) : "—", INCOTERM_CODE: tt?.incoterm ?? "",
    PAYMENT_TERMS: tt ? lines_(tt.paymentTerms, iv.dueAt ? `Due ${d(iv.dueAt)}` : "") : "—", PACKING_LIST_NO: ship?.no ?? "—",
    L_NO: q.map((l) => l.lineNo), L_DESC: q.map((l) => l.description), L_SKU: q.map((l) => l.part?.sku ?? ""), L_HS: q.map((l, i) => cust(l, i)?.hsCode ?? ""), L_ORIGIN: q.map((l, i) => cust(l, i)?.origin ?? ""),
    L_QTY: q.map((l) => String(Number(l.qty))), L_UNIT: q.map((l) => l.unit), L_PRICE: q.map((l) => money(l.unitPrice)), L_AMOUNT: q.map((l) => money(l.amount)),
    SUBTOTAL: money(subtotal), VAT_LABEL: vat ? pctLabel(vat / subtotal) : `${pctLabel(EXPORT_VAT_RATE)} export (s.80/1)`, VAT_AMOUNT: money(vat), CURRENCY: iv.currency, TOTAL: money(total), TOTAL_WORDS_EN: englishAmount(total, iv.currency),
    BANK_LINES: bankLines(doc.entity.bankDetails as BankDetails | null, iv.currency),
    ...shipmentValues(ship?.shipping, tt), PREPARED_BY: doc.createdBy.name, AUTHORISED_BY: doc.entity.signatoryName ?? "" };
}

async function packingListFields(no: string, doc: ExportDoc, o: ExportOrder, common: FieldValues, party: FieldValues): Promise<FieldValues> {
  const dn = await prisma.deliveryNote.findUniqueOrThrow({ where: { no } });
  const s = dn.shipping as unknown as Shipping;
  const tt = o.tradeTerms as TradeTerms | null;
  const ci = await prisma.document.findFirst({ where: { serviceOrderId: o.id, type: "PF", voidedAt: null }, select: { no: true } });
  const tot = shipTotals(s.lines);
  const kg = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })} kg`;
  return { ...common, ...party, ISSUE_DATE: d(dn.deliverOn), INVOICE_NO: ci?.no ?? "—", CUSTOMER_PO: o.customerRef ?? "—", INCOTERMS: tt ? incotermLine(tt) : "—",
    L_NO: s.lines.map((l) => l.lineNo), L_DESC: s.lines.map((l) => l.description), L_SKU: s.lines.map((l) => l.sku ?? ""), L_HS: s.lines.map((l) => l.hsCode),
    L_QTY: s.lines.map((l) => `${l.qty} ${l.unit}`), L_PKGS: s.lines.map((l) => String(l.packages)), L_NET: s.lines.map((l) => String(l.netKg)), L_GROSS: s.lines.map((l) => String(l.grossKg)),
    TOTAL_PACKAGES: `${tot.packages} ${s.packageKind}`, TOTAL_NET: kg(tot.netKg), TOTAL_GROSS: kg(tot.grossKg), TOTAL_CBM: s.cbm ? `${s.cbm} m³` : "—",
    ...shipmentValues(s, tt), PREPARED_BY: doc.createdBy.name, AUTHORISED_BY: doc.entity.signatoryName ?? "" };
}

/** Build the field map for one document. Returns template code + values. */
async function buildFieldsRaw(no: string, templateHint?: string): Promise<{ template: string; values: FieldValues }> {
  const doc = await prisma.document.findUniqueOrThrow({ where: { no }, include: { entity: true, customer: true, createdBy: true, serviceOrder: { include: { plant: true, customer: true, assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } } } } } });
  const o = doc.serviceOrder;
  const a = o?.assets[0]?.asset;
  const party = o ? partyFields(o.customer, o.plant, o.reportedById ? await prisma.contact.findUnique({ where: { id: o.reportedById } }) : null) : { CUSTOMER_NAME: doc.customer?.name ?? "", CUSTOMER_DETAILS: "" };
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

  // 合作维修 (2026-11-08): partner-facing documents never carry the customer — not even as unused fill values
  const partnerSafe = (v: FieldValues): FieldValues => ({ ...v, CUSTOMER_SITE: "", CUSTOMER_NAME: "", SITE: "", JOB_PO: "", PO_JOB: "" });

  switch (doc.type) {
    case "IN": {
      const i = await prisma.inspection.findUniqueOrThrow({ where: { no }, include: { engineer: true, asset: { include: assetFull } } });
      return { template: "08", values: { ...common, ...party, ...equipmentRows([i.asset], o?.plant?.name), ...testRows(i.tests as TestRow[] | null),
        INSPECTED_ON: d(i.inspectedAt), JOB_NO: o?.no ?? "—", CUSTOMER_REF: o?.customerRef ?? "—", LOCATION: PLACE[i.location ?? ""] ?? "—",
        SYMPTOMS: i.symptoms || o?.reportedSymptom || "—", CONDITIONS: i.conditions || "—", FINDINGS: i.findings || "—", PROBABLE_CAUSE: i.probableCause || "—", RECOMMENDATION: i.recommendation || "—",
        INSTRUMENTS: i.instruments || "—", ATTACHMENTS: lines_(i.attachmentRefs, ...((i.attachments as { name: string }[] | null) ?? []).map((x) => x.name)) || "—",
        OPEN_ISSUES: i.openIssues || NONE, CONCLUSION: i.conclusion || "—",
        ENGINEER: i.engineer.name, APPROVER: SIGN_HINT, CUSTOMER_SIGNATORY: SIGN_HINT } }; // INTH needs are internal (rule 21) — never printed
    }
    case "RP":
    case "PM": {
      const j = await prisma.repairJob.findUniqueOrThrow({ where: { no }, include: { engineer: true, asset: { include: assetFull } } });
      const head = { ...common, ...party, ...equipmentRows([j.asset], o?.plant?.name), JOB_NO: o?.no ?? "—", CUSTOMER_REF: o?.customerRef ?? "—", ENGINEER: j.engineer.name, CUSTOMER_SIGNATORY: SIGN_HINT };
      if (doc.templateCode === "11" || j.kind === "MAINTENANCE") {
        const escort = j.escortContactId ? (await prisma.contact.findUnique({ where: { id: j.escortContactId } }))?.name : undefined; // masked with the other contact names below
        const items = (j.checklist as { item: string; criterion?: string; measured?: string; verdict?: string }[] | null) ?? [];
        return { template: "11", values: { ...head, ...rowsOf(items, { L_C_NO: (_, i) => i + 1, L_C_ITEM: (x) => x.item, L_C_CRITERION: (x) => x.criterion ?? "", L_C_MEASURED: (x) => x.measured ?? "", L_C_RESULT: (x) => VERDICT[x.verdict ?? ""] ?? x.verdict ?? "" }, "No checklist recorded  ไม่มีรายการตรวจ"),
          VISIT_DATE: d(j.finishedAt ?? j.startedAt ?? doc.issuedAt), LEVEL: LEVEL[j.level ?? ""] ?? (j.level || "—"), RUN_HOURS: j.runHours != null ? `${j.runHours.toLocaleString("en-US")} h` : "—",
          CONDITION: CONDITION[j.conditionRating ?? ""] ?? (j.conditionRating || "—"), HAZARDS: j.hazards || NONE, HANDLED: j.handled || "—", CONSUMABLES: j.consumables || "—", RECOMMENDATION: j.recommendation || "—",
          NEXT_DUE: lines_(j.nextDueAt ? d(j.nextDueAt) : "", j.nextDueHours ? `or at ${j.nextDueHours.toLocaleString("en-US")} h  หรือที่ ${j.nextDueHours.toLocaleString("en-US")} ชั่วโมง` : "") || "—",
          CUSTOMER_SIGNATORY: escort ?? SIGN_HINT } };
      }
      const replaced = (j.partsReplaced as { partSku: string; qty: number; oldSerial?: string; newSerial?: string }[] | null) ?? [];
      const names = new Map((await prisma.part.findMany({ where: { sku: { in: replaced.map((x) => x.partSku) } }, select: { sku: true, name: true } })).map((x) => [x.sku, x.name]));
      const parts = rowsOf(replaced, { L_P_NO: (_, i) => i + 1, L_P_PART: (x) => lines_(x.partSku, names.get(x.partSku)), L_P_QTY: (x) => x.qty, L_P_OLD: (x) => x.oldSerial ?? "", L_P_NEW: (x) => x.newSerial ?? "" }, "No parts replaced  ไม่มีการเปลี่ยนอะไหล่"); // stock documents (OBTH) stay internal
      const work = { ...head, ...parts, ...testRows(j.tests as TestRow[] | null), ROOT_CAUSE: j.rootCause || "—", WORK_PERFORMED: j.workPerformed || "—", OPEN_ISSUES: j.openIssues || NONE };
      if (doc.templateCode === "10" || j.location === "SITE") {
        const time = lines_(j.startedAt && j.finishedAt ? `${hm(j.startedAt)} – ${hm(j.finishedAt)}` : "", j.laborHours ? `${Number(j.laborHours)} h  ชั่วโมง` : "");
        return { template: "10", values: { ...work, SERVICE_DATE: d(j.startedAt ?? j.finishedAt ?? doc.issuedAt), TIME_ON_SITE: time || "—", ISSUE_SCOPE: j.confirmedFault || o?.reportedSymptom || "—", HANDOVER: j.conclusion || "—" } };
      }
      const insp = o ? await prisma.inspection.findFirst({ where: { serviceOrderId: o.id, assetId: j.assetId, draft: false }, orderBy: { inspectedAt: "desc" }, select: { no: true } }) : null;
      return { template: "09", values: { ...work, COMPLETED_ON: d(j.finishedAt ?? j.startedAt ?? doc.issuedAt), INSPECTION_REF: insp?.no ?? "—", CONFIRMED_FAULT: j.confirmedFault || "—", CONFIG_BACKUP: j.configBackupRef || "—", CONCLUSION: j.conclusion || "—", APPROVER: SIGN_HINT } };
    }
    case "ER": {
      // one ERTH may list several machines: every machine in the equipment table, each one's own accessories and condition under its ATH
      const evs = await prisma.assetEvent.findMany({ where: { sourceDocNo: no, type: "RECEIVED_WORKSHOP" }, orderBy: { id: "asc" }, include: { asset: { include: assetFull }, actor: true } });
      if (!evs.length) throw new Error(`NOT_FOUND:${no}`);
      const ev = evs[0];
      const each = (k: string) => evs.length === 1 ? ((evs[0].payload as Record<string, string> | null)?.[k] ?? "") : evs.map((e) => { const v = (e.payload as Record<string, string> | null)?.[k]; return v ? `${e.asset.code}: ${v}` : ""; }).filter(Boolean).join("\n");
      const pl: Record<string, string> = { ...((ev.payload as Record<string, string> | null) ?? {}), fault: each("fault"), accessories: each("accessories"), condition: each("condition") };
      const photos = ((ev.attachments as { name: string }[] | null) ?? []).map((x) => x.name);
      return { template: "07", values: { ...common, ...party, ...equipmentRows(evs.map((e) => e.asset), o?.plant?.name),
        RECEIVED_AT: `${d(ev.occurredAt)}  ${hm(ev.occurredAt)}`, JOB_NO: o?.no ?? "—", CUSTOMER_REF: o?.customerRef ?? "—", SENDER: pl.sender || "—",
        FAULT: pl.fault || o?.reportedSymptom || "—", ACCESSORIES: pl.accessories || NONE, CONDITION: pl.condition || "—", PHOTO_REFERENCES: lines_(pl.photoRefs, ...photos) || "—", HANDLING_RESTRICTIONS: pl.handlingRestrictions || NONE,
        RECEIVED_BY: ev.actor?.name ?? doc.createdBy.name, SENDER_SIGN: pl.sender || SIGN_HINT } };
    }
    case "QT": {
      const want = templateHint ?? doc.templateCode ?? "13";
      return { template: ["04", "06", "12", "30", "31"].includes(want) ? want : "13", values: { DOC_NO: no, ISSUE_DATE: common.ISSUE_DATE, ...(await serviceFields(doc, want)) } };
    }
    case "DN": {
      if (doc.templateCode === "34") return { template: "34", values: await packingListFields(no, doc, o!, common, party) };
      const dn = await prisma.deliveryNote.findUniqueOrThrow({ where: { no }, include: { driver: true, serviceOrder: { select: { decline: { select: { id: true } } } } } });
      const unrepaired = !!dn.serviceOrder.decline; // 客户拒绝报价: the machine goes back as it came in
      const lines = (dn.lines as { kind: string; description: string; assetCode?: string; partSku?: string; delivered: number; poLineNo?: number; source?: string }[]).filter((l) => l.delivered > 0);
      const plant = dn.plantId ? await prisma.plant.findUnique({ where: { id: dn.plantId } }) : o?.plant;
      const machine = (code: string) => { const a = o?.assets.find((y) => y.asset.code === code)?.asset; return a ? lines_(a.code, a.model ? `${a.model.series.brand.name} ${a.model.code}` : a.type, `S/N ${a.serialNumber}`) : code; };
      const items = lines.filter((l) => l.kind === "PO" || l.kind === "MACHINE");
      const back = lines.filter((l) => l.kind === "RETURN");
      return { template: "19", values: { ...common, ...party, ISSUE_DATE: d(dn.deliverOn), DELIVER_ON: d(dn.deliverOn), CUSTOMER_PO: o?.customerRef ?? "—", JOB_NO: o?.no ?? "—",
        DELIVER_TO: lines_(plant?.name, dn.address ?? plant?.address ?? o?.customer.addressLocal ?? o?.customer.addressEn) || "—", DRIVER: lines_(dn.driver?.name, dn.vehicle) || "—",
        // the repaired machine goes back on its PO line: the line names the machine with model and serial number
        ...rowsOf(items, { L_NO: (l, i) => l.poLineNo ?? i + 1, L_DESC: (l) => l.description, L_REF: (l) => (l.assetCode ? machine(l.assetCode) : l.partSku ?? ""), L_QTY: (l) => l.delivered }, "Nothing delivered  ไม่มีรายการ"),
        ...rowsOf(back, { L_R_NO: (_, i) => i + 1, L_R_ITEM: (l) => l.description, L_R_FROM: (l) => l.source ?? "", L_R_QTY: (l) => l.delivered }, "Nothing returned  ไม่มี"),
        REMARKS: dn.remark || "—", // an MD override of a mismatch is internal
        ACK_EN: unrepaired ? "Equipment returned unrepaired, complete with the accessories listed, in the condition received." : "Goods received complete and in good order, in the quantities stated.",
        ACK_TH: unrepaired ? "ได้รับอุปกรณ์คืนโดยไม่ได้ซ่อม พร้อมอุปกรณ์ประกอบตามรายการ ในสภาพเดียวกับที่ส่งมอบให้" : "ได้รับสินค้าครบถ้วนตามจำนวนที่ระบุและอยู่ในสภาพเรียบร้อย",
        ISSUED_BY: doc.createdBy.name, DRIVER_NAME: dn.driver?.name ?? SIGN_HINT, RECEIVED_BY: dn.signedBy ? lines_(dn.signedBy, dn.signedAt ? d(dn.signedAt) : "") : SIGN_HINT } };
    }
    case "TI": {
      const ti = await prisma.taxInvoice.findUniqueOrThrow({ where: { no } });
      const c = o!.customer; const e = doc.entity;
      const dns = await prisma.deliveryNote.findMany({ where: { serviceOrderId: o!.id, status: { in: ["ISSUED", "SIGNED"] } }, select: { no: true } });
      return { template: "20", values: { ...common, BOOK_NO: ti.bookNo ? `${ti.bookNo}  เลขที่ในเล่ม  ${ti.bookSeq}` : "—", ISSUE_DATE: d(ti.issuedAt),
        CUSTOMER_NAME_TH: c.nameLocal ?? c.name, CUSTOMER_NAME_EN: c.nameLocal ? c.name : "", CUSTOMER_ADDRESS: c.billingAddress ?? c.addressLocal ?? c.addressEn ?? "", CUSTOMER_TAX_ID: ti.buyerTaxId ?? c.taxId ?? "", CUSTOMER_BRANCH: branchLabel(ti.buyerBranch ?? c.branchCode, o!.plant),
        REFERENCE: [o!.no, o!.customerRef ? `PO ${o!.customerRef}` : ""].filter(Boolean).join("\n"), PAYMENT_TERMS: `${c.paymentTermDays} วัน\ndue ${d(addDays(ti.issuedAt, c.paymentTermDays))}`, DELIVERY_NOTE: dns.map((x) => x.no).join("\n") || "—",
        ...tiLines(ti.lines as TiLine[]), SUBTOTAL: money(ti.subtotal), VAT_LABEL: pctLabel(ti.vatRate), VAT_AMOUNT: money(ti.vatAmount), CURRENCY: ti.currency, TOTAL: money(ti.total),
        TOTAL_WORDS_TH: thaiAmount(Number(ti.total), ti.currency), TOTAL_WORDS_EN: englishAmount(Number(ti.total), ti.currency), BANK_LINES: bankLines(e.bankDetails as BankDetails | null, ti.currency), NOTES: ti.voidedAt ? `ยกเลิก / VOID ${d(ti.voidedAt)} ${ti.voidReason ?? ""}` : "",
        RECEIVED_BY: "", ISSUED_BY: doc.createdBy.name, AUTHORISED_BY: e.signatoryName ?? "", VAT_REG_DATE: d(e.vatRegisteredFrom) } };
    }
    case "PF": // 国际贸易: the proforma invoice (35); for customs the same PFTH prints as a commercial invoice (33)
      return { template: templateHint === "33" ? "33" : "35", values: await commercialInvoiceFields(no, doc, o!, common, party) };
    case "IV": {
      const iv = await prisma.invoice.findUniqueOrThrow({ where: { no }, include: { taxInvoice: true, receipts: true } });
      const c = o!.customer; const e = doc.entity;
      const lines: TiLine[] = (iv.taxInvoice?.lines as TiLine[] | undefined) ?? (await prisma.quoteLine.findMany({ where: { serviceOrderId: o!.id }, orderBy: { lineNo: "asc" } })).map((l) => ({ description: l.description, descriptionLocal: l.descriptionLocal ?? undefined, qty: Number(l.qty), unit: l.unit, unitPrice: Number(l.unitPrice), amount: Number(l.qty) * Number(l.unitPrice) }));
      const subtotal = iv.taxInvoice ? Number(iv.taxInvoice.subtotal) : round2(lines.reduce((s, l) => s + Number(l.amount), 0));
      const vatRate = iv.taxInvoice ? Number(iv.taxInvoice.vatRate) : Number(e.vatRate);
      const vat = iv.taxInvoice ? Number(iv.taxInvoice.vatAmount) : round2(subtotal * vatRate);
      const total = Number(iv.amountDue);
      const settled = round2(iv.receipts.reduce((s, r) => s + Number(r.settledAmount), 0));
      const wht = settled ? 0 : round2(subtotal * WHT_SERVICE_RATE);
      const lf = tiLines(lines);
      return { template: "21", values: { ...common, ISSUE_DATE: d(iv.issuedAt), DUE_DATE: d(iv.dueAt ?? addDays(iv.issuedAt, c.paymentTermDays)), TAX_INVOICE_NO: iv.taxInvoice?.no ?? "—", REFERENCE: [o!.no, o!.customerRef ? `PO ${o!.customerRef}` : ""].filter(Boolean).join("\n"),
        BILL_TO: c.name, BILL_BRANCH: [o!.plant?.name, c.branchCode ? `branch ${c.branchCode}` : ""].filter(Boolean).join(", "), BILL_ADDRESS: c.billingAddress ?? c.addressEn ?? c.addressLocal ?? "", CUSTOMER_TAX_ID: c.taxId ?? "", ATTN: "Accounts Payable",
        L_NO: lf.L_NO, L_DESC: lines.map((l) => l.descriptionEn ?? l.description ?? l.descriptionLocal ?? ""), L_QTY: lf.L_QTY, L_PRICE: lf.L_PRICE, L_AMOUNT: lf.L_AMOUNT,
        SUBTOTAL: money(subtotal), VAT_LABEL: pctLabel(vatRate), VAT_AMOUNT: money(vat), INVOICE_TOTAL: money(total), SETTLED_TO_DATE: money(settled), WHT_LABEL: wht ? `${pctLabel(WHT_SERVICE_RATE)} on ${money(subtotal)}` : "", WHT_AMOUNT: wht ? `(${money(wht)})` : money(0), CURRENCY: iv.currency, AMOUNT_PAYABLE: money(round2(total - settled - wht)),
        BANK_LINES: bankLines(e.bankDetails as BankDetails | null, iv.currency), ACCOUNTS_EMAIL: e.email ?? "", TAX_INVOICE_NOTE_TH: iv.taxInvoice ? `ใบแจ้งหนี้นี้ไม่ใช่ใบกำกับภาษี ใบกำกับภาษีคือ ${iv.taxInvoice.no} ที่แนบมาด้วย` : "", TAX_INVOICE_NOTE_EN: iv.taxInvoice ? `This invoice is not a tax invoice; the tax invoice is ${iv.taxInvoice.no}, attached.` : "",
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
    case "PR": {
      const inq = await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no }, include: { requestedBy: true, quotes: { include: { supplier: true } } } });
      const lines = inq.lines as { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; assetCode?: string }[];
      const sup = inq.quotes.find((q) => q.selected)?.supplier ?? inq.quotes[0]?.supplier; // addressed to the chosen supplier when one exists, otherwise generic
      // 合作维修: the partner never learns who the customer is — no QTTH, no customer PO, only the machines (ATH)
      const ref = inq.kind === "SUBCONTRACT" ? [...new Set(lines.map((l) => l.assetCode).filter(Boolean))].join("\n") : [o?.no, o?.customerRef ? `PO ${o.customerRef}` : ""].filter(Boolean).join("\n");
      return { template: "24", values: { ...(inq.kind === "SUBCONTRACT" ? partnerSafe(common) : common), ISSUE_DATE: d(inq.createdAt), NEEDED_BY: d(inq.neededBy) || "—", REFERENCE: ref || "—",
        SUPPLIER_NAME: sup?.name ?? "", SUPPLIER_ATTN: sup?.contactName ? `Attn: ${sup.contactName}` : "", SUPPLIER_EMAIL: sup?.email ?? "", SUPPLIER_PHONE: sup?.phone ?? "",
        REQUESTED_BY: inq.requestedBy.name, REQUESTER_PHONE: inq.requestedBy.phone ?? "", NOTE: inq.note ?? "", APPROVED_BY: doc.entity.signatoryName ?? "",
        L_NO: lines.map((l, i) => l.lineNo ?? i + 1), L_PART: lines.map((l) => l.vendorPartNo ?? l.partSku ?? "—"), L_DESC: lines.map((l) => l.description), L_QTY: lines.map((l) => String(Number(l.qty))), L_UNIT: lines.map((l) => l.unit ?? "pcs"), L_REMARK: lines.map((l) => l.assetCode ? `for ${l.assetCode}` : "") } };
    }
    case "PO": {
      const po = await prisma.purchaseOrder.findUniqueOrThrow({ where: { no }, include: { supplier: true, inquiry: { include: { quotes: { where: { selected: true } } } }, createdBy: true } });
      const lines = po.lines as { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; unitPrice: number; amount: number }[];
      const q = po.inquiry?.quotes[0]; const e = doc.entity; const sub = po.kind === "SUBCONTRACT";
      if (sub) {
        // scope, warranty (back-to-back with what we promised the customer) and the version go on the order itself
        const head = [po.scope ? `Scope  ขอบเขต: ${po.scope}` : "", po.warrantyDays != null ? `Warranty  รับประกัน: ${po.warrantyDays} days` : "", po.version > 1 ? `Revision  แก้ไขครั้งที่ ${po.version - 1}` : ""].filter(Boolean);
        if (head.length && lines[0]) lines[0] = { ...lines[0], description: [lines[0].description, ...head].join("\n") };
      }
      return { template: "25", values: { ...(sub ? partnerSafe(common) : common), ISSUE_DATE: d(po.orderedAt), EXPECTED_AT: d(po.expectedAt) || "—", REFERENCE: (sub ? [po.inquiry?.no] : [po.inquiry?.no, o?.no]).filter(Boolean).join("\n") || "—",
        SUPPLIER_NAME: po.supplier.name, SUPPLIER_ADDRESS: po.supplier.address ?? "", SUPPLIER_TAX_ID: po.supplier.taxId ?? "—", SUPPLIER_BRANCH: po.supplier.branchCode ? (po.supplier.branchCode === "00000" ? "Head Office 00000" : `Branch ${po.supplier.branchCode}`) : "", SUPPLIER_ATTN: po.supplier.contactName ? `Attn: ${po.supplier.contactName}${po.supplier.phone ? `\n${po.supplier.phone}` : ""}` : (po.supplier.phone ?? ""),
        SUPPLIER_QUOTE: [q?.quoteNo, d(q?.quoteDate)].filter(Boolean).join("\n") || "—",
        L_NO: lines.map((l, i) => l.lineNo ?? i + 1), L_PART: lines.map((l) => l.vendorPartNo ?? l.partSku ?? "—"), L_DESC: lines.map((l) => l.description), L_QTY: lines.map((l) => String(Number(l.qty))), L_UNIT: lines.map((l) => l.unit ?? "pcs"), L_PRICE: lines.map((l) => money(l.unitPrice)), L_AMOUNT: lines.map((l) => money(l.amount)),
        SUBTOTAL: money(po.subtotal), VAT_LABEL: pctLabel(po.vatRate), VAT_AMOUNT: money(po.vatAmount), CURRENCY: po.currency, TOTAL: money(po.total),
        DELIVER_TO: sub ? `Return the repaired machine to DCiT only — never to a third party\nส่งคืนเครื่องที่ซ่อมแล้วให้ DCiT เท่านั้น\n${e.addressEn ?? ""}` : `DCiT workshop\n${e.addressEn ?? ""}`, PAYMENT_TERMS: po.paymentTerms ?? po.supplier.paymentTerms ?? "30 days after delivery and tax invoice", INVOICE_TO: `${e.nameEn}\nTax ID ${e.taxId ?? ""}\n${e.branchCode === "00000" || !e.branchCode ? "Head Office" : `Branch ${e.branchCode}`}`,
        PREPARED_BY: po.createdBy.name, AUTHORISED_BY: e.signatoryName ?? "" } };
    }
    case "IB":
    case "OB": {
      const custody = await prisma.stockMovement.findFirst({ where: { no, kind: { in: ["SUBCONTRACT_OUT", "SUBCONTRACT_RETURN"] } }, include: { purchaseOrder: { include: { supplier: true, milestones: { orderBy: { at: "asc" } } } }, asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } });
      if (custody) return custodyFields(no, doc, custody, partnerSafe(common));
      const mv = await prisma.stockMovement.findMany({ where: { no }, orderBy: { lineNo: "asc" }, include: { part: true, purchaseOrder: { include: { supplier: true } }, asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } });
      if (!mv.length) throw new Error(`no stock lines for ${no}`);
      const first = mv[0];
      const base = { ...common, ISSUE_DATE: d(first.movedAt), REFERENCE: [o?.no, ...new Set(mv.map((m) => m.asset?.code).filter(Boolean))].filter(Boolean).join("\n") || "—",
        L_NO: mv.map((m) => m.lineNo), L_SKU: mv.map((m) => m.part?.sku ?? ""), L_DESC: mv.map((m) => m.part?.name ?? ""), L_QTY: mv.map((m) => String(Number(m.qty))), L_UNIT: mv.map((m) => m.part?.unit ?? ""), L_BATCH: mv.map((m) => m.batch ?? ""), L_COST: mv.map((m) => (m.unitCost != null ? money(m.unitCost) : "")) };
      if (doc.type === "IB") {
        const po = first.purchaseOrder;
        return { template: "26", values: { ...base, SUPPLIER_NAME: po?.supplier.name ?? "—", SUPPLIER_DOC: [...new Set(mv.map((m) => m.supplierRef).filter(Boolean))].join("\n"), PO_NO: po?.no ?? "—", WAREHOUSE: first.warehouse,
          L_VENDOR_PART: mv.map((m) => m.part?.vendorPartNo ?? ""), RECEIVED_BY: first.byName ?? doc.createdBy.name, CHECKED_BY: "", STOCK_KEEPER: "" } };
      }
      const a = first.asset;
      return { template: "27", values: { ...base, ISSUED_TO: first.byName ?? doc.createdBy.name, PURPOSE: o ? (o.kind === "MAINTENANCE" ? "Maintenance  บำรุงรักษา" : "Repair  ซ่อม") : "Parts sale  ขายอะไหล่",
        EQUIPMENT: a ? [a.code, a.model ? `${a.model.series.brand.name} ${a.model.code}` : a.type, `S/N ${a.serialNumber}`].join("\n") : "—", CUSTOMER_NAME: [o?.customer.name, o?.plant?.name].filter(Boolean).join("\n") || "—",
        L_OLD_PART: mv.map((m) => (m.oldPartDisposition ? DISPOSITION[m.oldPartDisposition] ?? m.oldPartDisposition : "")), ISSUED_BY: doc.createdBy.name, RECEIVED_BY: first.byName ?? "", APPROVED_BY: "" } };
    }
    default:
      throw new Error(`no Word template for document type ${doc.type}`);
  }
}

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
export type Rendered = { docxPath: string; pdfPath?: string; unfilled: string[]; template: string; fileBase: string; cleanup: () => Promise<void> };

/** "QTTH261108004_Repair_Service_Proposal": the number plus the report, so the four reports of one order do not all download as QTTH261108004.pdf. */
export function reportFileBase(no: string, template: string): string {
  return `${no}_${(TEMPLATE_FILES[template] ?? template).replace(/^\d+_/, "").replace(/\.docx$/, "")}`;
}

/**
 * Render one report into a fresh folder every time (2026-11-08: reports came back in an old version — LibreOffice had
 * silently not converted and the PDF of an earlier render with the same file name was handed out).
 * The caller reads the files and calls cleanup(). PDF conversion: convertToPdf in ./office.
 */
export async function renderDocument(no: string, template?: string): Promise<Rendered> {
  const { template: tpl, values } = await buildFields(no, template);
  const code = template ?? tpl;
  const file = TEMPLATE_FILES[code];
  if (!file) throw new Error(`unknown template ${code}`);
  const { docx, unfilled } = fillDocx(await readFile(path.join(TEMPLATES, file)), values);
  await mkdir(path.join(OUT, "renders"), { recursive: true });
  const dir = await mkdtemp(path.join(OUT, "renders", `${no}-${code}-`));
  const fileBase = reportFileBase(no, code);
  const docxPath = path.join(dir, `${fileBase}.docx`);
  await writeFile(docxPath, docx);
  const pdfPath = await convertToPdf(docxPath, dir);
  // "Last rendered" copy behind Document.pdfUrl: replaced with this render, or removed so nothing stale is served.
  if (!template) {
    const last = path.join(OUT, `${no}.pdf`);
    if (pdfPath) { await copyFile(pdfPath, last); await prisma.document.update({ where: { no }, data: { pdfUrl: `/api/documents/${no}/pdf`, templateCode: tpl } }); }
    else await rm(last, { force: true }).catch(() => {});
  }
  return { docxPath, pdfPath, unfilled, template: code, fileBase, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}

type CustodyMove = Prisma.StockMovementGetPayload<{ include: { purchaseOrder: { include: { supplier: true; milestones: true } }; asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } }>;

/**
 * 外送维修单 (28) / 外协返回单 (29) — partner-facing, so nothing about the customer: no name, plant, PO or QTTH,
 * only our POTH, the machine and what travels with it (principle 2026-11-08: the partner never meets the customer).
 */
async function custodyFields(no: string, doc: { createdBy: { name: string } }, m: CustodyMove, common: FieldValues): Promise<{ template: string; values: FieldValues }> {
  const po = m.purchaseOrder, sup = po?.supplier, a = m.asset;
  const d = (x?: Date | null) => (x ? localIso(x)!.slice(0, 10) : "");
  const equipment = a ? [a.code, a.model ? `${a.model.series.brand.name} ${a.model.code}` : a.type, `S/N ${a.serialNumber}`].join("\n") : "—";
  const sentMs = po?.milestones.find((x) => x.sourceDocNo === (m.kind === "SUBCONTRACT_OUT" ? no : m.refNo) && x.stage === "SENT"); // the condition written by this very dispatch
  const base: FieldValues = { ...common, ISSUE_DATE: d(m.movedAt), PO_NO: po ? `${po.no}${po.version > 1 ? ` (rev ${po.version - 1})` : ""}` : "—",
    PARTNER_NAME: sup?.name ?? "—", PARTNER_ADDRESS: sup?.address ?? "", PARTNER_ATTN: sup?.contactName ? `Attn: ${sup.contactName}${sup.phone ? `\n${sup.phone}` : ""}` : (sup?.phone ?? ""),
    WARRANTY: po?.warrantyDays != null ? `${po.warrantyDays} days  วัน` : "—", EQUIPMENT: equipment, SCOPE: po?.scope ?? ((po?.lines as { description: string }[] | undefined)?.[0]?.description ?? "—"),
    CONDITION: sentMs?.note ?? "—", PARTNER_SIGNED: m.counterpartySigned ?? "", NOTE: "" };
  const acc = (m.accessories as { item: string; qty: number }[] | null) ?? [];
  if (m.kind === "SUBCONTRACT_OUT") {
    const rows = acc.length ? acc : [{ item: "Machine only  เฉพาะตัวเครื่อง", qty: 0 }];
    return { template: "28", values: { ...base, EXPECTED_AT: d(po?.expectedAt) || "—", ISSUED_BY: doc.createdBy.name, CARRIED_BY: m.byName ?? "",
      L_NO: rows.map((_, i) => i + 1), L_ITEM: rows.map((r) => r.item), L_QTY: rows.map((r) => (r.qty ? String(r.qty) : "")), L_REMARK: rows.map(() => "") } };
  }
  const out = m.refNo ? await prisma.stockMovement.findFirst({ where: { no: m.refNo } }) : null;
  const sent = (out?.accessories as { item: string; qty: number }[] | null) ?? [];
  const names = [...new Map([...sent, ...acc].map((x) => [x.item.trim().toLowerCase(), x.item])).values()];
  const qtyOf = (list: { item: string; qty: number }[], k: string) => list.filter((x) => x.item.trim().toLowerCase() === k.trim().toLowerCase()).reduce((s, x) => s + x.qty, 0);
  const rows = names.length ? names : ["Machine only  เฉพาะตัวเครื่อง"];
  return { template: "29", values: { ...base, DISPATCH_NO: m.refNo ?? "—", RECEIVED_BY: m.byName ?? doc.createdBy.name, CHECKED_BY: "", NOTE: m.oldPartDisposition ?? "",
    L_NO: rows.map((_, i) => i + 1), L_ITEM: rows, L_SENT: rows.map((k) => (names.length ? String(qtyOf(sent, k)) : "")), L_QTY: rows.map((k) => (names.length ? String(qtyOf(acc, k)) : "")),
    L_CHECK: rows.map((k) => (!names.length ? "✓" : qtyOf(acc, k) >= qtyOf(sent, k) ? "✓" : "✗")) } };
}
