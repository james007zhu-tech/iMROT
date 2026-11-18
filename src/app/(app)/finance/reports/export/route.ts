/** 报表导出 Excel (需求清单 v4 V4-P0-14): the same figures as the page, one workbook — P&L, cash and bank, AR, AP, balance. Finance and the MD. */
import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { localIso } from "@/lib/dates";
import { hasRole } from "@/lib/caps";
import { buildXlsx, type Cell, type Sheet } from "@/lib/xlsx";
import { currentEmployee } from "@/server/auth";
import { cashJournal, financeReport, presetRange, simpleBalance, type MonthRow } from "@/server/fin-report";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await currentEmployee();
  if (!hasRole(me, "MD", "FINANCE")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams, day = /^\d{4}-\d{2}-\d{2}$/;
  const range = day.test(sp.get("from") ?? "") && day.test(sp.get("to") ?? "") && sp.get("from")! <= sp.get("to")! ? { from: sp.get("from")!, to: sp.get("to")! } : presetRange(sp.get("p") ?? "month");
  const includeTest = sp.get("test") === "1", md = hasRole(me, "MD"), kind = sp.get("kind") ?? "all";
  const [t, r, cash, bs] = await Promise.all([getTranslations("ops"), financeReport(me.entityId, range, { withPayroll: md, includeTest }), cashJournal(me.entityId, range, { withPayroll: md, includeTest }), simpleBalance(me.entityId, range.to, { includeTest })]);
  const d = (x: Date | null) => localIso(x)?.slice(0, 10) ?? "";
  const cols: (keyof MonthRow)[] = ["revenue", "purchases", "expenses", ...(md ? ["payroll" as const] : []), "result", "collected", "paidSuppliers", "vatOut", "vatIn", "vatNet"];
  const all: Record<string, Sheet> = {
    pl: { name: t("repSheetPl"), rows: [[t("month"), ...cols.map((c) => t(`rep_${c}`))], ...r.months.map((m) => [m.month, ...cols.map((c) => m[c] as number)] as Cell[]), [t("total"), ...cols.map((c) => r.total[c] as number)]] },
    cash: { name: t("repSheetCash"), widths: [12, 20, 32, 34, 8, 14, 14, 22], rows: [[t("repDate"), t("repDocNo"), t("repParty"), t("repAccount"), t("repCcy"), t("repIn"), t("repOut"), t("repRef")], ...cash.rows.map((x) => [d(x.date), x.no, x.who, cash.label(x.account) || t("repNoAccount"), x.currency, x.inAmt || null, x.outAmt || null, x.ref] as Cell[]), [], [t("repByAccount")], ...cash.accounts.map((a) => ["", "", "", a.label || t("repNoAccount"), a.currency, a.inAmt, a.outAmt, a.inAmt - a.outAmt] as Cell[])] },
    ar: { name: t("repSheetAr"), widths: [22, 20, 34, 12, 14, 14, 14, 14, 12], rows: [[t("repDocNo"), "QTTH", t("repCustomers"), t("repDue"), t("repOriginal"), t("repCredit"), t("repReceived"), t("repOpen"), t("repBucket")], ...r.arRows.map((x) => [x.no, x.order, x.customer, d(x.due), x.original, x.credit, x.received, x.open, t(`age_${x.bucket}`)] as Cell[]), ["", "", "", t("total"), null, null, null, r.arTotal]] },
    ap: { name: t("repSheetAp"), widths: [22, 18, 34, 12, 14, 14, 14, 14, 12], rows: [[t("repDocNo"), "POTH", t("repSuppliers"), t("repDue"), t("repOriginal"), t("repWht"), t("repPaid"), t("repOpen"), t("repBucket")], ...r.apRows.map((x) => [x.no, x.po, x.supplier, d(x.due), x.original, x.wht, x.paid, x.open, t(`age_${x.bucket}`)] as Cell[]), ["", "", "", t("total"), null, null, null, r.apTotal]] },
    bs: { name: t("repSheetBs"), widths: [44, 18], rows: [[t("repBsTitle", { date: bs.asOf }), "THB"], [t("repBsCash"), bs.assets.cashMoved], [t("repBsAr"), bs.assets.receivable], [t("repBsStock"), bs.assets.stock], [t("repBsAssets"), bs.totalAssets], [], [t("repBsAp"), bs.liabilities.payable], [t("repBsVat"), bs.liabilities.vat], [t("repBsWht"), bs.liabilities.wht], [t("repBsPayroll"), bs.liabilities.payroll], [t("repBsLiab"), bs.totalLiabilities], [], [t("repBsNet"), bs.net], [], [t("repBsNote")]] },
  };
  const sheets = kind === "all" ? Object.values(all) : all[kind] ? [all[kind]] : Object.values(all);
  return new NextResponse(new Uint8Array(buildXlsx(sheets)), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="DCiT-report-${kind}-${range.from}_${range.to}.xlsx"`, "cache-control": "no-store" } });
}
