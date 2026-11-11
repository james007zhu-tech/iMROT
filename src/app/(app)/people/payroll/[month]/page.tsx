import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { payrollDetail } from "@/server/payroll";
import { DEFAULT_BANDS, type PerfBand, type Withholding } from "@/lib/payroll-run";
import { localToday } from "@/lib/overtime";
import { Flash } from "@/components/Flash";
import { Alert, Card, PageHeader, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { approveAction, bandsAction, computeAction, paidAction, reopenAction, saveLinesAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * One month's payroll (MD only). Everything the system knows is already in: salary, overtime, performance, claims.
 * The MD types only what the system cannot know — a one-off bonus, a deduction, or the accountant's withholding
 * figure — then approves. Each person is a card, so it reads the same on a phone.
 */
export default async function PayrollMonth({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { month } = await params;
  const { ok, error } = await searchParams;
  const [t, me] = await Promise.all([getTranslations("ops"), currentEmployee()]);
  if (me.role !== "MD") notFound();
  const run = await payrollDetail(me.entityId, month);
  if (!run) notFound();
  const x = run.totals as Record<string, number>;
  const skipped = ((run.totals as { skipped?: string[] }).skipped) ?? [];
  const bands = ((run.policy as { bands?: PerfBand[] } | null)?.bands) ?? DEFAULT_BANDS;
  const draft = run.status === "DRAFT";
  const money = (n: unknown) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const blocking = run.lines.filter((l) => l.missing.some((m) => ["PERFORMANCE", "OVERTIME_OPEN"].includes(m)));
  const Row = ({ k, v, strong = false, minus = false }: { k: string; v: unknown; strong?: boolean; minus?: boolean }) => Number(v) === 0 && !strong ? null : <div className={`flex justify-between gap-3 ${strong ? "font-semibold text-navy" : ""}`}><span>{k}</span><span className="tabular-nums">{minus && Number(v) !== 0 ? "−" : ""}{money(v)}</span></div>;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people/payroll", label: t("payTitle") }} title={<span className="font-mono">{month}</span>} badge={<Tag hot={draft}>{t(`pay_${run.status}`)}</Tag>}
        actions={<>
          <details className="relative"><summary className={`${btnGhost} cursor-pointer list-none`}>{t("payExport")} ▾</summary><div className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-1 rounded-lg border bg-white p-2 text-sm shadow">
            {["bank", "sso", "pnd1", "full"].map((k) => <a key={k} href={`/api/payroll/${month}/export?kind=${k}`} className="rounded px-2 py-1 hover:bg-tint">{t(`payExport_${k}`)}</a>)}
          </div></details>
          {draft && <form action={computeAction.bind(null, month)}><button className={btnGhost}>{t("payRefresh")}</button></form>}
          {draft && <form action={approveAction.bind(null, month)}><button className={btnBlue} disabled={blocking.length > 0} title={blocking.length ? t("payBlocked") : undefined} style={blocking.length ? { opacity: 0.5 } : undefined}>{t("payApprove")}</button></form>}
          {run.status === "APPROVED" && <form action={reopenAction.bind(null, month)}><button className={btnGhost}>{t("payReopen")}</button></form>}
          {run.status === "APPROVED" && <form action={paidAction.bind(null, month)} className="flex items-center gap-2"><input name="paidAt" type="date" defaultValue={localToday().date} className={`${inputCls} w-40`} aria-label={t("payPaidOn")} /><button className={btnBlue}>{t("payMarkPaid")}</button></form>}
        </>} />
      <Flash ok={ok} error={error} />
      {draft && blocking.length > 0 && <Alert>{t("payBlockedList", { n: blocking.length })} {blocking.map((l) => `${l.employee.name}（${l.missing.filter((m) => ["PERFORMANCE", "OVERTIME_OPEN"].includes(m)).map((m) => t(`miss_${m}`)).join("、")}）`).join("；")}</Alert>}

      {skipped.length > 0 && <p className="rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-3 py-2 text-[13px] text-[#7A4A00]">{t("paySkipped", { n: skipped.length })} {skipped.join("、")}</p>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {[["payPeople", x.people, false], ["payGross", x.gross, true], ["paySso", x.sso, true], ["payWht", x.wht, true], ["payNet", x.net, true], ["payCost", x.employerCost, true]].map(([k, v, m]) => <div key={k as string} className="rounded-xl border bg-white px-3 py-2"><div className="text-xs text-navy/70">{t(k as string)}</div><div className="text-lg font-bold tabular-nums text-navy">{m ? money(v) : String(v)}</div></div>)}
      </div>

      <form action={saveLinesAction.bind(null, month)} className="space-y-3">
        <div className="grid gap-3 lg:grid-cols-2">
          {run.lines.map((l) => {
            const code = l.employee.code, w = l.whtDetail as (Withholding & { allowances: number }) | null;
            const allowances = (l.allowances as { name: string; amount: number }[] | null) ?? [];
            return (
              <div key={l.id} className="rounded-xl border bg-white p-3 text-sm">
                <input type="hidden" name="code" value={code} />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-navy">{l.employee.name}</span><span className="font-mono text-xs text-navy/60">{code}</span>
                  {l.missing.map((m) => <span key={m} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${["PERFORMANCE", "OVERTIME_OPEN"].includes(m) ? "bg-alert/10 text-alert-ink" : "bg-[#FFF4E5] text-[#9A5B00]"}`}>{t(`miss_${m}`)}</span>)}
                  <Link href={`/people/payroll/${month}/slip/${code}`} className="ml-auto text-xs text-blue hover:underline">{t("paySlip")}</Link>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  <div className="space-y-0.5">
                    <Row k={t("payBase")} v={l.baseSalary} strong />
                    {allowances.map((a, i) => <Row key={i} k={a.name} v={a.amount} />)}
                    <Row k={t("payOvertime")} v={l.overtime} />
                    {Number(l.variablePay) > 0 && <Row k={`${t("payIncentive")} ${money(l.variablePay)} × ${Number(l.perfFactor)}${l.perfScore != null ? `（${Number(l.perfScore)}）` : ""}`} v={l.incentive} strong />}
                    <Row k={t("payBonus")} v={l.bonus} />
                    <div className="mt-1 border-t pt-1"><Row k={t("payGross")} v={l.gross} strong /></div>
                  </div>
                  <div className="space-y-0.5">
                    <Row k={`SSO ${money(l.ssoBase)} × 5%`} v={l.ssoEmployee} minus />
                    <Row k={t("payPvd")} v={l.pvdEmployee} minus />
                    <Row k={`${t("payWht")}${l.whtManual ? ` · ${t("payTyped")}` : ""}`} v={l.wht} minus strong />
                    <Row k={t("payOther")} v={l.otherDeduction} minus />
                    <Row k={t("payReimb")} v={l.reimbursement} />
                    <div className="mt-1 border-t pt-1"><div className="flex justify-between gap-3 text-base font-bold text-navy"><span>{t("payNet")}</span><span className="tabular-nums">{money(l.net)}</span></div></div>
                  </div>
                </div>
                {w && !l.whtManual && <p className="mt-1 text-[11px] text-navy/60">{t("payWhtHow", { year: money(w.regularYear), allow: money(w.allowances), tax: money(w.regularTaxYear), month: money(w.regularTaxMonth), extra: money(w.irregularTax) })}</p>}
                {draft ? <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="text-xs text-navy/70">{t("payBonus")}<input name={`bonus_${code}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={Number(l.bonus) || ""} className={inputCls} /></label>
                  <label className="text-xs text-navy/70">{t("payOther")}<input name={`other_${code}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={Number(l.otherDeduction) || ""} className={inputCls} /></label>
                  <label className="text-xs text-navy/70">{t("payWhtType")}<input name={`wht_${code}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={l.whtManual ? Number(l.wht) : ""} placeholder={t("payAuto")} className={inputCls} /></label>
                  <label className="text-xs text-navy/70">{t("note")}<input name={`note_${code}`} defaultValue={l.note ?? ""} className={inputCls} /></label>
                </div> : l.note ? <p className="mt-1 text-xs text-navy/80">{l.note}</p> : null}
              </div>
            );
          })}
        </div>
        {draft && <div className="sticky bottom-3 flex justify-end pr-20"><button className={`${btnPrimary} shadow-lg`}>{t("paySave")}</button></div>}
      </form>

      {draft && <Card title={t("perfBands")}>
        <p className="mb-2 text-xs text-navy/70">{t("perfBandsHint")}</p>
        <form action={bandsAction.bind(null, month)} className="flex flex-wrap items-end gap-2">
          {bands.map((b, i) => <div key={i} className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-sm"><span>≥</span><input name="min" type="number" min={0} max={100} defaultValue={b.min} readOnly={b.min === 0} aria-label={t("perfScore")} className={`${inputCls} w-16`} /><span>→ ×</span><input name="factor" type="number" step="0.05" min={0} max={3} defaultValue={b.factor} aria-label={t("perfFactor")} className={`${inputCls} w-20`} /></div>)}
          <button className={btnGhost}>{t("perfBandsSave")}</button>
        </form>
      </Card>}
      <p className="text-xs text-navy/60">{t("payMethodNote")}</p>
    </div>
  );
}
