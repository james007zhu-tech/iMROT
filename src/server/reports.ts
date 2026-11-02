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

const exec = promisify(execFile);
const TEMPLATES = path.join(process.cwd(), "templates", "word");
const OUT = process.env.DOCS_DIR ?? path.join(process.cwd(), "uploads", "documents");

const TEMPLATE_FILES: Record<string, string> = {
  "04": "04_Repair_Service_Proposal.docx", "06": "06_Order_Confirmation.docx", "07": "07_Equipment_Receiving.docx",
  "08": "08_Diagnostic_Report.docx", "09": "09_Repair_Report.docx", "10": "10_Field_Service_Report.docx",
  "11": "11_Preventive_Maintenance_Record.docx", "12": "12_Service_Completion.docx", "13": "13_Customer_Acceptance.docx",
};

const d = (x: Date | null | undefined) => (x ? x.toISOString().slice(0, 10) : "");
type TestRow = { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean };
const col = (tests: TestRow[] | null | undefined, k: keyof TestRow, n = 4) => Array.from({ length: n }, (_, i) => (tests?.[i]?.[k] as string | undefined) ?? "");

/** Build the field map for one document. Returns template code + values. */
export async function buildFields(no: string): Promise<{ template: string; values: FieldValues }> {
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
        return { template: "11", values: { ...base, ASSET_CONDITION: j.confirmedFault ?? "", PM_TASKS: j.workPerformed ?? "", ABNORMALITIES: j.rootCause ?? "", NEXT_ACTIONS: j.openIssues ?? "" } };
      }
      if (doc.templateCode === "10" || j.location === "SITE") {
        return { template: "10", values: { ...base, ISSUE_SCOPE: [j.confirmedFault, j.rootCause].filter(Boolean).join("\n"), PERMIT_ISOLATION: "", ACTIVITY_TIME: `${j.workPerformed ?? ""}${j.laborHours ? `\n${Number(j.laborHours)} h` : ""}`, RESTORATION_HANDOVER: j.conclusion ?? "" } };
      }
      return { template: "09", values: { ...base, CONFIRMED_FAULT: [j.confirmedFault, j.rootCause].filter(Boolean).join("\n"), WORK_PERFORMED: j.workPerformed ?? "", PARTS_REPLACED: parts, CONFIG_BACKUP: j.configBackupRef ?? "" } };
    }
    case "QT": {
      // 12 Service Completion / 13 Customer Acceptance are both rendered from the acceptance record under the QTTH
      const acc = await prisma.acceptance.findUnique({ where: { serviceOrderId: o!.id } });
      const dv = (acc?.deliverables as { deliverable: string; criterion?: string; result?: string }[] | null) ?? [];
      const values: FieldValues = { ...common, REPORT_REF: (await prisma.document.findMany({ where: { serviceOrderId: o!.id, type: { in: ["IN", "RP", "PM"] } } })).map((x) => x.no).join(", "), PUNCH_LIST: acc?.punchList ?? "", DATE: d(acc?.acceptedAt), STATUS: acc?.status ?? "", WARRANTY: [d(acc?.warrantyStart), acc?.warrantyTerms].filter(Boolean).join(" · ") };
      for (let i = 0; i < 3; i++) { values[`DELIVERABLE_${i + 1}`] = dv[i]?.deliverable ?? ""; values[`CRITERION_${i + 1}`] = dv[i]?.criterion ?? ""; values[`RESULT_${i + 1}`] = dv[i]?.result ?? ""; }
      return { template: doc.templateCode ?? "13", values };
    }
    default:
      throw new Error(`no Word template for document type ${doc.type}`);
  }
}

/** Render a document to .docx (+ .pdf when soffice exists). Stores files under uploads/documents and sets Document.pdfUrl. */
export async function renderDocument(no: string, template?: string): Promise<{ docxPath: string; pdfPath?: string; unfilled: string[] }> {
  const { template: tpl, values } = await buildFields(no);
  const file = TEMPLATE_FILES[template ?? tpl];
  if (!file) throw new Error(`unknown template ${template ?? tpl}`);
  const { docx, unfilled } = fillDocx(await readFile(path.join(TEMPLATES, file)), values);
  await mkdir(OUT, { recursive: true });
  const docxPath = path.join(OUT, `${no}.docx`);
  await writeFile(docxPath, docx);
  let pdfPath: string | undefined;
  try {
    await exec("soffice", ["--headless", "--convert-to", "pdf", "--outdir", OUT, docxPath], { timeout: 120000 });
    pdfPath = path.join(OUT, `${no}.pdf`);
    await prisma.document.update({ where: { no }, data: { pdfUrl: `/api/documents/${no}/pdf`, templateCode: template ?? tpl } });
  } catch {
    // LibreOffice not installed on this host: the .docx is still delivered
  }
  return { docxPath, pdfPath, unfilled };
}
