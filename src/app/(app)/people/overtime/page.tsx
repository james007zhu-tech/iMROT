import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { autoCloseOvertime, myOvertime, overtimeMonths, overtimeToApprove, previewOvertimeMonth } from "@/server/overtime";
import { localToday, OT_KINDS, OT_MULTIPLIER, WEEKLY_OT_CAP_HOURS } from "@/lib/overtime";
import { Flash } from "@/components/Flash";
import { Card, Field, Grid, PageHeader, Table, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { actualAction, cancelAction, closeMonthAction, decideAction, requestAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 加班 (OPD, 2026-11-09). Everyone: apply before the work, confirm the actual hours after it, withdraw. Managers and the MD:
 * approve. The MD: the month-end results (closed automatically on the 1st, Bangkok time) — amounts are salary data, MD only.
 */
export default async function Overtime({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  const md = me.role === "MD";
  await autoCloseOvertime().catch(() => []); // the hourly job may have missed a restart around midnight — closing is idempotent
  const { date: today, month, previousMonth } = localToday();
  const [mine, pending, months, preview, staff] = await Promise.all([
    myOvertime(me.id), overtimeToApprove(me.id, md), md ? overtimeMonths(me.entityId) : Promise.resolve([]),
    md ? previewOvertimeMonth(me.entityId, month) : Promise.resolve([]),
    md ? prisma.employee.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { code: true, name: true } }) : Promise.resolve([]),
  ]);
  const kind = (k: string) => `${u(`ot_${k}`)} ×${OT_MULTIPLIER[k as keyof typeof OT_MULTIPLIER]}`;
  const hrs = (r: { hours: unknown; actualHours: unknown }) => Number(r.actualHours ?? r.hours);
  const prevClosed = months.some((m) => m.month === previousMonth);
  return (
    <div className="space-y-4">
      <PageHeader back={md ? { href: "/people", label: u("backToEmployees") } : { href: `/people/${me.code}`, label: me.code }} title={u("overtime")} badge={pending.length ? <Tag hot>{u("otPendingCount", { n: pending.length })}</Tag> : null} />
      <Flash ok={ok} error={error} />

      <Card title={u("otApply")}>
        <form action={requestAction} className="space-y-3">
          <Grid cols={4}>
            {md && <Field label={u("otForWhom")}><select name="employeeCode" defaultValue={me.code} className={inputCls}>{staff.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}</select></Field>}
            <Field label={u("otDate")} required><input name="workDate" type="date" required defaultValue={today} className={inputCls} /></Field>
            <Field label={u("otStart")} required><input name="startTime" type="time" required defaultValue="17:30" className={inputCls} /></Field>
            <Field label={u("otEnd")} required><input name="endTime" type="time" required defaultValue="20:30" className={inputCls} /></Field>
            <Field label={u("otBreak")}><input name="breakMinutes" type="number" min="0" step="15" defaultValue="0" className={inputCls} /></Field>
            <Field label={u("otKind")} required><select name="kind" className={inputCls}>{OT_KINDS.map((k) => <option key={k} value={k}>{kind(k)}</option>)}</select></Field>
            <Field label={u("otOrder")}><input name="serviceOrderNo" placeholder="QTTH…" className={`${inputCls} font-mono`} /></Field>
          </Grid>
          <Field label={u("otReason")} required><input name="reason" required placeholder={u("otReasonPh")} className={inputCls} /></Field>
          <p className="text-xs text-navy/70">{u("otRules", { cap: WEEKLY_OT_CAP_HOURS })}</p>
          <button className={btnPrimary}>{u("otSubmit")}</button>
        </form>
      </Card>

      {pending.length > 0 && <Card title={u("otToApprove")} accent>
        <Table head={[u("employee"), u("otDate"), u("otTime"), u("otHours"), u("otKind"), u("otReason"), ""]}>
          {pending.map((r) => <tr key={r.id}>
            <td><span className="font-mono">{r.employee.code}</span> {r.employee.name}</td>
            <td className="whitespace-nowrap">{r.workDate.toISOString().slice(0, 10)}</td>
            <td className="whitespace-nowrap">{r.actualStart ?? r.startTime}–{r.actualEnd ?? r.endTime}{r.breakMinutes ? ` (−${r.breakMinutes}′)` : ""}</td>
            <td className="font-semibold">{hrs(r)}</td><td className="text-xs">{kind(r.kind)}</td>
            <td>{r.reason}{r.serviceOrderNo && <Link href={`/service-orders/${r.serviceOrderNo}`} className="ml-1 font-mono text-xs text-blue">{r.serviceOrderNo}</Link>}{r.decisionNote && <span className="block text-xs text-alert-ink">{r.decisionNote}</span>}</td>
            <td><form action={decideAction.bind(null, r.id)} className="flex flex-wrap gap-1"><input name="note" placeholder={u("otNotePh")} className={`${inputCls} w-36`} /><button name="decision" value="APPROVED" className={btnBlue}>{u("otApprove")}</button><button name="decision" value="REJECTED" className={btnGhost}>{u("otReject")}</button></form></td>
          </tr>)}
        </Table>
      </Card>}

      <Card title={u("otMine")}>
        <Table head={[u("otDate"), u("otTime"), u("otHours"), u("otKind"), u("otReason"), t("status"), u("otPaidIn"), ""]}>
          {mine.map((r) => {
            const open = (r.status === "PENDING" || r.status === "APPROVED") && !r.payMonthId;
            return <tr key={r.id}>
              <td className="whitespace-nowrap">{r.workDate.toISOString().slice(0, 10)}</td>
              <td className="whitespace-nowrap">{r.startTime}–{r.endTime}{r.actualStart ? <span className="block text-xs text-navy/60">{u("otActual")} {r.actualStart}–{r.actualEnd}</span> : null}</td>
              <td className="font-semibold">{hrs(r)}</td><td className="text-xs">{kind(r.kind)}</td><td>{r.reason}</td>
              <td><Tag hot={r.status === "PENDING" || r.status === "REJECTED"}>{u(`otStatus_${r.status}`)}</Tag>{r.approver ? <span className="block text-xs text-navy/60">{r.approver.name}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span> : null}</td>
              <td>{r.payMonth?.month ?? "—"}</td>
              <td>{open && <div className="flex flex-wrap gap-1">
                {r.status === "APPROVED" && <form action={actualAction.bind(null, r.id)} className="flex gap-1"><input name="actualStart" type="time" defaultValue={r.actualStart ?? r.startTime} className={`${inputCls} w-24`} /><input name="actualEnd" type="time" defaultValue={r.actualEnd ?? r.endTime} className={`${inputCls} w-24`} /><button className={btnGhost}>{u("otConfirmActual")}</button></form>}
                <form action={cancelAction.bind(null, r.id)}><button className="text-xs text-navy/60 hover:underline">{u("otWithdraw")}</button></form>
              </div>}</td>
            </tr>;
          })}
          {!mine.length && <tr><td colSpan={8} className="py-4 text-center text-navy/60">{u("otNone")}</td></tr>}
        </Table>
      </Card>

      {md && <Card title={u("otMonthEnd")}>
        <p className="mb-2 text-xs text-navy/70">{u("otMonthEndHint")}</p>
        <Table head={[u("otMonth"), u("otHours"), u("otPay"), u("otClosedBy"), ""]}>
          <tr className="bg-tint"><td>{month} <Tag>{u("otRunning")}</Tag></td><td>{preview.reduce((s, l) => s + l.pay.totalHours, 0)}</td><td className="text-right">{preview.reduce((s, l) => s + l.pay.total, 0).toFixed(2)}</td><td className="text-xs text-navy/60">{u("otAutoOn", { date: `${month}-01` })}</td><td /></tr>
          {!prevClosed && <tr><td>{previousMonth}</td><td colSpan={3} className="text-xs text-alert-ink">{u("otNotClosed")}</td><td><form action={closeMonthAction.bind(null, me.entityId, previousMonth)}><button className={btnGhost}>{u("otCloseNow")}</button></form></td></tr>}
          {months.map((m) => <tr key={m.id}><td><Link href={`/people/overtime/${m.month}`} className="font-mono text-blue hover:underline">{m.month}</Link></td><td>{Number(m.totalHours)}</td><td className="text-right font-semibold">{Number(m.totalAmount).toFixed(2)}</td><td className="text-xs">{m.closedBy === "SYSTEM" ? u("otSystem") : m.closedBy} · {m.closedAt.toISOString().slice(0, 16).replace("T", " ")}</td><td /></tr>)}
        </Table>
        {preview.length > 0 && <div className="mt-3"><p className="mb-1 text-xs font-semibold text-navy">{u("otPreview", { month })}</p>
          <Table head={[u("employee"), ...OT_KINDS.map((k) => u(`ot_${k}`)), u("otRate"), u("otPay")]}>
            {preview.map((l) => <tr key={l.employeeId}><td><span className="font-mono">{l.employee.code}</span> {l.employee.name}{l.unconfirmed ? <span className="block text-xs text-alert-ink">{u("otUnconfirmed", { n: l.unconfirmed })}</span> : null}</td>{OT_KINDS.map((k) => <td key={k}>{l.pay.hours[k] || "—"}</td>)}<td>{l.missingSalary ? <span className="text-alert-ink">{u("otNoSalary")}</span> : l.pay.hourlyRate.toFixed(2)}</td><td className="text-right font-semibold">{l.pay.total.toFixed(2)}</td></tr>)}
          </Table></div>}
      </Card>}
    </div>
  );
}
