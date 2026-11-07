/**
 * What the upload/paste box on top of each form may read, and which form fields it fills (rule ④).
 * Field names are the `name` attributes of the inputs on that page. Shared by the client box and the server.
 * `accept` restricts the document kinds — e.g. new customers accept only DBD certificates, ภ.พ.20 and billing info.
 */
export type RecognizeKind =
  | "asset" | "customer" | "service" | "inspection" | "receive" | "repair" | "maintenance"
  | "delivery" | "acceptance" | "payment" | "stock" | "employee" | "quote" | "entity";

export interface RecognizeSpec { fields: Record<string, string>; accept?: string[]; attachKind: string }

export const RECOGNIZE: Record<RecognizeKind, RecognizeSpec> = {
  asset: { attachKind: "NAMEPLATE", fields: { brand: "manufacturer, e.g. SIEMENS", series: "product series, e.g. SINAMICS S120", modelCode: "model / order number exactly as printed", serialNumber: "serial number exactly as printed", ratedPowerKw: "rated power kW", ratedVoltageV: "rated voltage V", ratedCurrentA: "rated current A", customerAssetNo: "customer's own asset tag if visible" } },
  customer: { attachKind: "COMPANY_DOC", accept: ["DBD", "PP20", "BILLING"], fields: { taxId: "13-digit Thai tax ID", branchCode: "5-digit branch code, 00000 = head office" } },
  service: { attachKind: "PO", fields: { serialNumber: "equipment serial number mentioned", location: "machine / line / position mentioned", reportedSymptom: "what the customer says is wrong, in their words", reportedAlarm: "alarm or fault code shown on the drive, e.g. F30001", customerRef: "customer's PO or work-order number, verbatim", productionImpact: "STOPPED if the line is down, DEGRADED if running slower, NONE otherwise" } },
  inspection: { attachKind: "INSPECTION", fields: { conditions: "test conditions: ambient, supply voltage, isolation", findings: "what was found", probableCause: "most probable cause", recommendation: "recommended work and authorisation needed", instruments: "instrument and calibration", conclusion: "conclusion / restriction of use" } },
  receive: { attachKind: "RECEIVING", fields: { sender: "who delivered the equipment", condition: "condition on arrival", fault: "fault reported with it", accessories: "accessories received, one per line as 'item × qty'" } },
  repair: { attachKind: "REPAIR", fields: { confirmedFault: "confirmed fault", rootCause: "root cause", workPerformed: "work done, step by step", configBackupRef: "parameter backup file name", laborHours: "labour hours" } },
  maintenance: { attachKind: "MAINTENANCE", fields: { runHours: "cumulative running hours", hazards: "hazards found and not yet fixed", handled: "what was fixed during this visit", recommendation: "recommended next steps" } },
  delivery: { attachKind: "DELIVERY", fields: { signedBy: "name of person who signed for the goods", signedAt: "date signed, YYYY-MM-DD", remark: "remarks written on the signed copy" } },
  acceptance: { attachKind: "ACCEPTANCE", fields: { customerSignatory: "who signed", punchList: "open items written on the form", status: "ACCEPTED, CONDITIONAL or REJECTED" } },
  payment: { attachKind: "PAYMENT", fields: { paidAt: "payment date YYYY-MM-DD", paidAmount: "amount received", whtAmount: "withholding tax deducted", whtCertRef: "withholding certificate number", bankRef: "bank transfer reference" } },
  stock: { attachKind: "STOCK", fields: { vendorPartNo: "vendor part number", qty: "quantity", batch: "batch / lot" } },
  employee: { attachKind: "ID_DOC", fields: { name: "full name", nameLocal: "name in Thai or Chinese", phone: "phone", email: "email" } },
  quote: { attachKind: "QUOTE", fields: {} },
  entity: { attachKind: "COMPANY_DOC", fields: { nameEn: "company name in English", nameLocal: "company name in the local language", taxId: "tax ID", branchCode: "branch code", addressEn: "registered address in English", addressLocal: "registered address in the local language", phone: "phone", email: "email", signatoryName: "authorised signatory" } },
};

const ALARM = /\b([FA]\d{4,5})\b/;
const PO = /(?:P\.?O\.?|PO\s*No\.?|单号|เลขที่ใบสั่งซื้อ)[\s:：#]*([A-Z0-9][A-Z0-9-]{5,})/i;
const TAX = /\b(\d{13})\b/;
const SERIAL = /(?:S\/N|SN|Serial(?:\s*No\.?)?|序列号)[\s:：]*([A-Z0-9][A-Z0-9-]{4,})/i;
const MODEL = /\b(6S[LE]\d{4}-[0-9A-Z]{4,5}-[0-9A-Z]{4}|ACS\d{3}[-0-9A-Z]+)\b/;

/** Which kind of company document a text is (customer onboarding accepts only these three). */
export function companyDocKind(text: string): "DBD" | "PP20" | "BILLING" | null {
  if (/หนังสือรับรอง|กรมพัฒนาธุรกิจการค้า|DBD|Department of Business Development/i.test(text)) return "DBD";
  if (/ภ\.?\s?พ\.?\s?20|PP\.?\s?20|ใบทะเบียนภาษีมูลค่าเพิ่ม/i.test(text)) return "PP20";
  if (/ข้อมูลออกใบกำกับ|ที่อยู่ออกใบกำกับ|billing|invoice to|开票信息|开票地址/i.test(text)) return "BILLING";
  return null;
}

/**
 * Offline fallback when no model is configured: plain patterns over pasted text or text files.
 * Deliberately narrow — it only fills what a pattern can prove.
 */
export function recognizeText(kind: RecognizeKind, text: string): { fields: Record<string, string>; docKind?: string } {
  const spec = RECOGNIZE[kind];
  const out: Record<string, string> = {};
  const set = (k: string, v: string | undefined) => { if (v && k in spec.fields) out[k] = v.trim(); };
  set("reportedAlarm", ALARM.exec(text)?.[1]);
  set("customerRef", PO.exec(text)?.[1]);
  set("taxId", TAX.exec(text)?.[1]);
  set("serialNumber", SERIAL.exec(text)?.[1]);
  set("modelCode", MODEL.exec(text)?.[1]);
  const branch = /(?:สาขา(?:ที่)?|branch)[\s:：]*(\d{5})/i.exec(text)?.[1] ?? (/สำนักงานใหญ่|head office|总部/i.test(text) ? "00000" : undefined);
  set("branchCode", branch);
  if (kind === "service" && !out.reportedSymptom) {
    const line = text.split(/\n/).map((s) => s.trim()).find((s) => s.length > 6 && !PO.test(s));
    set("reportedSymptom", line);
  }
  const docKind = kind === "customer" ? companyDocKind(text) ?? undefined : undefined;
  return { fields: out, docKind };
}
