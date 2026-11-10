/**
 * What the upload/paste box on top of each form may read, and which form fields it fills (rule ④).
 * Field names are the `name` attributes of the inputs on that page. Shared by the client box and the server.
 * `accept` restricts the document kinds — e.g. new customers accept only DBD certificates, ภ.พ.20 and billing info.
 * `lines` describes repeating rows (PO lines, supplier quote lines); the page maps them to its row inputs.
 *
 * Reducing recognition errors (2026-11-08):
 *  - the model returns a confidence per field; anything under CONFIDENCE_FLOOR is still filled but marked orange
 *    (`uncertain`) so the person checks it before saving;
 *  - codes that must be copied verbatim (serials, model numbers, PO and tax numbers) are checked against the
 *    document's own text when we have it — a code the text does not contain is marked uncertain;
 *  - values are normalised (dates to YYYY-MM-DD incl. Thai Buddhist years, numbers without thousands separators,
 *    enums upper-cased) so what lands in the form is what the form expects.
 */
export type RecognizeKind =
  | "asset" | "customer" | "service" | "inspection" | "receive" | "repair" | "maintenance"
  | "delivery" | "acceptance" | "payment" | "stock" | "employee" | "quote" | "purchase" | "entity" | "decline" | "shipment" | "project" | "faultcode" | "series";

/** `strict`: a document outside `accept` is refused (customer onboarding, HR papers). Without it `accept` only names the attachment; whatever the person uploads is read. */
export interface RecognizeSpec { fields: Record<string, string>; lines?: Record<string, string>; accept?: string[]; strict?: boolean; attachKind: string }

export const CONFIDENCE_FLOOR = 0.8;

/** Fields that must appear verbatim in the document (no paraphrase, no guessing). */
export const VERBATIM_FIELDS = new Set(["serialNumber", "modelCode", "customerRef", "taxId", "quoteNo", "poNo", "whtCertRef", "bankRef", "vendorPartNo", "reportedAlarm", "customerAssetNo", "passportNo", "idCardNo", "workPermitNo", "swift", "blNo", "exportEntryNo", "acc_THB", "acc_USD", "acc_CNY", "acc_EUR"]);
const DATE_FIELDS = new Set(["reportedAt", "neededBy", "projectDue", "shippedAt", "etd", "eta", "toldAt", "signedAt", "paidAt", "quoteDate", "validUntil", "receivedAt", "poDate", "birthDate", "passportExpiresAt", "visaExpiresAt", "workPermitExpiresAt", "joinedAt", "contractEndsAt"]);
const NUMBER_FIELDS = new Set(["tPaymentDays", "ratedPowerKw", "ratedVoltageV", "ratedCurrentA", "laborHours", "runHours", "paidAmount", "whtAmount", "qty", "unitPrice", "amount", "total", "vatRate", "vatAmount", "subtotal"]);
const ENUM_FIELDS: Record<string, string[]> = { productionImpact: ["STOPPED", "DEGRADED", "NONE"], status: ["ACCEPTED", "CONDITIONAL", "REJECTED"], currency: ["THB", "USD", "CNY", "EUR", "JPY"], tCurrency: ["THB", "USD", "CNY", "EUR", "JPY"],
  tIncoterm: ["EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"], tShipMode: ["SEA", "AIR", "ROAD", "COURIER"] };

