"use server";
/** Server actions of the 合作维修 page. Own module so only the order number is bound (rule: actions never close over translators or helpers). */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { addMilestone, createSubcontractInquiry, dispatchToPartner, rateSupplier, recordRetest, registerSupplierInvoice, returnFromPartner, revisePurchaseOrder, routeInHouse, routeToPartner } from "@/server/srm";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const num = (f: FormData, k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };
const date = (f: FormData, k: string) => { const v = str(f, k); return v ? new Date(v) : undefined; };
const atts = (f: FormData): { name: string; url: string; kind?: string }[] => { try { return JSON.parse(String(f.get("attachments") || "[]")); } catch { return []; } };
const back = (no: string) => `/service-orders/${no}/partner`;

export async function routeToPartnerAction(no: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); await routeToPartner({ no, actorCode: me.code, reason: String(f.get("reason") ?? "") }); return { ok: no, to: back(no) }; }, `/service-orders/${no}`);
}
export async function routeInHouseAction(no: string) {
  await guarded(async () => { const me = await currentEmployee(); await routeInHouse({ no, actorCode: me.code }); return { ok: no, to: `/service-orders/${no}` }; }, back(no));
}
export async function inquiryAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const inq = await createSubcontractInquiry({ no, actorCode: me.code, neededBy: date(f, "neededBy"), note: str(f, "note"), attachments: atts(f) });
    return { ok: inq.no, to: `/purchasing/inquiries/${inq.no}` };
  }, back(no));
}
export async function dispatchAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await dispatchToPartner({ poNo: String(f.get("poNo")), actorCode: me.code, assetCode: String(f.get("assetCode")), accessories: str(f, "accessories"), condition: str(f, "condition"), carriedBy: str(f, "carriedBy"), partnerSigned: str(f, "partnerSigned"), movedAt: date(f, "movedAt"), attachments: atts(f) });
    return r.no;
  }, back(no));
}
export async function milestoneAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    await addMilestone({ poNo: String(f.get("poNo")), actorCode: me.code, assetCode: String(f.get("assetCode")), stage: f.get("stage") as "ARRIVED", at: date(f, "at"), note: str(f, "note"), attachments: atts(f) });
  }, back(no));
}
export async function returnAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await returnFromPartner({ poNo: String(f.get("poNo")), actorCode: me.code, assetCode: String(f.get("assetCode")), returned: String(f.get("returned") ?? ""), shortAccepted: str(f, "shortAccepted"), partnerSigned: str(f, "partnerSigned"), movedAt: date(f, "movedAt"), note: str(f, "note"), attachments: atts(f) });
    return r.no;
  }, back(no));
}
export async function retestAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await recordRetest({ poNo: String(f.get("poNo")), actorCode: me.code, assetCode: String(f.get("assetCode")), passed: f.get("passed") === "1", note: str(f, "note"), attachments: atts(f) });
    return `${String(f.get("assetCode"))} ${r.passed ? "✓" : "✗"}`;
  }, back(no));
}
export async function reviseAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const price = num(f, "unitPrice");
    await revisePurchaseOrder({ poNo: String(f.get("poNo")), actorCode: me.code, reason: String(f.get("reason") ?? ""), lines: price !== undefined ? [{ description: String(f.get("description") ?? ""), qty: num(f, "qty") ?? 1, unit: str(f, "unit") ?? "set", unitPrice: price }] : undefined, expectedAt: date(f, "expectedAt"), customerConsent: str(f, "customerConsent"), attachments: atts(f) });
  }, back(no));
}
export async function rateAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    await rateSupplier({ poNo: String(f.get("poNo")), actorCode: me.code, quality: Number(f.get("quality")), onTime: Number(f.get("onTime")), price: Number(f.get("price")), cooperation: Number(f.get("cooperation")), note: str(f, "note") });
  }, back(no));
}
export async function supplierInvoiceAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const inv = await registerSupplierInvoice({ poNo: String(f.get("poNo")), actorCode: me.code, invoiceNo: String(f.get("invoiceNo") ?? ""), invoiceDate: date(f, "invoiceDate") ?? new Date(), subtotal: Number(f.get("subtotal")), vatAmount: num(f, "vatAmount"), attachments: atts(f) });
    return inv.invoiceNo;
  }, back(no));
}
