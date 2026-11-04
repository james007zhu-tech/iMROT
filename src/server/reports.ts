/**
 * Report generation: a registered document number → the DCiT Word template it belongs to → field values from the
 * event data → .docx (and .pdf when LibreOffice is installed). Nothing is typed by hand; the template layout is untouched.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { prisma } from "@/lib/db";
import { fillDocx, type FieldValues } from "@/lib/docx/fill";
import { maskNamesIn } from "@/lib/mask";

const exec = promisify(execFile);
const TEMPLATES = path.join(process.cwd(), "templates", "word");
const OUT = process.env.DOCS_DIR ?? path.join(process.cwd(), "uploads", "documents");

const TEMPLATE_FILES: Record<string, string> = {
  "04": "04_Repair_Service_Proposal.docx", "06": "06_Order_Confirmation.docx", "07": "07_Equipment_Receiving.docx",
  "08": "08_Diagnostic_Report.docx", "09": "09_Repair_Report.docx", "10": "10_Field_Service_Report.docx",
  "11": "11_Preventive_Maintenance_Record.docx", "12": "12_Service_Completion.docx", "13": "13_Customer_Acceptance.docx", "19": "19_Delivery_Note.docx",
};

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
      return { template: "08", values: { ...common, DATE_TECHNICIAN: `${d(i.inspectedAt)} · ${i.engineer.code} ${i.engineer.name}`, SYMPTOMS: i.symptoms ?? o?.reportedSymptom ?? "", CONDITIONS: i.conditions ?? "", FINDINGS_CAUSE: [i.findings, i.probableCause].filter(Boolean).join("\n"), RECOMMENDATION_AUTHORIZATION: i.recommendation ?? "", APPROVED_CRITERION: col(tests, "criterion"), MEASURED_RESULT: col(tests, "result"), RECORD_ID: col(tests, "recordId"), INSTRUMENT_CALIBRATION: i.instruments ?? "", ATTACHMENT_IDS: ((i.attachments as { name: string }[] | null) ?? []).map((x) => x.name).join(", "), OPEN_ISSUES: i.openIssues ?? "", CONCLUSION_LIMITATIONS: i.conclusion ?? "" } };
    }
    case "RP":
    case "PM": {
      const j = await prisma.repairJob.findUniqueOrThrow({ where: { no }, include: { engineer: true } });
      const tests = j.tests as TestRow[] | null;
      const parts = ((j.partsReplaced as { partSku: string; qty: number; oldSerial?: string; newSerial?: string; obthNo?: string }[] | null) ?? []).map((p) => `${p.partSku} ×${p.qty}${p.newSerial ? ` (S/N ${p.newSerial})` : ""}${p.obthNo ? ` · ${p.obthNo}` : ""}`).join("\n");
      const base = { ...common, DATE_TECHNICIAN: `${d(j.finishedAt ?? j.startedAt)} · ${j.engineer.code} ${j.engineer.name}`, APPROVED_CRITERION: col(tests, "criterion"), MEASURED_RESULT: col(tests, "result"), RECORD_ID: col(tests, "recordId"), INSTRUMENT_CALIBRATION: "", ATTACHMENT_IDS: ((j.attachments as { name: string }[] | null) ?? []).map((x) => x.name).join(", "), OPEN_ISSUES: j.openIssues ?? "", CONCLUSION_LIMITATIONS: j.conclusion ?? "" };
      if (doc.templateCode === "11" || j.kind === "MAINTENANCE") {
        const items = (j.checklist as { item: string; criterion?: string; measured?: string; verdict?: string }[] | null) ?? [];
        return { template: "11", values: { ...base,
          ASSET_CONDITION: [j.conditionRating, j.runHours != null ? `${j.runHours} h` : "", j.level].filter(Boolean).join(" · ") || (j.confirmedFault ?? ""),
          PM_TASKS: items.length ? items.map((x, i) => `${i + 1}. ${x.item}${x.criterion ? ` [${x.criterion}]` : ""}: ${x.measured ?? ""}${x.verdict ? ` — ${x.verdict}` : ""}`).join("\n") : (j.workPerformed ?? ""),
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
    await exec("soffice", ["--headless", "--convert-to", "pdf", "--outdir", OUT, docxPath], { timeout: 120000 });
    pdfPath = path.join(OUT, `${no}${template ? `-${template}` : ""}.pdf`);
    if (!template) await prisma.document.update({ where: { no }, data: { pdfUrl: `/api/documents/${no}/pdf`, templateCode: tpl } });
  } catch {
    // LibreOffice not installed on this host: the .docx is still delivered
  }
  return { docxPath, pdfPath, unfilled };
}
