import { guarded } from "@/lib/action-result";
import { setReceiptAccount } from "@/server/collect";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { AGE_KEYS, financeReport, type MonthRow, cashJournal, guessAccount, presetRange, simpleBalance } from "@/server/fin-report";
import { dictMap } from "@/server/dict";
import { Card, PageHeader, Tag } from "@/components/ui";
import { hasRole } from "@/lib/caps";

export const dynamic = "force-dynamic";

/** 财务报表 (MD and finance): the year by month, what is owed to us and by us, and where the revenue came from. */
export default async function Reports({ searchParams }: { searchParams: Promise<{ year?: string; p?: string; from?: string; to?: string; test?: string }> }) {
  const sp = await searchParams;
  const [t, u, n, me, locale] = await Promise.all([getTranslations("ops"), getTranslations("ui"), getTranslations("nav"), currentEmployee(), getLocale()]);
  if (!hasRole(me, "MD", "FINANCE")) notFound();
  const thisYear = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : thisYear;
  const md = hasRole(me, "MD");
  // 日期范围 (V4-P0-14): 本月、上月、本季、今年、去年, or any two days; TEST data stays out unless asked for
  const dayRe = /^\d{4}-\d{2}-\d{2}$/;
  const custom = dayRe.test(sp.from ?? "") && dayRe.test(sp.to ?? "") && sp.from! <= sp.to!;
  const preset = custom ? "" : sp.p ?? (sp.year ? String(year) : "year");
  const range = custom ? { from: sp.from!, to: sp.to! } : presetRange(preset);
  const includeTest = sp.test === "1";
  const qs = (o: Record<string, string>) => new URLSearchParams({ ...(custom ? { from: range.from, to: range.to } : { p: preset }), ...(includeTest ? { test: "1" } : {}), ...o }).toString();
  const [r, cats, cash, bs] = await Promise.all([financeReport(me.entityId, range, { withPayroll: md, includeTest }), dictMap("expenseCategory", locale), cashJournal(me.entityId, range, { withPayroll: md, includeTest }), simpleBalance(me.entityId, range.to, { includeTest })]);
  const span = `${range.from} → ${range.to}`;
  const xl = (kind: string) => <a href={`/finance/reports/export?${qs({ kind })}`} className="rounded-lg border border-navy/30 px-2.5 py-1 text-xs font-semibold text-navy hover:bg-tint">{t("repExport")}</a>;
  // 下钻 (派修单 v4 P0-1): every number opens the documents behind it
  async function setAccount(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await setReceiptAccount({ receiptNo: String(f.get("no")), actorCode: me.code, account: String(f.get("account") ?? "") }); return "rcAccountSet"; }, "/finance/reports#cash");
  }
  const det = (k: string, o: Record<string, string> = {}) => `/finance/reports/detail?${new URLSearchParams({ k, from: range.from, to: range.to, ...(includeTest ? { test: "1" } : {}), ...o }).toString()}`;
  const monthSpan = (mo: string) => { const end = new Date(Date.UTC(Number(mo.slice(0, 4)), Number(mo.slice(5)), 0)).toISOString().slice(0, 10); return { from: `${mo}-01` < range.from ? range.from : `${mo}-01`, to: end > range.to ? range.to : end }; };
  const num = "underline decoration-navy/25 decoration-dotted underline-offset-2 hover:text-blue hover:decoration-blue";
  const m2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money = (v: number) => (v === 0 ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }));
  const cols: (keyof MonthRow)[] = ["revenue", "purchases", "expenses", ...(md ? ["payroll" as const] : []), "result", "collected", "paidSuppliers", "vatOut", "vatIn", "vatNet"];
  const peak = Math.max(1, ...r.months.map((m) => Math.max(m.revenue, m.purchases + m.expenses + m.payroll)));
  const Bars = ({ rows, label, href }: { rows: [string, number][]; label: (k: string) => string; href: (k: string) => string }) => { const max = Math.max(1, ...rows.map(([, v]) => v)); return <ul className="space-y-1">{rows.map(([k, v]) => <li key={k} className="grid grid-cols-[9rem_1fr_6rem] items-center gap-2 text-[13px]"><span className="truncate">{label(k)}</span><span className="h-2.5 rounded-full bg-navy/10"><span className="block h-2.5 rounded-full bg-blue" style={{ width: `${Math.max(3, (v / max) * 100)}%` }} /></span><Link href={href(k)} className={`text-right tabular-nums ${num}`}>{money(v)}</Link></li>)}{rows.length === 0 && <li className="text-[13px] text-navy/60">{t("repNone")}</li>}</ul>; };
  const Ageing = ({ title, a, rows, who }: { title: string; a: Record<string, number>; rows: { no: string; due: Date | null; open: number; name: string; href?: string }[]; who: string }) => (
    <Card title={title}>
      <div className="grid grid-cols-5 gap-1.5 text-center text-xs">{AGE_KEYS.map((k) => <div key={k} className={`rounded-lg border px-1 py-1.5 ${k !== "notDue" && a[k] > 0 ? "border-[#E6A23C] bg-[#FFF4E5]" : "bg-white"}`}><div className="text-navy/70">{t(`age_${k}`)}</div><div className="font-semibold tabular-nums text-navy">{money(a[k])}</div></div>)}</div>
      {rows.length > 0 && <ul className="mt-2 space-y-1 text-[13px]">{rows.map((x) => <li key={x.no} className="flex flex-wrap items-baseline gap-2"><span className="font-mono text-xs text-navy/70">{localIso(x.due)?.slice(0, 10)}</span>{x.href ? (x.href.startsWith("/api/") ? <a href={x.href} target="_blank" rel="noreferrer" className="font-mono text-blue hover:underline">{x.no}</a> : <Link href={x.href} className="font-mono text-blue hover:underline">{x.no}</Link>) : <span className="font-mono">{x.no}</span>}<span className="min-w-0 flex-1 truncate">{x.name}</span><span className="tabular-nums">{money(x.open)}</span></li>)}</ul>}
      {rows.length === 0 && <p className="mt-2 text-[13px] text-navy/60">{t("repNoOverdue", { who })}</p>}
    </Card>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={n("finReports")} badge={<Tag>THB</Tag>} actions={xl("all")} />
      <div className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3 text-sm">
        {(["month", "lastMonth", "quarter", "year", String(thisYear - 1)] as const).map((k) => <Link key={k} href={`/finance/reports?p=${k}${includeTest ? "&test=1" : ""}`} className={`whitespace-nowrap rounded-full border px-3 py-1 ${preset === k ? "border-navy bg-navy text-white" : "border-navy/25 text-navy hover:bg-tint"}`}>{/^\d/.test(k) ? k : t(`repP_${k}`)}</Link>)}
        <form className="flex flex-wrap items-end gap-2"><label className="text-xs text-navy/70">{t("repFrom")}<input name="from" type="date" defaultValue={range.from} className="mt-0.5 block rounded-md border px-2 py-1 text-sm" /></label><label className="text-xs text-navy/70">{t("repTo")}<input name="to" type="date" defaultValue={range.to} className="mt-0.5 block rounded-md border px-2 py-1 text-sm" /></label>{includeTest && <input type="hidden" name="test" value="1" />}<button className="rounded-md border border-navy/40 px-3 py-1 text-sm">{t("repShow")}</button></form>
        <Link href={`/finance/reports?${qs({ test: includeTest ? "" : "1" }).replace(/&?test=(?=&|$)/, "")}`} className="ml-auto whitespace-nowrap text-xs text-blue hover:underline">{includeTest ? t("repTestOff") : t("repTestOn")}</Link>
      </div>
      {!includeTest && <p className="text-xs text-navy/60">{t("repTestNote")}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {(["revenue", "result", "collected", "vatNet"] as const).map((k) => <div key={k} className="rounded-xl border bg-white px-3 py-2"><div className="text-xs text-navy/70">{t(`rep_${k}`)} · {span}</div><Link href={det(k)} className={`block text-lg font-bold tabular-nums ${num} ${k === "result" && r.total.result < 0 ? "text-alert-ink" : "text-navy"}`}>{money(r.total[k] as number)}</Link></div>)}
      </div>

      <Card title={<span className="flex items-center justify-between gap-2">{t("repMonthly", { year: span })}{xl("pl")}</span>}>
        <div className="mb-3 flex h-28 items-end gap-1.5" role="img" aria-label={t("repChartAlt")}>
          {r.months.map((m) => <div key={m.month} className="flex flex-1 flex-col items-center gap-1"><div className="flex h-24 w-full items-end justify-center gap-0.5"><span className="w-2/5 rounded-t bg-blue" style={{ height: `${(m.revenue / peak) * 100}%` }} title={`${t("rep_revenue")} ${money(m.revenue)}`} /><span className="w-2/5 rounded-t bg-navy/35" style={{ height: `${((m.purchases + m.expenses + m.payroll) / peak) * 100}%` }} title={`${t("repCosts")} ${money(m.purchases + m.expenses + m.payroll)}`} /></div><span className="font-mono text-[10px] text-navy/60">{m.month.slice(5)}</span></div>)}
        </div>
        <div className="mb-2 flex gap-4 text-xs text-navy/70"><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-blue" />{t("rep_revenue")}</span><span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-navy/35" />{t("repCosts")}</span></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-right text-[13px]">
            <thead><tr className="border-b text-xs text-navy/70"><th className="py-1 text-left">{t("month")}</th>{cols.map((c) => <th key={c} className="px-1.5 py-1 font-semibold">{t(`rep_${c}`)}</th>)}</tr></thead>
            <tbody>
              {r.months.map((m) => <tr key={m.month} className="border-b border-navy/10"><td className="whitespace-nowrap py-1 text-left font-mono">{m.month}</td>{cols.map((c) => <td key={c} className={`px-1.5 py-1 tabular-nums ${c === "result" ? "font-semibold" : ""} ${(c === "result" || c === "vatNet") && (m[c] as number) < 0 ? "text-alert-ink" : ""}`}>{(m[c] as number) === 0 ? "—" : <Link href={det(c, monthSpan(m.month))} className={num}>{money(m[c] as number)}</Link>}</td>)}</tr>)}
              <tr className="font-semibold text-navy"><td className="py-1.5 text-left">{t("total")}</td>{cols.map((c) => <td key={c} className="px-1.5 py-1.5 tabular-nums">{(r.total[c] as number) === 0 ? "—" : <Link href={det(c)} className={num}>{money(r.total[c] as number)}</Link>}</td>)}</tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-navy/60">{t("repBasis")}{md ? "" : ` ${t("repNoPayroll")}`}{r.foreign.length ? ` ${t("repForeign", { list: r.foreign.map(([c, v]) => `${c} ${money(v)}`).join(", ") })}` : ""}</p>
      </Card>

      <div id="cash" className="scroll-mt-20" /><Card title={<span className="flex items-center justify-between gap-2">{t("repCash", { span })}{xl("cash")}</span>}>
        {cash.accounts.length === 0 ? <p className="text-[13px] text-navy/60">{t("repCashNone")}</p> : <div className="space-y-2">
          {cash.accounts.map((a) => <details key={`${a.account}|${a.currency}`} open={!a.account} className="rounded-lg border">
            <summary className="flex cursor-pointer flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-[13px]"><b className={a.label ? "" : "text-alert-ink"}>{a.label || t("repNoAccount")}{a.label.includes(a.currency) ? "" : ` · ${a.currency}`}</b><span className="tabular-nums">{t("repOpening")} {m2(a.opening)} · {t("repIn")} {m2(a.inAmt)} · {t("repOut")} {m2(a.outAmt)} · <b>{t("repClosing")} {m2(a.closing)}</b></span></summary>
            {(a.rows.length > 0 || a.earlier.length > 0) && <div className="overflow-x-auto border-t px-2"><table className="w-full min-w-[560px] text-[13px]"><tbody>{[...a.earlier, ...a.rows].map((x) => <tr key={x.no + x.date.getTime()} className="border-b border-navy/10"><td className="whitespace-nowrap py-1 font-mono text-xs">{localIso(x.date)!.slice(0, 10)}</td><td className="whitespace-nowrap font-mono text-xs">{x.href.startsWith("/api/") ? <a href={x.href} target="_blank" rel="noreferrer" className="text-blue hover:underline">{x.no}</a> : <Link href={x.href} className="text-blue hover:underline">{x.no}</Link>}</td><td>{x.who}</td><td className="text-xs text-navy/60">{x.ref}</td><td className="text-right tabular-nums">{x.inAmt ? m2(x.inAmt) : ""}</td><td className="text-right tabular-nums">{x.outAmt ? `−${m2(x.outAmt)}` : ""}</td>
              {!a.account && <td className="py-1 pl-2">{x.rcNo ? <form action={setAccount} data-nodraft className="flex flex-wrap items-center gap-1"><input type="hidden" name="no" value={x.rcNo} />{x.hint ? <span className="whitespace-nowrap text-xs text-navy/60">{t("repWas")}「{x.hint}」</span> : null}<select name="account" required defaultValue={guessAccount(x.hint ?? "", x.currency, cash.options)} className="min-h-9 rounded-lg border border-navy/40 bg-white px-2 text-xs"><option value="" disabled>—</option>{cash.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select><button className="min-h-9 whitespace-nowrap rounded-lg bg-navy px-3 text-xs font-semibold text-white">{t("repSetAccount")}</button></form> : null}</td>}
            </tr>)}</tbody></table></div>}
          </details>)}
        </div>}
        <p className="mt-2 text-xs text-navy/60">{t("repCashNote")}</p>
      </Card>

      <Card title={<span className="flex items-center justify-between gap-2">{t("repBsTitle", { date: bs.asOf })}{xl("bs")}</span>}>
        <div className="grid gap-4 text-[13px] md:grid-cols-2">
          <table className="w-full"><tbody>
            {([["repBsCashHand", bs.assets.cashHand, det("bsCashHand")], ["repBsCashBank", bs.assets.cashBank, det("bsCashBank")], ["repBsAr", bs.assets.receivable, det("bsAr")], ["repBsStock", bs.assets.stock, det("stock")]] as const).map(([k, v, h]) => <tr key={k} className="border-b border-navy/10"><td className="py-1">{t(k)}</td><td className="text-right tabular-nums"><Link href={h} className={num}>{m2(v)}</Link></td></tr>)}
            <tr className="font-semibold"><td className="py-1.5">{t("repBsAssets")}</td><td className="text-right tabular-nums">{m2(bs.totalAssets)}</td></tr>
          </tbody></table>
          <table className="w-full"><tbody>
            {([["repBsAp", bs.liabilities.payable, det("bsAp")], ["repBsVat", bs.liabilities.vat, det("vatDue")], ["repBsWht", bs.liabilities.wht, det("whtDue")], ["repBsPayroll", bs.liabilities.payroll, det("payrollDue")]] as const).map(([k, v, h]) => <tr key={k} className="border-b border-navy/10"><td className="py-1">{t(k)}</td><td className="text-right tabular-nums"><Link href={h} className={num}>{m2(v)}</Link></td></tr>)}
            <tr className="font-semibold"><td className="py-1.5">{t("repBsLiab")}</td><td className="text-right tabular-nums">{m2(bs.totalLiabilities)}</td></tr>
            <tr className="font-bold text-navy"><td className="py-1.5">{t("repBsNet")}</td><td className={`text-right tabular-nums ${bs.net < 0 ? "text-alert-ink" : ""}`}>{m2(bs.net)}</td></tr>
          </tbody></table>
        </div>
        <p className="mt-2 text-xs text-navy/60">{t("repBsNote")}</p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {([["ar", t("repAr"), r.ar, r.arRows.map((x) => ({ ...x, name: x.customer, href: `/api/documents/${x.no}/render?format=pdf&inline=1`, c2: x.credit, c3: x.received })), r.arTotal, t("repCredit"), t("repReceived")], ["ap", t("repAp"), r.ap, r.apRows.map((x) => ({ ...x, name: x.supplier, href: `/purchasing/orders/${x.po}#si-${encodeURIComponent(x.no)}`, c2: x.wht, c3: x.paid })), r.apTotal, t("repWht"), t("repPaid")]] as const).map(([key, title, a, rows, tot, h2, h3]) => <Card key={key} title={<span id={key} className="flex scroll-mt-20 items-center justify-between gap-2">{title} · {m2(tot)}{xl(key)}</span>}>
          <div className="space-y-1.5">{AGE_KEYS.map((k) => { const mine = rows.filter((x) => x.bucket === k); return <details key={k} className={`rounded-lg border ${k !== "notDue" && a[k] > 0 ? "border-[#E6A23C] bg-[#FFF4E5]" : "bg-white"}`}>
            <summary className="flex cursor-pointer items-baseline justify-between px-3 py-1.5 text-[13px]"><span>{t(`age_${k}`)} <span className="text-navy/60">({mine.length})</span></span><b className="tabular-nums">{m2(a[k])}</b></summary>
            {mine.length > 0 && <div className="overflow-x-auto border-t bg-white px-2"><table className="w-full min-w-[520px] text-xs"><thead><tr className="text-navy/70"><th className="py-1 text-left">{t("repDocNo")}</th><th className="text-left">{t("repDue")}</th><th className="text-right">{t("repOriginal")}</th><th className="text-right">{h2}</th><th className="text-right">{h3}</th><th className="text-right">{t("repOpen")}</th></tr></thead><tbody>
              {mine.map((x) => <tr key={x.no} className="border-t border-navy/10"><td className="py-1">{x.href.startsWith("/api/") ? <a href={x.href} target="_blank" rel="noreferrer" className="font-mono text-blue hover:underline">{x.no}</a> : <Link href={x.href} className="font-mono text-blue hover:underline">{x.no}</Link>}<span className="block text-navy/60">{x.name}</span></td><td className="whitespace-nowrap font-mono">{localIso(x.due)?.slice(0, 10)}</td><td className="text-right tabular-nums">{m2(x.original)}</td><td className="text-right tabular-nums">{x.c2 ? m2(x.c2) : ""}</td><td className="text-right tabular-nums">{x.c3 ? m2(x.c3) : ""}</td><td className="text-right font-semibold tabular-nums">{m2(x.open)}</td></tr>)}
            </tbody></table></div>}
          </details>; })}</div>
        </Card>)}
        <Card title={t("repByMode", { year: span })}><Bars rows={r.byMode} label={(k) => u(`mode_${k}`)} href={(k) => det("revenue", { mode: k })} /></Card>
        <Card title={t("repByCustomer", { year: span })}><Bars rows={r.byCustomer} label={(k) => k} href={(k) => det("revenue", { customer: k })} /></Card>
        <Card title={t("repByExpense", { year: span })}><Bars rows={r.byExpense} label={(k) => cats.get(k) ?? k} href={(k) => det("expenses", { category: k })} /></Card>
      </div>
      {r.otherCurrencyOpen > 0 && <p className="text-xs text-navy/60">{t("repOtherCurrency", { n: r.otherCurrencyOpen })}</p>}
    </div>
  );
}
