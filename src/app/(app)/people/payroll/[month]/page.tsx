import { localIso } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { BLOCKING, REVIEW_BLOCKING, REVIEW_NOTED, liveMissing, lateOvertimePreview, payrollDetail, payrollStage, lateOvertime, carriedOvertime, payrollTrail } from "@/server/payroll";
import { OT_MULTIPLIER } from "@/lib/overtime";
import { PAYROLL_ROLES } from "@/lib/pay-rules";
import { payslipNo } from "@/lib/numbering";
import { DEFAULT_BANDS, type PerfBand, type Withholding } from "@/lib/payroll-run";
import { localToday } from "@/lib/overtime";
import { Flash } from "@/components/Flash";
import { Alert, Card, PageHeader, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { taxAction, approveAction, bandsAction, computeAction, paidAction, reopenAction, saveLinesAction, submitAction, carryAction, recountAction, dropEmptyAction } from "../actions";
import { hasRole } from "@/lib/caps";

export const dynamic = "force-dynamic";

/**
 * One month's payroll (MD only). Everything the system knows is already in: salary, overtime, performance, claims.
 * The MD types only what the system cannot know — a one-off bonus, a deduction, or the accountant's withholding
 * figure — then approves. Each person is a card, so it reads the same on a phone.
 */
export default async function PayrollMonth({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ ok?: string; error?: string; ask?: string }> }) {
  const { month } = await params;
  const { ok, error, ask } = await searchParams;
  const [t, me] = await Promise.all([getTranslations("ops"), currentEmployee()]);
  if (!hasRole(me, ...PAYROLL_ROLES)) notFound();
  const md = hasRole(me, "MD"), prep = hasRole(me, "HR"), fin = hasRole(me, "FINANCE");
  const run = await payrollDetail(me.entityId, month);
  if (!run) notFound();
  const x = run.totals as Record<string, number>;
  const skipped = ((run.totals as { skipped?: string[] }).skipped) ?? [];
  const bands = ((run.policy as { bands?: PerfBand[] } | null)?.bands) ?? DEFAULT_BANDS;
  const draft = run.status === "DRAFT";
  const late = await lateOvertime(me.entityId, month); // H-R67: overtime approved after the month was last computed
  const [carried, trail] = await Promise.all([carriedOvertime(me.entityId, month), payrollTrail(me.entityId, month)]);
  const nextMonth = month.endsWith("-12") ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, "0")}`;
  const money = (n: unknown) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (run.status === "DRAFT") run.lines = await liveMissing(me.entityId, month, run.lines); // judged now (v5 P1-6)
  const preview = (ask === "carry" || ask === "recount") && late.rows.length && !late.locked ? await lateOvertimePreview(me.entityId, month, ask) : null; // 先弹窗说明后果 (v5 P1-8)
  const blocking = run.lines.filter((l) => l.missing.some((m) => BLOCKING.includes(m)));
  const reviewStop = run.lines.filter((l) => l.missing.some((m) => REVIEW_BLOCKING.includes(m))), reviewNoted = run.lines.filter((l) => l.missing.some((m) => REVIEW_NOTED.includes(m)));
  const bankGap = run.lines.some((l) => l.missing.includes("BANK"));
  const Row = ({ k, v, strong = false, minus = false }: { k: string; v: unknown; strong?: boolean; minus?: boolean }) => Number(v) === 0 && !strong ? null : <div className={`flex justify-between gap-3 ${strong ? "font-semibold text-navy" : ""}`}><span>{k}</span><span className="tabular-nums">{minus && Number(v) !== 0 ? "−" : ""}{money(v)}</span></div>;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people/payroll", label: t("payTitle") }} title={<span className="font-mono">{month}</span>} badge={<Tag hot={draft}>{t(`payStage_${payrollStage(run)}`)}</Tag>}
        actions={<>
          <details className="relative"><summary className={`${btnGhost} cursor-pointer list-none`}>{t("payExport")} ▾</summary><div className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-1 rounded-lg border bg-white p-2 text-sm shadow">
            {["bank", "sso", "pnd1", "full"].filter((k) => !(k === "bank" && bankGap)).map((k) => <a key={k} href={`/api/payroll/${month}/export?kind=${k}`} className="rounded px-2 py-1 hover:bg-tint">{t(`payExport_${k}`)}</a>)}
          </div></details>
          {draft && prep && <form action={computeAction.bind(null, month)}><button className={btnGhost}>{t("payRefresh")}</button></form>}
          {draft && prep && !run.submittedAt && <form action={submitAction.bind(null, month)}><button className={btnBlue}>{t("paySubmit")}</button></form>}
          {draft && md && <form action={approveAction.bind(null, month)}><button className={btnBlue} disabled={blocking.length > 0 || !run.taxConfirmedAt} title={blocking.length ? t("payBlocked") : !run.taxConfirmedAt ? t("payTaxFirst") : undefined} style={blocking.length || !run.taxConfirmedAt ? { opacity: 0.5 } : undefined}>{t("payApprove")}</button></form>}
          {run.status === "APPROVED" && md && <form action={reopenAction.bind(null, month)}><button className={btnGhost}>{t("payReopen")}</button></form>}
          {run.status === "APPROVED" && fin && <form action={paidAction.bind(null, month)} className="flex items-center gap-2"><input name="paidAt" type="date" defaultValue={localToday().date} className={`${inputCls} w-40`} aria-label={t("payPaidOn")} /><button className={btnBlue}>{t("payMarkPaid")}</button></form>}
        </>} />
      <Flash ok={ok} error={error} />
      {late.rows.length > 0 && (late.locked || run.submittedAt) && <div className="rounded-xl border border-alert bg-white p-3 text-sm" role="alert">
        <div className="font-semibold text-alert-ink">{t("payLateOt", { n: late.rows.length, hours: late.hours })}</div>
        <ul className="mt-1 list-disc pl-5 text-[13px] text-navy">{late.rows.map((r) => { const base = Number(run.lines.find((l) => l.employeeId === r.employeeId)?.baseSalary ?? 0), h = Number(r.actualHours ?? r.hours), x = OT_MULTIPLIER[r.kind]; return <li key={r.id}><span className="font-mono">{r.employee.code}</span> {r.employee.name} · {r.workDate.toISOString().slice(0, 10)} {r.actualStart ?? r.startTime}–{r.actualEnd ?? r.endTime} · {h} h × {x}{base > 0 ? ` = ${(Math.round(h * (base / 30 / 8) * x * 100) / 100).toFixed(2)}` : ""}</li>; })}</ul>
        {late.locked ? <p className="mt-2 text-[13px] text-navy">{t("payLateOtNext", { next: nextMonth, m: Number(month.slice(5)) })}</p>
          : <div className="mt-2 flex flex-wrap items-center gap-2">
              {prep && <Link href={`/people/payroll/${month}?ask=recount#ask`} className={btnBlue}>{t("payLateOtRecount")}</Link>}
              {(prep || md) && <Link href={`/people/payroll/${month}?ask=carry#ask`} className={btnGhost}>{t("payLateOtCarry", { next: nextMonth, m: Number(month.slice(5)) })}</Link>}
              {!prep && !md && <span className="text-[13px] text-navy/70">{t("payLateOtAskHr")}</span>}
            </div>}
      </div>}
      {preview && <div id="ask" role="dialog" aria-modal="true" className="fixed inset-0 z-40 flex items-center justify-center bg-navy/40 p-4">
        <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-5 text-sm shadow-xl">
          <h2 className="text-base font-bold text-navy">{ask === "carry" ? t("askCarryTitle", { next: preview.next }) : t("askRecountTitle", { m: Number(month.slice(5)) })}</h2>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px]">{preview.rows.map((r, i) => <li key={i}><span className="font-mono">{r.code}</span> {r.name} · {r.date} {r.time} · {r.hours} h × {r.x} = {money(r.amount)}</li>)}</ul>
          <p className={`mt-3 rounded-lg px-3 py-2 ${preview.changed ? "bg-[#FFF4E5] text-[#7A4A00]" : "bg-tint text-navy"}`}>{preview.changed ? t("askChanged", { a: money(preview.before), b: money(preview.after) }) : t("askSame", { a: money(preview.before), state: t(`payStage_${preview.stage}`) })}</p>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Link href={`/people/payroll/${month}`} className={btnGhost}>{t("askCancel")}</Link>
            <form action={(ask === "carry" ? carryAction : recountAction).bind(null, month)}><button className={btnBlue}>{t("askConfirm")}</button></form>
          </div>
        </div>
      </div>}
      {carried.rows.length > 0 && <div className="rounded-xl border border-[#E6A23C] bg-[#FFF4E5] p-3 text-[13px] text-[#7A4A00]" role="status">
        <b>{t("payCarried", { n: carried.rows.length, next: carried.rows[0].payNotBefore ?? "" })}</b>{carried.by ? ` · ${carried.by.code} ${carried.by.name} · ${localIso(carried.at)!.slice(0, 16).replace("T", " ")}` : ""}
        <ul className="mt-1 list-disc pl-5">{carried.rows.map((r) => <li key={r.id}><span className="font-mono">{r.employee.code}</span> {r.employee.name} · {r.workDate.toISOString().slice(0, 10)} {r.actualStart ?? r.startTime}–{r.actualEnd ?? r.endTime} · {Number(r.actualHours ?? r.hours)} h × {OT_MULTIPLIER[r.kind]}</li>)}</ul>
      </div>}
      {draft && prep && run.lines.length === 0 && <form action={dropEmptyAction.bind(null, month)} className="rounded-xl border bg-white p-3 text-[13px]">{t("payEmptySay")} <button className={`${btnGhost} ml-2`}>{t("payEmptyDrop")}</button></form>}
      <ol className="flex flex-wrap gap-2 text-[13px]">
        {([["payStepPrep", run.preparedBy, true], ["payStepReview", run.taxConfirmedBy, !!run.taxConfirmedAt], ["payStepApprove", run.approvedBy, !!run.approvedAt], ["payStepPaid", run.paidAt ? localIso(run.paidAt)!.slice(0, 10) : null, !!run.paidAt]] as const).map(([k, who, done], i) =>
          <li key={k} className={`rounded-full border px-3 py-1 ${done && who ? "border-navy bg-navy text-white" : "border-navy/30 bg-white text-navy/70"}`}>{i + 1}. {t(k)}{done && who ? ` · ${who}` : ""}</li>)}
      </ol>
      {draft && (reviewStop.length > 0 || reviewNoted.length > 0) && <div className="rounded-xl border border-[#E6A23C] bg-[#FFF4E5] p-3 text-[13px] text-[#7A4A00]">
        {reviewStop.length > 0 && <><div className="font-semibold">{t("payReviewStop", { n: reviewStop.length })}</div><ul className="mt-1 list-disc pl-5">{reviewStop.map((l) => <li key={l.id}><Link href={`/people/${l.employee.code}`} className="underline">{l.employee.code} {l.employee.name}</Link>：{l.missing.filter((m) => REVIEW_BLOCKING.includes(m)).map((m) => t(`miss_${m}`)).join("、")}{l.missing.includes("OVERTIME_OPEN") ? <> · <Link href="/people/overtime" className="underline">{t("payGoConfirmOt")}</Link></> : null}</li>)}</ul></>}
        {reviewNoted.length > 0 && <><div className={`font-semibold ${reviewStop.length ? "mt-2" : ""}`}>{t("payReviewNoted", { n: reviewNoted.length })}</div><ul className="mt-1 list-disc pl-5">{reviewNoted.map((l) => <li key={l.id}>{l.employee.code} {l.employee.name}：{l.missing.filter((m) => REVIEW_NOTED.includes(m)).map((m) => t(`miss_${m}`)).join("、")}</li>)}</ul></>}
      </div>}
      {draft && blocking.length > 0 && <Alert>{t("payBlockedList", { n: blocking.length })} {blocking.map((l) => `${l.employee.name}（${l.missing.filter((m) => BLOCKING.includes(m)).map((m) => t(`miss_${m}`)).join("、")}）`).join("；")}</Alert>}

      {skipped.length > 0 && <p className="rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-3 py-2 text-[13px] text-[#7A4A00]">{t("paySkipped", { n: skipped.length })} {skipped.join("、")}</p>}
      {draft && <div className={`flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-[13px] ${run.taxConfirmedAt ? "border-navy/20 bg-white text-navy" : "border-[#E6A23C] bg-[#FFF4E5] text-[#7A4A00]"}`}>
        <span className="min-w-0 flex-1">{run.taxConfirmedAt ? t("payTaxDone", { who: run.taxConfirmedBy ?? "", date: localIso(run.taxConfirmedAt)!.slice(0, 10) }) : t("payTaxTodo")}</span>
        <a href={`/api/payroll/${month}/export?kind=pnd1`} className={btnGhost}>{t("payExport_pnd1")}</a>
        {fin && !run.submittedAt && <span className="text-[13px] text-navy/70">{t("payNotSubmitted")}</span>}
        {fin && !!run.submittedAt && <form action={taxAction.bind(null, month, !run.taxConfirmedAt)} className="flex flex-wrap items-center gap-2">
          {!run.taxConfirmedAt && reviewStop.length === 0 && reviewNoted.length > 0 && <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" name="ack" required className="h-4 w-4" />{t("payReviewAck")}</label>}
          <button disabled={!run.taxConfirmedAt && reviewStop.length > 0} className={`${run.taxConfirmedAt ? btnGhost : btnPrimary} disabled:cursor-not-allowed disabled:opacity-40`}>{run.taxConfirmedAt ? t("payTaxUndo") : t("payTaxConfirm")}</button>
        </form>}
      </div>}
      <p className="text-xs text-navy/70">{t("payDeadline", { month })}</p>
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
                  <span className="font-semibold text-navy">{l.employee.name}</span><span className="font-mono text-xs text-navy/60">{code} · {payslipNo(month, code)}</span>
                  {l.missing.map((m) => <span key={m} className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${BLOCKING.includes(m) ? "bg-alert/10 text-alert-ink" : "bg-[#FFF4E5] text-[#9A5B00]"}`}>{t(`miss_${m}`)}</span>)}
                  <Link href={`/people/payroll/${month}/slip/${code}`} className="ml-auto text-xs text-blue hover:underline">{t("paySlip")}</Link>
                </div>
                <div className="mt-2 grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                  <div className="space-y-0.5">
                    <Row k={t("payBase")} v={l.baseSalary} strong />
                    {allowances.map((a, i) => <Row key={i} k={a.name} v={a.amount} />)}
                    {Number(l.leaveDeduction) > 0 && <Row k={t("payLeaveCut", { days: Number(l.unpaidLeaveDays) })} v={-Number(l.leaveDeduction)} />}
                    <Row k={l.otLateFrom.length ? `${t("payOvertime")}（${t("payOtLate", { months: l.otLateFrom.map((m) => Number(m.slice(5))).join("、") })}）` : t("payOvertime")} v={l.overtime} />
                    {Number(l.variablePay) > 0 && <Row k={`${t(l.perfBasis === "TARGET" ? "payIncentiveM" : "payIncentive")} ${money(l.variablePay)} × ${Number(l.perfFactor)}${l.perfBasis === "TARGET" ? (l.achievement != null ? `（${(Number(l.achievement) * 100).toFixed(1)}%）` : "") : l.perfScore != null ? `（${Number(l.perfScore)}）` : ""}`} v={l.incentive} strong />}
                    {Number(l.quarterlyPay) > 0 && <Row k={`${t("payIncentiveQ")} ${money(l.quarterlyPay)} × ${Number(l.quarterFactor)}${l.quarterAchieved != null ? `（${(Number(l.quarterAchieved) * 100).toFixed(1)}%）` : ""}`} v={l.quarterIncentive} strong />}
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
                {draft && prep ? <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <label className="text-xs text-navy/70">{t("payBonus")}<input name={`bonus_${code}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={Number(l.bonus) || ""} className={inputCls} /></label>
                  <label className="text-xs text-navy/70">{t("payOther")}<input name={`other_${code}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={Number(l.otherDeduction) || ""} className={inputCls} /></label>
                  <label className="text-xs text-navy/70">{t("payWhtType")}<input name={`wht_${code}`} type="number" step="0.01" min="0" inputMode="decimal" defaultValue={l.whtManual ? Number(l.wht) : ""} placeholder={t("payAuto")} className={inputCls} /></label>
                  <label className="text-xs text-navy/70">{t("note")}<input name={`note_${code}`} defaultValue={l.note ?? ""} className={inputCls} /></label>
                </div> : l.note ? <p className="mt-1 text-xs text-navy/80">{l.note}</p> : null}
              </div>
            );
          })}
        </div>
        {draft && prep && <div className="sticky bottom-3 flex justify-end pr-20"><button className={`${btnPrimary} shadow-lg`}>{t("paySave")}</button></div>}
      </form>

      {draft && md && <Card title={t("perfBands")}>
        <p className="mb-2 text-xs text-navy/70">{t("perfBandsHint")}</p>
        <form action={bandsAction.bind(null, month)} className="flex flex-wrap items-end gap-2">
          {bands.map((b, i) => <div key={i} className="flex items-center gap-1 rounded-lg border bg-white px-2 py-1 text-sm"><span>≥</span><input name="min" type="number" min={0} max={100} defaultValue={b.min} readOnly={b.min === 0} aria-label={t("perfScore")} className={`${inputCls} w-16`} /><span>→ ×</span><input name="factor" type="number" step="0.05" min={0} max={3} defaultValue={b.factor} aria-label={t("perfFactor")} className={`${inputCls} w-20`} /></div>)}
          <button className={btnGhost}>{t("perfBandsSave")}</button>
        </form>
      </Card>}
      <p className="text-xs text-navy/60">{t("payMethodNote")}</p>
      <details className="rounded-xl border bg-white p-3" open={trail.length > 0 && trail.length <= 8}>
        <summary className="cursor-pointer text-sm font-semibold text-navy">{t("payTrail")} ({trail.length})</summary>
        <ul className="mt-2 space-y-1 text-[13px]">{trail.map((a) => { const d = (a.detail ?? {}) as Record<string, unknown>; return <li key={a.id}><span className="font-mono text-xs text-navy/70">{localIso(a.at)!.slice(0, 16).replace("T", " ")}</span> · <span className="font-mono text-xs">{a.actor?.code}</span> {a.actor?.name} · <b>{t.has(`trail_${a.action}`) ? t(`trail_${a.action}`) : a.action}</b>{a.action === "PAYROLL_REVIEW_RESET" || a.action === "PAYROLL_RECOMPUTED" ? ` · ${t("trailNet")} ${d.netBefore} → ${d.netAfter} · ${t("trailOt")} ${d.overtimeBefore} → ${d.overtimeAfter}${d.via === "approve" ? ` · ${t("trailViaApprove")}` : ""}` : a.action === "OT_CARRIED" ? ` · → ${d.to} · ${d.requests} · ${d.hours} h${Array.isArray(d.list) ? ` · ${(d.list as string[]).join("; ")}` : ""}${d.grossBefore != null ? ` · ${d.changed ? `${t("trailGross")} ${d.grossBefore} → ${d.grossAfter}` : t("trailSame")}` : ""}` : a.action === "PAYROLL_RECOUNT" ? ` · ${d.overtime} · ${d.hours} h${Array.isArray(d.list) ? ` · ${(d.list as string[]).join("; ")}` : ""}${d.grossBefore != null ? ` · ${t("trailGross")} ${d.grossBefore} → ${d.grossAfter}` : ""}` : a.action === "PAYROLL_STATE" ? ` · ${t(`payStage_${d.from}`)} → ${t(`payStage_${d.to}`)} · ${t(`trailWhy_${d.reason}`)} · ${t("trailSystem", { trigger: String(d.trigger ?? "") })}` : ""}</li>; })}{!trail.length && <li className="text-navy/60">—</li>}</ul>
      </details>
    </div>
  );
}
