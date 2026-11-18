/**
 * 预扣税的所得类型 (派修单 v4 A): what a payment to a supplier is for decides the rate withheld and the line of the
 * 50 ทวิ it is written on (ข้อ 5 — มาตรา 3 เตรส). The rate can still be changed on the payment.
 */
export const WHT_TYPES = ["SERVICE", "RENT", "TRANSPORT", "ADVERTISING", "OTHER"] as const;
export type WhtType = (typeof WHT_TYPES)[number];
export const WHT_RATE: Record<WhtType, number> = { SERVICE: 0.03, RENT: 0.05, TRANSPORT: 0.01, ADVERTISING: 0.02, OTHER: 0 };
export const WHT_TH: Record<WhtType, string> = { SERVICE: "ค่าบริการ / ค่าจ้างทำของ", RENT: "ค่าเช่า", TRANSPORT: "ค่าขนส่ง", ADVERTISING: "ค่าโฆษณา", OTHER: "อื่น ๆ" };
/** A Thai taxpayer number: 13 digits (dashes and spaces aside). */
export const taxId13 = (s?: string | null) => (s ?? "").replace(/[\s-]/g, "");
export const isTaxId13 = (s?: string | null) => /^\d{13}$/.test(taxId13(s));
/** ภ.ง.ด.53 for a company or partnership, ภ.ง.ด.3 for a person — by the name on file. */
export const pndOf = (name: string) => (/co\.?,?\s*ltd|limited|company|corp|inc\.|partnership|บริษัท|จำกัด|ห้างหุ้นส่วน|หจก|有限|公司/i.test(name) ? "53" : "3");
