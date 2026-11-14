import { localIso } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { AGE_KEYS, financeReport, type MonthRow } from "@/server/fin-report";
import { dictMap } from "@/server/dict";
import { Card, PageHeader, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 财务报表 (MD and finance): the year by month, what is owed to us and by us, and where the revenue came from. */
export default async function Reports({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const sp = await searchParams;
  const [t, u, n, me, locale] = await Promise.all([getTranslations("ops"), getTranslations("ui"), getTranslations("nav"), currentEmployee(), getLocale()]);
  if (!["MD", "FINANCE"].includes(me.role)) notFound();
  const thisYear = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : thisYear;
  const md = me.role === "MD";
  const [r, cats] = await Promise.all([financeReport(me.entityId, year, { withPayroll: md }), dictMap("expenseCategory", locale)]);
  const money = (v: number) => (v === 0 ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
  const cols: (keyof MonthRow)[] = ["revenue", "purchases", "expenses", ...(md ? ["payroll" as const] : []), "result", "collected", "paidSuppliers", "vatOut", "vatIn", "vatNet"];
  const peak = Math.max(1, ...r.months.map((m) => Math.max(m.revenue, m.purchases + m.expenses + m.payroll)));
  const Bars = ({ rows, label }: { rows: [string, number][]; label: (k: string) => string }) => { const max = Math.max(1, ...rows.map(([, v]) => v)); return <ul className="space-y-1">{rows.map(([k, v]) => <li key={k} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-[13px]"><span className="truncate">{label(k)}</span><span className="h-2.5 rounded-full bg-navy/10"><span className="block h-2.5 rounded-full bg-blue" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} /></span><span className="text-right tabular-nums">{money(v)}</span></li>)}{rows.length === 0 && <li className="text-[13px] text-navy/60">{t("repNone")}</li>}</ul>; };
  const Ageing = ({ title, a, rows, who }: { title: string; a: Record<string, number>; rows: { no: string; due: Date | null; open: number; name: string; href?: string }[]; who: string }) => (
    <Card title={title}>
      <div className="grid grid-cols-5 gap-1.5 text-center text-xs">{AGE_KEYS.map((k) => <div key={k} className={`rounded-lg border px-1 py-1.5 ${k !== "notDue" && a[k] > 0 ? "border-[#E6A23C] bg-[#FFF4E5]" : "bg-white"}`}><div className="text-navy/70">{t(`age_${k}`)}</div><div className="font-semibold tabular-nums text-navy">{money(a[k])}</div></div>)}</div>
      {rows.length > 0 && <ul className="mt-2 space-y-1 text-[13px]">{rows.map((x) => <li key={x.no} className="flex flex-wrap items-baseline gap-2"><span className="font-mono text-xs text-navy/70">{localIso(x.due)?.slice(0, 10)}</span>{x.href ? <Link href={x.href} className="font-mono text-blue hover:underline">{x.no}</Link> : <span className="font-mono">{x.no}</span>}<span className="min-w-0 flex-1 truncate">{x.name}</span><span className="tabular-nums">{money(x.open)}</span></li>)}</ul>}
      {rows.length === 0 && <p className="mt-2 text-[13px] text-navy/60">{t("repNoOverdue", { who })}</p>}
    </Card>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={n("finReports")} badge={<Tag>THB</Tag>} actions={<div className="flex gap-1.5 text-sm">{[thisYear - 1, thisYear].map((y) => <Link key={y} href={`/finance/reports?year=${y}`} className={`rounded-full border px-3 py-1 font-mono ${y === year ? "border-navy bg-navy text-white" : "border-navy/30 bg-white"}`}>{y}</Link>)}</div>} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(["revenue", "result", "collected", "vatNet"] as const).map((k) => <div key={k} className="rounded-xl border bg-white px-3 py-2"><div className="text-xs text-navy/70">{t(`rep_${k}`)} · {year}</div><div className={`text-lg font-bold tabular-nums ${k === "result" && r.total.result < 0 ? "text-alert-ink" : "text-navy"}`}>{money(r.total[k] as number)}</div></div>)}
      </div>

      <Card title={t("repMonthly", { year })}>
        <div className="mb-3 flex h-28 items-end gap-1.5" role="img" aria-label={t("repChartAlt")}>
          {r.months.map((m) => <div key={m.month} className="flex flex-1 flex-col items-center gap-1"><div className="flex h-24 w-full items-end justify-center gap-0.5"><span className="w-2/5 rounded-t bg-blue" style={{ height: `${(m.revenue / peak) * 100}%` }} title={`${t("rep_revenue")} ${money(m.revenue)}`} /><span className="w-2/5 rounded-t bg-navy/35" style={{ height: `${((m.purchases + m.expenses + m.payroll) / peak) * 100}%` }} title={`${t("repCosts")} ${money(m.purchases + m.expenses + m.payroll)}`} /></div><span className="font-mono text-[10px] text-navy/60">{m.month.slice(5)}</span></div>)}
        </div>
        <div className="mb-2 flex gap-4 text-xs text-navy/70"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue" />{t("rep_revenue")}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-navy/35" />{t("repCosts")}</span></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-right text-[13px]">
            <thead><tr className="border-b text-xs text-navy/70"><th className="py-1 text-left">{t("month")}</th>{cols.map((c) => <th key={c} className="px-1.5 py-1 font-semibold">{t(`rep_${c}`)}</th>)}</tr></thead>
            <tbody>
              {r.months.map((m) => <tr key={m.month} className="border-b border-navy/10"><td className="py-1 text-left font-mono">{m.month}</td>{cols.map((c) => <td key={c} className={`px-1.5 py-1 tabular-nums ${c === "result" ? "font-semibold" : ""} ${(c === "result" || c === "vatNet") && (m[c] as number) < 0 ? "text-alert-ink" : ""}`}>{money(m[c] as number)}</td>)}</tr>)}
              <tr className="font-semibold text-navy"><td className="py-1.5 text-left">{t("total")}</td>{cols.map((c) => <td key={c} className="px-1.5 py-1.5 tabular-nums">{money(r.total[c] as number)}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-navy/60">{t("repBasis")}{md ? "" : ` ${t("repNoPayroll")}`}{r.foreign.length ? ` ${t("repForeign", { list: r.foreign.map(([c, v]) => `${c} ${money(v)}`).join(", ") })}` : ""}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Ageing title={t("repAr")} a={r.ar} who={t("repCustomers")} rows={r.arOverdue.map((x) => ({ no: x.no, due: x.due, open: x.open, name: x.customer, href: `/service-orders/${x.order}` }))} />
        <Ageing title={t("repAp")} a={r.ap} who={t("repSuppliers")} rows={r.apOverdue.map((x) => ({ no: x.no, due: x.due, open: x.open, name: x.supplier, href: "/finance/payables" }))} />
        <Card title={t("repByMode", { year })}><Bars rows={r.byMode} label={(k) => u(`mode_${k}`)} /></Card>
        <Card title={t("repByCustomer", { year })}><Bars rows={r.byCustomer} label={(k) => k} /></Card>
        <Card title={t("repByExpense", { year })}><Bars rows={r.byExpense} label={(k) => cats.get(k) ?? k} /></Card>
      </div>
      {r.otherCurrencyOpen > 0 && <p className="text-xs text-navy/60">{t("repOtherCurrency", { n: r.otherCurrencyOpen })}</p>}
    </div>
  );
}