export const RECOGNIZE: Record<RecognizeKind, RecognizeSpec> = {
  asset: { attachKind: "NAMEPLATE", fields: { brand: "manufacturer, e.g. SIEMENS", series: "product series, e.g. SINAMICS S120", modelCode: "model / order number exactly as printed", serialNumber: "serial number exactly as printed", ratedPowerKw: "rated power kW", ratedVoltageV: "rated voltage V", ratedCurrentA: "rated current A", customerAssetNo: "customer's own asset tag if visible" } },
  customer: { attachKind: "COMPANY_DOC", accept: ["DBD", "PP20", "BILLING"], strict: true, fields: { taxId: "13-digit Thai tax ID", branchCode: "5-digit branch code, 00000 = head office" } },
  /** The customer's inquiry (RFQ / e-mail / LINE message), purchase order or fault report: filed under its own kind (rule: inquiry files are found on the QTTH and in the customer's "historical inquiries"). */
  service: {
    attachKind: "INQUIRY",
    accept: ["INQUIRY", "PO", "MESSAGE"],
    fields: {
      serialNumber: "equipment serial number mentioned", location: "machine / line / position mentioned", reportedSymptom: "what the customer says is wrong, in their words", reportedAlarm: "alarm or fault code shown on the drive, e.g. F30001",
      customerRef: "the document's own number (inquiry, PO or work-order number), verbatim", reportedAt: "date of the inquiry or PO, YYYY-MM-DD", productionImpact: "STOPPED if the line is down, DEGRADED if running slower, NONE otherwise",
      // 朱总 2026-11-10: the order form is filled from the customer's paper — who asks, and on which trade terms
      customerName: "name of the company that sends this inquiry or PO (the buyer), as printed", contactName: "name of the person who sends it (buyer's contact)", contactPhone: "that person's phone", contactEmail: "that person's e-mail",
      tCurrency: "currency of the prices: THB, USD, CNY, EUR or JPY", tIncoterm: "Incoterm code only: EXW FCA FAS FOB CFR CIF CPT CIP DAP DPU DDP", tPlace: "named place or port of the Incoterm", tShipMode: "SEA, AIR, ROAD or COURIER",
      tDestCountry: "country the goods go to", tDestPort: "port or city of destination", tPaymentTerms: "payment terms as written", tPaymentDays: "credit days as a number, 0 if payment in advance",
    },
    lines: { sku: "part / order number exactly as printed", description: "line description as printed", qty: "quantity", unit: "unit (pcs, set, job, h)", unitPrice: "unit price if printed", neededBy: "required delivery date YYYY-MM-DD if printed",
      hsCode: "HS code if printed; if not printed, your best 6-digit HS classification for this item (e.g. 8504.40 for a frequency inverter)", origin: "country of origin as a 2-letter code if printed or evident from the manufacturer" },
  },
  /**
   * 检测单 (朱总 2026-11-10: the engineer speaks and photographs, the form is drafted — cause and conclusion included,
   * for him to confirm). Field names are the form's own input names; the test rows are fixed keys.
   */
  inspection: { attachKind: "INSPECTION",
    fields: {
      conditions: "test conditions: ambient, supply voltage measured, isolation / lock-out state", findings: "what was found, in order, facts only", probableCause: "most probable cause — draft it from the evidence and the context", recommendation: "recommended work and what the customer must authorise",
      instruments: "instruments used and their calibration, if mentioned", openIssues: "what could not be checked or is still unclear", conclusion: "conclusion and any restriction of use — draft it from the evidence",
      r_visual: "visual inspection: what was seen", p_visual: "visual inspection passed? yes or no",
      r_supply: "supply / DC link measurement with units", c_supply: "its acceptance criterion if known (e.g. 380–415 V)", p_supply: "yes or no",
      r_faultLog: "fault log / alarm history read from the device", p_faultLog: "yes or no",
      r_functional: "functional or run test result", p_functional: "yes or no",
      t_extra1: "name of a further test that was done (e.g. insulation resistance)", c_extra1: "its criterion", r_extra1: "its result with units", p_extra1: "yes or no",
      t_extra2: "name of another further test", c_extra2: "its criterion", r_extra2: "its result with units", p_extra2: "yes or no",
    },
    lines: { kind: "PART or LABOUR", sku: "part SKU, only from the list in the context", description: "part or work needed, in English", descriptionLocal: "the same description written in Thai script (ภาษาไทย) — never Chinese; leave empty if you cannot", qty: "quantity (hours for labour)", unit: "pcs, set, h" } },
  receive: { attachKind: "RECEIVING", fields: { sender: "who delivered the equipment (person, company, vehicle)", condition: "condition on arrival: damage, missing covers, dirt, moisture — facts as seen", fault: "fault reported with it", accessories: "accessories received, one per line as 'item × qty'", handlingRestrictions: "handling restrictions: do not power up, static-sensitive, keep upright …" } },
  repair: { attachKind: "REPAIR", fields: { confirmedFault: "the fault as confirmed on the bench or on site", rootCause: "root cause — draft it from the evidence and the inspection in the context", workPerformed: "work done, step by step, in the order done", configBackupRef: "parameter backup file name", laborHours: "labour hours", openIssues: "what remains open or was not done", conclusion: "conclusion and any restriction of use — draft it from the test results" } },
  maintenance: { attachKind: "MAINTENANCE", fields: { runHours: "cumulative running hours read from the machine", hazards: "hazards found and NOT yet fixed — the real result of the visit", handled: "what was fixed during this visit", recommendation: "recommended next steps — draft from the hazards", conditionRating: "GOOD, GOOD_WITH_ISSUE or POOR — judge from the hazards", laborHours: "labour hours", consumables: "consumables and parts used" } },
  /** 客户拒绝报价: the customer's reply in any form (e-mail, LINE, letter) — never rejected, kept on the order as DECLINE; fills the note and the date. */
  /** 故障代码: a manual page or a photo of the drive's display — the code and the manufacturer's words (kept internal). */
  faultcode: { attachKind: "KNOWLEDGE", fields: { code: "the fault/alarm code exactly as shown, leading zeros kept", title_en: "the code's name as the manual prints it", manual_en_meaning: "the manual's cause text, verbatim", manual_en_actions: "the manual's action text, verbatim", source_page: "manual page number" } },
  /** 产品系列: a catalogue or manual cover — series name and code. */
  series: { attachKind: "KNOWLEDGE", fields: { name: "product series name as the manufacturer writes it", code: "short series code", codeRule: "how the series' fault codes look, if the document says" } },
  decline: { attachKind: "DECLINE", fields: { declineNote: "why the customer does not go ahead, in their words", toldAt: "date of the reply YYYY-MM-DD" } },
  delivery: { attachKind: "DELIVERY", fields: { signedBy: "name of person who signed for the goods", signedAt: "date signed, YYYY-MM-DD", remark: "remarks written on the signed copy" } },
  acceptance: { attachKind: "ACCEPTANCE", fields: { customerSignatory: "who signed", punchList: "open items written on the form", status: "ACCEPTED, CONDITIONAL or REJECTED" } },
  payment: { attachKind: "PAYMENT", fields: { paidAt: "payment date YYYY-MM-DD (the date the money arrived)", paidAmount: "amount received, number only", whtAmount: "withholding tax deducted, number only", whtCertRef: "withholding certificate number", bankRef: "bank transfer reference / slip number" } },
  stock: { attachKind: "STOCK", fields: { vendorPartNo: "vendor part number", qty: "quantity", batch: "batch / lot" } },
  /** CV, passport / ID card, visa, work permit, labour contract, degree: header fields + work-history lines (rule ④). */
  employee: {
    attachKind: "ID_DOC", strict: true,
    accept: ["CV", "PASSPORT", "ID_CARD", "VISA", "WORK_PERMIT", "CONTRACT", "DEGREE", "CERTIFICATE"],
    fields: {
      name: "full name in Latin letters as on the passport or CV", nameLocal: "name in Thai or Chinese characters if written", nationality: "nationality", birthDate: "date of birth YYYY-MM-DD", gender: "M or F if stated",
      phone: "mobile phone with country code", phone2: "second mobile if any", email: "work email", personalEmail: "personal email", lineId: "LINE ID", wechatId: "WeChat ID", address: "current address in Thailand",
      emergencyName: "emergency contact name", emergencyRelation: "relation of the emergency contact", emergencyPhone: "emergency contact phone",
      position: "current or applied-for job title", education: "highest degree and field, one line",
      passportNo: "passport number verbatim", passportExpiresAt: "passport expiry YYYY-MM-DD", idCardNo: "Thai ID card number verbatim (13 digits)", visaExpiresAt: "visa permitted-to-stay date YYYY-MM-DD", workPermitNo: "work permit number verbatim", workPermitExpiresAt: "work permit expiry YYYY-MM-DD",
      joinedAt: "start date on the labour contract YYYY-MM-DD", contractEndsAt: "contract end date YYYY-MM-DD if fixed-term",
    },
    lines: { fromYm: "start of the job, YYYY-MM", toYm: "end of the job, YYYY-MM (empty if current)", company: "employer name", title: "job title", summary: "main duties and skills in one line" },
  },
  // 自动化项目: the customer's URS, a drawing list or a BOM — fills the plan page (solution text and BOM rows)
  project: { attachKind: "INQUIRY", fields: { projectName: "project or line name", projectScope: "what the customer wants done, in their words, one paragraph", projectDue: "required completion date YYYY-MM-DD", solution: "proposed solution if the document states one", customerRef: "customer's inquiry or PO number, verbatim" },
    lines: { sku: "part / order number exactly as printed", description: "item description", qty: "quantity", unit: "unit" } },
  // 国际贸易 shipment: the booking confirmation, B/L / AWB or export entry the forwarder sends back
  shipment: { attachKind: "SHIPPING", fields: { blNo: "bill of lading or air waybill number exactly as printed", vessel: "vessel and voyage, or flight number", shippedAt: "shipped on board / flight date YYYY-MM-DD", etd: "estimated departure YYYY-MM-DD", eta: "estimated arrival YYYY-MM-DD", portLoading: "port or airport of loading", portDischarge: "port or airport of discharge", exportEntryNo: "Thai export entry (ใบขนสินค้าขาออก) number exactly as printed", forwarder: "freight forwarder or carrier name" } },
  entity: { attachKind: "COMPANY_DOC", fields: { nameEn: "company name in English", nameLocal: "company name in the local language", taxId: "tax ID", branchCode: "branch code", addressEn: "registered address in English", addressLocal: "registered address in the local language", phone: "phone", email: "email", signatoryName: "authorised signatory", bank: "receiving bank name, e.g. BANK OF CHINA (THAI) PCL", bankBranch: "bank branch", bankCode: "bank code", bankBranchCode: "bank branch code", accountName: "bank account name", swift: "SWIFT / BIC code", acc_THB: "THB account number exactly as printed", acc_USD: "USD account number exactly as printed", acc_CNY: "CNY / RMB account number exactly as printed", acc_EUR: "EUR account number exactly as printed" } },
  /** A supplier's quotation pasted into our own quote: header + priced lines (costs for the margin). */
  quote: {
    attachKind: "QUOTE",
    fields: { supplier: "supplier company name as printed", quoteNo: "supplier's quotation number, verbatim", quoteDate: "quotation date YYYY-MM-DD", validUntil: "valid until YYYY-MM-DD", currency: "currency code (THB, USD, CNY, EUR)", vatRate: "VAT rate as a decimal, e.g. 0.07", subtotal: "total before VAT, number only", total: "grand total including VAT, number only" },
    lines: { vendorPartNo: "part / model number exactly as printed", description: "item description", qty: "quantity", unit: "unit", unitPrice: "unit price, number only", amount: "line amount, number only" },
  },
  /** Supplier quotation read into a PRTH / POTH. */
  purchase: {
    attachKind: "SUPPLIER_QUOTE",
    fields: { supplier: "supplier company name as printed", supplierTaxId: "supplier tax ID if printed", quoteNo: "supplier's quotation number, verbatim", quoteDate: "quotation date YYYY-MM-DD", validUntil: "valid until YYYY-MM-DD", currency: "currency code", vatRate: "VAT rate as a decimal", subtotal: "total before VAT, number only", vatAmount: "VAT amount, number only", total: "grand total, number only", leadTime: "delivery lead time as written", paymentTerms: "payment terms as written" },
    lines: { vendorPartNo: "part / model number exactly as printed", description: "item description", qty: "quantity", unit: "unit", unitPrice: "unit price, number only", amount: "line amount, number only" },
  },
};

