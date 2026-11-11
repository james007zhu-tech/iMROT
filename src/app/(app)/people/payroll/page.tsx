import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { METRICS, defaultMetric, mySlips, payrollRuns, salesProgress, scorable } from "@/server/payroll";
import { payslipNo } from "@/lib/numbering";
import { localToday } from "@/lib/overtime";
import { DEFAULT_BANDS, perfFactor, quarterOf, targetFactor, type PerfBand } from "@/lib/payroll-run";
import { Flash } from "@/components/Flash";
import { Card, PageHeader, Table, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { computeAction, scoresAction, targetAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 工资 (OPD). Everyone: their own payslips. Managers and the MD: the month's performance scores for their people —
 * the step payroll waits for. The MD: the monthly runs.
 */
export default async function Payroll({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; month?: string }> }) {
  const sp = await searchParams;
  const [t, me] = await Promise.all([getTranslations("ops"), currentEmployee()]);
  const md = me.role === "MD";
  const { month: thisMonth, previousMonth } = localToday();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : previousMonth;
  const [slips, everyone, runs] = await Promise.all([mySlips(me.id), scorable(me.code), md ? payrollRuns(me.entityId) : Promise.resolve([])]);
  // sales are paid on targets, not on a score (朱总 2026-11-11)
  const salesIds = new Set((await prisma.employee.findMany({ where: { id: { in: everyone.map((p) => p.id) }, role: "SALES" }, select: { id: true } })).map((e) => e.id));
  const people = everyone.filter((p) => !salesIds.has(p.id)), sales = md ? everyone.filter((p) => salesIds.has(p.id)) : [];
  const quarter = quarterOf(month);
  const progress = md ? await salesProgress(me.entityId, [month, quarter], sales.map((p) => p.id)) : [];
  const [reviews, salaries, run] = await Promise.all([
    prisma.performanceReview.findMany({ where: { employeeId: { in: people.map((p) => p.id) }, kind: "MONTHLY", period: month }, include: { reviewer: { select: { name: true } } } }),
    md ? prisma.salaryRecord.findMany({ where: { employeeId: { in: people.map((p) => p.id) } }, orderBy: { effectiveFrom: "desc" }, select: { employeeId: true, variablePay: true } }) : Promise.resolve([]),
    prisma.payrollRun.findUnique({ where: { entityId_month: { entityId: me.entityId, month } }, select: { status: true, policy: true } }),
  ]);
  const bands = ((run?.policy as { bands?: PerfBand[] } | null)?.bands) ?? DEFAULT_BANDS;
  const locked = !!run && run.status !== "DRAFT";
  const money = (n: unknown) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const months = [thisMonth, previousMonth, ...runs.map((r) => r.month)].filter((m, i, a) => a.indexOf(m) === i).sort().reverse();
  return (
    <div className="space-y-4">
      <PageHeader title={t("payTitle")} actions={md ? <form action={computeAction.bind(null, month)}><button className={btnBlue}>＋ {t("payNew", { month })}</button></form> : null} />
      <Flash ok={sp.ok} error={sp.error} />

      {md && <Card title={t("payRuns")}>
        <Table head={[t("month"), t("status"), t("payPeople"), t("payGross"), "SSO", t("payWht"), t("payNet"), t("payCost"), ""]}>
          {runs.map((r) => { const x = r.totals as Record<string, number>; return (
            <tr key={r.id}><td className="font-mono">{r.month}</td><td><Tag hot={r.status === "DRAFT"}>{t(`pay_${r.status}`)}</Tag></td><td className="text-right">{x.people}</td><td className="text-right tabular-nums">{money(x.gross)}</td><td className="text-right tabular-nums">{money(x.sso)}</td><td className="text-right tabular-nums">{money(x.wht)}</td><td className="text-right font-semibold tabular-nums">{money(x.net)}</td><td className="text-right tabular-nums">{money(x.employerCost)}</td><td><Link href={`/people/payroll/${r.month}`} className="text-blue hover:underline">{t("open")}</Link></td></tr>
          ); })}
          {runs.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-navy/60">{t("payNoRuns")}</td></tr>}
        </Table>
      </Card>}

      {people.length > 0 && <Card title={t("perfTitle", { month })}>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          {months.slice(0, 6).map((m) => <Link key={m} href={`/people/payroll?month=${m}`} className={`rounded-full border px-2.5 py-0.5 font-mono ${m === month ? "border-navy bg-navy text-white" : "border-navy/30 bg-white"}`}>{m}</Link>)}
          <span className="text-navy/70">{t("perfBands")}: {bands.map((b) => `≥${b.min} → ×${b.factor}`).join(" · ")}</span>
        </div>
        <p className="mb-2 text-xs text-navy/70">{locked ? t("perfLocked") : t("perfHint")}</p>
        <form action={scoresAction.bind(null, month)} className="space-y-2">
          {people.map((p) => {
            const r = reviews.find((x) => x.employeeId === p.id);
            const vp = Number(salaries.find((s) => s.employeeId === p.id)?.variablePay ?? 0);
            return (
              <div key={p.code} className="grid items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm md:grid-cols-[14rem_7rem_1fr_auto]">
                <input type="hidden" name="code" value={p.code} />
                <div><span className="font-semibold text-navy">{p.name}</span> <span className="font-mono text-xs text-navy/60">{p.code}</span>{p.position ? <div className="text-xs text-navy/60">{p.position}</div> : null}</div>
                <input name={`score_${p.code}`} type="number" min={0} max={100} step="0.5" inputMode="decimal" defaultValue={r?.score != null ? Number(r.score) : ""} placeholder={t("perfScore")} disabled={locked} aria-label={`${t("perfScore")} ${p.name}`} className={inputCls} />
                <input name={`why_${p.code}`} defaultValue={r?.conclusion ?? ""} placeholder={t("perfWhy")} disabled={locked} aria-label={`${t("perfWhy")} ${p.name}`} className={inputCls} />
                <div className="text-xs text-navy/70">{r?.score != null ? <>×{perfFactor(Number(r.score), bands)}{md && vp > 0 ? ` → ${money(vp * perfFactor(Number(r.score), bands))}` : ""} · {r.reviewer.name}</> : <span className="text-[#9A5B00]">{t("perfNotYet")}</span>}</div>
              </div>
            );
          })}
          {!locked && <div className="flex justify-end"><button className={btnPrimary}>{t("perfSave")}</button></div>}
        </form>
      </Card>}

      {sales.length > 0 && <Card title={t("tgtTitle", { month, quarter })}>
        <p className="mb-2 text-xs text-navy/70">{t("tgtHint")}</p>
        <div className="space-y-2">
          {sales.map((p) => (
            <div key={p.code} className="rounded-lg border bg-white p-3 text-sm">
              <div className="mb-1.5"><span className="font-semibold text-navy">{p.name}</span> <span className="font-mono text-xs text-navy/60">{p.code}</span></div>
              <div className="grid gap-2 lg:grid-cols-2">
                {[month, quarter].map((period) => {
                  const g = progress.find((x) => x.employeeId === p.id && x.period === period);
                  return (
                    <form key={period} action={targetAction.bind(null, month, p.code, period)} className="rounded-md border border-navy/15 p-2">
                      <div className="mb-1 flex flex-wrap items-baseline gap-2 text-xs"><span className="font-mono font-semibold text-navy">{period}</span><span className="text-navy/70">{t(period === month ? "tgtMonthly" : "tgtQuarterly")}</span>
                        {g ? <span className="ml-auto">{t("tgtActual")} <b className="tabular-nums">{money(g.actual)}</b>{g.actualManual != null ? ` (${t("payTyped")})` : ""} · {g.achievement != null ? `${(g.achievement * 100).toFixed(1)}%` : "—"} → <b>×{targetFactor(g.achievement)}</b></span> : <span className="ml-auto text-[#9A5B00]">{t("tgtNotSet")}</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                        <label className="text-xs text-navy/70">{t("tgtTarget")}<input name="target" type="number" step="0.01" min="0.01" required inputMode="decimal" defaultValue={g ? Number(g.target) : ""} className={inputCls} /></label>
                        <label className="text-xs text-navy/70">{t("tgtMetric")}<select name="metric" defaultValue={g?.metric ?? defaultMetric(period)} className={inputCls}>{METRICS.map((m) => <option key={m} value={m}>{t(`metric_${m}`)}</option>)}</select></label>
                        <label className="text-xs text-navy/70">{t("tgtManual")}<input name="actualManual" type="number" step="0.01" min="0" inputMode="decimal" defaultValue={g?.actualManual != null ? Number(g.actualManual) : ""} placeholder={g ? money(g.system) : t("payAuto")} className={inputCls} /></label>
                        <div className="flex items-end"><button className={`${btnGhost} w-full`}>{t("save")}</button></div>
                      </div>
                    </form>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </Card>}

      <Card title={t("paySlips")}>
        <ul className="space-y-1.5">
          {slips.map((s) => <li key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg border bg-white px-3 py-2 text-sm"><span className="font-mono">{s.run.month}</span><span className="font-mono text-xs text-navy/60">{payslipNo(s.run.month, me.code)}</span><Tag>{t(`pay_${s.run.status}`)}</Tag><span className="ml-auto font-semibold tabular-nums">THB {money(s.net)}</span><Link href={`/people/payroll/${s.run.month}/slip/${me.code}`} className={btnGhost}>{t("paySlip")}</Link></li>)}
          {slips.length === 0 && <li className="py-4 text-center text-sm text-navy/60">{t("payNoSlips")}</li>}
        </ul>
      </Card>
    </div>
  );
}
