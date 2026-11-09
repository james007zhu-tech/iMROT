/**
 * Report generation: a registered document number → the DCiT Word template it belongs to → field values from the
 * event data → .docx (and .pdf when LibreOffice is installed). Nothing is typed by hand; the template layout is untouched.
 */
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { convertToPdf } from "./office";
import path from "node:path";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
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
const DISPOSITION: Record<string, string> = { SCRAP: "Scrap at DCiT\nทิ้งที่ DCiT", RETURN_TO_CUSTOMER: "Return to customer\nคืนลูกค้า", KEEP_FOR_ANALYSIS: "Keep for analysis\nเก็บวิเคราะห์" };
const branchLabel = (code?: string | null, plant?: { name: string } | null) => [code, plant?.name ? `(${plant.name})` : ""].filter(Boolean).join(" ");

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
type TestRow = { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean };
const col = (tests: TestRow[] | null | undefined, k: keyof TestRow, n = 4) => Array.from({ length: n }, (_, i) => (tests?.[i]?.[k] as string | undefined) ?? "");

const KIND: Record<string, string> = { REPAIR: "Repair\nซ่อม", MAINTENANCE: "Maintenance\nบำรุงรักษา", OVERHAUL: "Overhaul\nยกเครื่อง", CONTRACT: "Contract service\nบริการตามสัญญา", PARTS_SALE: "Parts supply\nจำหน่ายอะไหล่" };
const IMPACT: Record<string, string> = { STOPPED: "Line stopped\nไลน์ผลิตหยุด", DEGRADED: "Running degraded\nผลิตได้แต่ช้าลง", NONE: "No production impact\nไม่กระทบการผลิต" };
/** Report names as the customer reads them — never template numbers ("Repair Report 09"). */
const REPORT_NAME: Record<string, [string, string]> = { IN: ["Diagnostic report", "รายงานการตรวจสอบ"], RP: ["Repair report", "รายงานการซ่อม"], PM: ["Maintenance record", "บันทึกการบำรุงรักษา"], FS: ["Field service report", "รายงานบริการนอกสถานที่"] };
const both = (n?: [string, string]) => (n ? `${n[0]}  ${n[1]}` : "");
const lines_ = (...xs: (string | null | undefined | false)[]) => xs.filter((x): x is string => !!x && !!x.trim()).join("\n");
const CHECK = (on: boolean) => (on ? "☒" : "☐");
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
    lines: { orderBy: { lineNo: "asc" } }, acceptance: { include: { customerContact: true } },
    documents: { where: { voidedAt: null, type: { in: ["IN", "RP", "PM"] } }, orderBy: { issuedAt: "asc" }, select: { no: true, type: true, templateCode: true } },
    deliveries: { where: { status: { not: "DRAFT" } }, orderBy: { deliverOn: "asc" }, select: { no: true } },
    events: { where: { type: "ORDER_CONFIRMED" }, orderBy: { occurredAt: "asc" }, take: 1, include: { actor: true } },
    repairJobs: { where: { finishedAt: { not: null } }, orderBy: { finishedAt: "desc" }, take: 1, include: { engineer: true } },
  } });
  const c = o.customer;
  const contact = o.reportedBy ? `Attn: ${o.reportedBy.name}${o.reportedBy.title ? `, ${o.reportedBy.title}` : ""}` : "";
  const party = { CUSTOMER_NAME: c.nameLocal ?? c.name, CUSTOMER_DETAILS: lines_(c.nameLocal ? c.name : "", o.plant?.name, o.plant?.address ?? c.addressLocal ?? c.addressEn, c.taxId ? `Tax ID  ${c.taxId}` : "", contact) };
  const equipment = {
    L_EQ_ASSET: o.assets.map((x) => x.asset.code),
    L_EQ_MODEL: o.assets.map(({ asset: a }) => (a.model ? lines_(`${a.model.series.brand.name} ${a.model.series.name}`, a.model.code) : a.type)),
    L_EQ_SERIAL: o.assets.map((x) => x.asset.serialNumber),
    L_EQ_LOCATION: o.assets.map(({ asset: a }) => lines_(o.plant?.name, a.location) || "—"),
  };
  const po = o.customerRef ?? "—";
  const terms = `${c.paymentTermDays} days from invoice\n${c.paymentTermDays} วันนับจากวันที่ใบแจ้งหนี้`;
  const onSite = o.documents.some((x) => x.templateCode === "10");
  const docs = lines_(
    o.kind !== "PARTS_SALE" && o.kind !== "MAINTENANCE" ? both(REPORT_NAME.IN) : "",
    // 合作维修: the partner's work is never shown to the customer — our retest gates the delivery, there is no RPTH
    both(o.kind === "MAINTENANCE" ? REPORT_NAME.PM : o.kind !== "PARTS_SALE" && o.mode !== "PARTNER_REPAIR" ? (onSite ? REPORT_NAME.FS : REPORT_NAME.RP) : undefined),
    "Delivery note  ใบส่งของ",
    o.kind !== "PARTS_SALE" ? "Service completion confirmation  ใบยืนยันงานบริการแล้วเสร็จ" : "",
    o.kind !== "PARTS_SALE" ? "Customer acceptance record  บันทึกการตรวจรับงาน" : "",
    "Tax invoice and receipt  ใบกำกับภาษีและใบเสร็จรับเงิน",
  );
  const signHint = "Name / date  ชื่อ / วันที่";
  // What we promise the customer (quote page, rule 26: partner work is back-to-back on the same days); runs from acceptance.
  const promise = o.warrantyDays != null ? `${o.warrantyDays} days from acceptance\n${o.warrantyDays} วันนับจากวันตรวจรับงาน` : "—";

  if (want === "04" || want === "06") {
    const subtotal = o.subtotal != null ? Number(o.subtotal) : round2(o.lines.reduce((s, l) => s + Number(l.amount), 0));
    const vatRate = Number(doc.entity.vatRate);
    const vat = o.vatAmount != null ? Number(o.vatAmount) : round2(subtotal * vatRate);
    const total = o.total != null ? Number(o.total) : round2(subtotal + vat);
    const priced = {
      L_NO: o.lines.map((l) => l.lineNo), L_DESC: o.lines.map((l) => lines_(l.descriptionLocal && l.descriptionLocal !== l.description ? l.descriptionLocal : "", l.description)),
      L_ASSET: o.lines.map((l) => l.assetCode ?? ""), L_QTY: o.lines.map((l) => String(Number(l.qty))), L_UNIT: o.lines.map((l) => l.unit), L_PRICE: o.lines.map((l) => money(l.unitPrice)), L_AMOUNT: o.lines.map((l) => money(l.amount)),
      SUBTOTAL: money(subtotal), VAT_LABEL: pctLabel(vatRate), VAT_AMOUNT: money(vat), CURRENCY: o.currency, TOTAL: money(total),
      TOTAL_WORDS_TH: thaiAmount(total, o.currency), TOTAL_WORDS_EN: englishAmount(total, o.currency),
    };
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
      DELIVER_TO: lines_(c.name, o.plant?.name, o.plant?.address ?? c.addressLocal ?? c.addressEn), WARRANTY: promise,
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

  // 合作维修 (2026-11-08): partner-facing documents never carry the customer — not even as unused fill values
  const partnerSafe = (v: FieldValues): FieldValues => ({ ...v, CUSTOMER_SITE: "", CUSTOMER_NAME: "", SITE: "", JOB_PO: "", PO_JOB: "" });

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
      const want = templateHint ?? doc.templateCode ?? "13";
      return { template: want === "04" || want === "06" || want === "12" ? want : "13", values: { DOC_NO: no, ISSUE_DATE: common.ISSUE_DATE, ...(await serviceFields(doc, want)) } };
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
      return { template: "20", values: { ...common, BOOK_NO: ti.bookNo ? `${ti.bookNo}  เลขที่ในเล่ม  ${ti.bookSeq}` : "—", ISSUE_DATE: d(ti.issuedAt),
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
      const wht = settled ? 0 : round2(subtotal * WHT_SERVICE_RATE);
      const lf = tiLines(lines);
      return { template: "21", values: { ...common, ISSUE_DATE: d(iv.issuedAt), DUE_DATE: d(iv.dueAt ?? addDays(iv.issuedAt, c.paymentTermDays)), TAX_INVOICE_NO: iv.taxInvoice?.no ?? "—", REFERENCE: [o!.no, o!.customerRef ? `PO ${o!.customerRef}` : ""].filter(Boolean).join("\n"),
        BILL_TO: c.name, BILL_BRANCH: [o!.plant?.name, c.branchCode ? `branch ${c.branchCode}` : ""].filter(Boolean).join(", "), BILL_ADDRESS: c.billingAddress ?? c.addressEn ?? c.addressLocal ?? "", CUSTOMER_TAX_ID: c.taxId ?? "", ATTN: "Accounts Payable",
        L_NO: lf.L_NO, L_DESC: lines.map((l) => l.descriptionEn ?? l.description ?? l.descriptionLocal ?? ""), L_QTY: lf.L_QTY, L_PRICE: lf.L_PRICE, L_AMOUNT: lf.L_AMOUNT,
        SUBTOTAL: money(subtotal), VAT_LABEL: pctLabel(vatRate), VAT_AMOUNT: money(vat), INVOICE_TOTAL: money(total), SETTLED_TO_DATE: money(settled), WHT_LABEL: wht ? `${pctLabel(WHT_SERVICE_RATE)} on ${money(subtotal)}` : "", WHT_AMOUNT: wht ? `(${money(wht)})` : money(0), CURRENCY: iv.currency, AMOUNT_PAYABLE: money(round2(total - settled - wht)),
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
  const d = (x?: Date | null) => (x ? x.toISOString().slice(0, 10) : "");
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