const ALARM = /\b([FA]\d{4,5})\b/;
const PO = /(?:P\.?O\.?|PO\s*No\.?|单号|เลขที่ใบสั่งซื้อ)[\s:：#]*([A-Z0-9][A-Z0-9-]{5,})/i;
const TAX = /\b(\d{13})\b/;
const SERIAL = /(?:S\/N|SN|Serial(?:\s*No\.?)?|序列号)[\s:：]*([A-Z0-9][A-Z0-9-]{4,})/i;
const MODEL = /\b(6S[LE]\d{4}-[0-9A-Z]{4,5}-[0-9A-Z]{4}|ACS\d{3}[-0-9A-Z]+)\b/;
const QUOTE_NO = /(?:Quotation|Quote|ใบเสนอราคา|报价单?)\s*(?:No\.?|#|เลขที่|号)?[\s:：]*([A-Z]{1,4}[-]?\d{4,}[A-Z0-9-]*)/i;

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
  set("quoteNo", QUOTE_NO.exec(text)?.[1]);
  const branch = /(?:สาขา(?:ที่)?|branch)[\s:：]*(\d{5})/i.exec(text)?.[1] ?? (/สำนักงานใหญ่|head office|总部/i.test(text) ? "00000" : undefined);
  set("branchCode", branch);
  if (kind === "service" && !out.reportedSymptom) {
    const line = text.split(/\n/).map((s) => s.trim()).find((s) => s.length > 6 && !PO.test(s));
    set("reportedSymptom", line);
  }
  const docKind = kind === "customer" ? companyDocKind(text) ?? undefined : undefined;
  return { fields: normalizeFields(out), docKind };
}

// ───────────── normalisation and verification (pure; tested) ─────────────

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** Dates in any of the forms that turn up on Thai/Chinese/English paperwork → YYYY-MM-DD; unknown forms pass through. */
export function normalizeDate(v: string): string {
  const s = v.trim();
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let r: RegExpExecArray | null;
  if ((r = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/.exec(s))) { y = +r[1]; m = +r[2]; d = +r[3]; }
  else if ((r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(s))) { d = +r[1]; m = +r[2]; y = +r[3]; if (y < 100) y += 2000; }
  else if ((r = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/.exec(s))) { d = +r[1]; m = MONTHS[r[2].slice(0, 4).toLowerCase()] ?? MONTHS[r[2].slice(0, 3).toLowerCase()]; y = +r[3]; }
  else if ((r = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(s))) { m = MONTHS[r[1].slice(0, 3).toLowerCase()]; d = +r[2]; y = +r[3]; }
  else if ((r = /^(\d{1,2})\s+(\S+?\.)\s*(\d{4})$/.exec(s)) && THAI_MONTHS.includes(r[2])) { d = +r[1]; m = THAI_MONTHS.indexOf(r[2]) + 1; y = +r[3]; }
  if (!y || !m || !d) return s;
  if (y > 2400) y -= 543; // Thai Buddhist calendar
  if (m < 1 || m > 12 || d < 1 || d > 31) return s;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "1,234.50 THB" → "1234.50"; "7%" on a rate field → "0.07". */
export function normalizeNumber(v: string, field?: string): string {
  const s = v.replace(/[^\d.,%-]/g, "");
  const pct = /%$/.test(s);
  const n = Number(s.replace(/%/g, "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return v.trim();
  if (field === "vatRate") return String(pct || n > 1 ? n / 100 : n);
  return String(n);
}

export function normalizeFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(fields)) {
    let v = String(raw).trim();
    if (!v) continue;
    if (DATE_FIELDS.has(k)) v = normalizeDate(v);
    else if (NUMBER_FIELDS.has(k)) v = normalizeNumber(v, k);
    else if (k in ENUM_FIELDS) { const up = v.toUpperCase().replace(/^RMB$/, "CNY"); v = ENUM_FIELDS[k].find((e) => up.startsWith(e)) ?? v; }
    else if (k === "taxId" || k === "branchCode") v = v.replace(/\D/g, "");
    else if (k === "reportedAlarm") v = v.toUpperCase();
    out[k] = v;
  }
  return out;
}

export interface RecognizedLine { [k: string]: string }

export function normalizeLines(spec: RecognizeSpec, lines: unknown): RecognizedLine[] {
  if (!Array.isArray(lines) || !spec.lines) return [];
  return lines.map((l) => normalizeFields(Object.fromEntries(Object.entries((l ?? {}) as Record<string, unknown>).filter(([k, v]) => k in spec.lines! && v != null && String(v).trim() !== "").map(([k, v]) => [k, String(v)])))).filter((l) => Object.keys(l).length > 0);
}

const loose = (s: string) => s.replace(/[\s\-_.:/]/g, "").toUpperCase();

/**
 * Which filled fields a person should double-check: confidence below the floor, or a verbatim code that the
 * document's own text (when we have it) does not contain. Fields are still filled — just marked.
 */
export function uncertainFields(fields: Record<string, string>, confidence: Record<string, number> | undefined, text: string | undefined): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(fields)) {
    const c = confidence?.[k];
    if (typeof c === "number" && c < CONFIDENCE_FLOOR) out.add(k);
    if (text && text.length > 20 && VERBATIM_FIELDS.has(k) && !loose(text).includes(loose(fields[k]))) out.add(k);
  }
  return [...out];
}
