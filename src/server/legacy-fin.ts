import { prisma } from "@/lib/db";

/**
 * 历史数据进报表 (朱总 2026-11-25:「让它能够识别到历史数据，并且时间也能看得到」). What the old system (简道云) holds about
 * money, read for a period:
 *   - its tax invoices (发票)            → 开票收入 and 销项 VAT, on the invoice date
 *   - its cash book (明细账), line by line → 实际收款 / 采购 / 工资 / 费用 by the line's own category, and every line in
 *                                           the cash journal under the account it names
 * How a cash-book category lands on a report line (财神爷 may correct this table — it is the only place):
 *   收入 · 主营业务收入                      → collected
 *   支出 · 运营成本 · 工资 / 奖金            → payroll
 *   支出 · 运营成本 · the rest               → purchases (also 已付供应商)
 *   支出 · 运营费用 / 财务费用               → expenses, by 子类别
 *   税金, 固定资产, 内部资金流转, 实收资本, 其他收入 → no line of the result; cash journal only
 * A line booked the other way round (a refund) counts negative on the same line. The result lines are THB only, as for
 * the system's own papers. The cash book's amounts include VAT; the old system kept no purchase invoices, so there is
 * no input VAT from that time. Receivables are not taken from the old invoices: their 回款日期 holds expected dates.
 */
export type OldLine = "collected" | "purchases" | "payroll" | "expenses";
export interface OldInvoice { id: string; no: string; day: string; customer: string; mode: string; subtotal: number; vat: number; total: number }
export interface OldCash { id: string; no: string; day: string; dir: "in" | "out"; currency: string; amount: number; account: string; category: string; sub: string; detail: string; payee: string; line: OldLine | null; signed: number }
const MODE: [RegExp, string][] = [[/国际贸易/, "INTERNATIONAL_TRADE"], [/国内贸易/, "DOMESTIC_TRADE"], [/维护/, "MAINTENANCE"], [/电机维修/, "PARTNER_REPAIR"], [/维修/, "REPAIR"]];
const CCY: Record<string, string> = { 泰铢: "THB", 人民币: "CNY", 美元: "USD" };
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const lineOf = (dir: "in" | "out", category: string, sub: string): [OldLine | null, number] => {
  if (category === "主营业务收入") return ["collected", dir === "in" ? 1 : -1];
  if (category === "运营成本") return [/工资|奖金/.test(sub) ? "payroll" : "purchases", dir === "out" ? 1 : -1];
  if (category === "运营费用" || category === "财务费用") return ["expenses", dir === "out" ? 1 : -1];
  return [null, 0];
};
let thId: string | null | undefined;
/** from / to: YYYY-MM-DD, both days included; `to` null = no upper bound, `from` null = from the beginning. */
export async function legacyFinance(entityId: string, from: string | null, to: string | null): Promise<{ invoices: OldInvoice[]; cash: OldCash[] }> {
  if (thId === undefined) thId = (await prisma.legalEntity.findUnique({ where: { countryCode: "TH" }, select: { id: true } }))?.id ?? null;
  if (entityId !== thId) return { invoices: [], cash: [] }; // the old system was the Thai company's
  const docDate = { ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}), ...(to ? { lte: new Date(`${to}T00:00:00Z`) } : {}) };
  const docs = await prisma.legacyDoc.findMany({ where: { kind: { in: ["TAX_INVOICE", "LEDGER"] }, docDate }, select: { id: true, kind: true, no: true, docDate: true, amount: true, data: true, customer: { select: { name: true } } }, orderBy: { docDate: "asc" } });
  const invoices: OldInvoice[] = [], cash: OldCash[] = [];
  for (const d of docs) {
    const fields = (d.data as { fields?: [string, string][] }).fields ?? [], f = (s: string) => fields.find(([k]) => k.startsWith(s))?.[1] ?? "";
    const day = d.docDate!.toISOString().slice(0, 10);
    if (d.kind === "TAX_INVOICE") {
      const total = num(f("总金额")) || Number(d.amount ?? 0), vat = num(f("增值税（VAT）")), subtotal = num(f("小计")) || total - vat;
      invoices.push({ id: d.id, no: d.no ?? "", day, customer: d.customer?.name ?? f("Customer"), mode: MODE.find(([re]) => re.test(f("业务类型")))?.[1] ?? "REPAIR", subtotal, vat, total });
    } else {
      const type = f("收支类型"), dir = type.startsWith("收入") ? "in" as const : "out" as const, currency = CCY[type.split("-")[1] ?? ""] ?? "THB";
      const category = f("类别"), sub = f("子类别") || "（未分类）", amount = num(f("金额")) || Number(d.amount ?? 0), [line, sign] = lineOf(dir, category, sub);
      if (amount > 0) cash.push({ id: d.id, no: d.no ?? "", day, dir, currency, amount, account: f("收支账户"), category, sub, detail: f("明细"), payee: f("对方单位"), line: currency === "THB" ? line : null, signed: sign * amount });
    }
  }
  return { invoices, cash };
}
export const oldHref = (id: string) => `/documents/legacy/${id}`;
/** Bangkok midnight of a YYYY-MM-DD as an instant — the old records carry a day, the system's own a moment. */
export const dayAt = (day: string) => new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * 3600_000 + 12 * 3600_000);
