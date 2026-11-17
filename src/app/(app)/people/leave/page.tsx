import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { hasRole, isApprover } from "@/lib/caps";
import { LEAVE_TYPES, SICK_CERT_FROM_DAYS } from "@/lib/leave";
import { localToday } from "@/lib/overtime";
import { leaveBalances, leaveSheet, leaveToApprove, myLeave } from "@/server/leave";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Card, Field, Grid, PageHeader, Table, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { cancelAction, decideAction, requestAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 请假 (需求清单 v4 V4-P0-12). Everyone: ask (kind, days, half a day, reason; a medical certificate for sick leave of
 * three days or more), see the balance of the year, withdraw. The approver: one tap. HR and the MD: everyone's balance
 * and the month's sheet, unpaid days in red — the payroll takes those off by itself (月薪 ÷ 30 × 天数).
 */
export default async function Leave({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; month?: string }> }) {
  const sp = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  const md = hasRole(me, "MD"), hr = hasRole(me, "MD", "HR");
  const { date: today, month: thisMonth } = localToday();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonth;
  const year = Number(today.slice(0, 4));
  const [mine, pending, bal, sheet, staff] = await Promise.all([
    myLeave(me.id), isApprover(me) || md ? leaveToApprove(me.id, md) : Promise.resolve([]), leaveBalances([me.id], year),
    hr ? leaveSheet(me.entityId, month) : Promise.resolve([]),
    hr ? prisma.employee.findMany({ where: { active: true, entityId: me.entityId }, orderBy: { code: "asc" }, select: { code: true, name: true } }) : Promise.resolve([]),
  ]);
  const b = bal.get(me.id)!;
  const kind = (k: string) => u(`leave_${k}`);
  const span = (r: { fromDate: Date; toDate: Date; half: string | null }) => { const a = r.fromDate.toISOString().slice(0, 10), z = r.toDate.toISOString().slice(0, 10); return a === z ? `${a}${r.half ? ` ${u(`leaveHalf_${r.half}`)}` : ""}` : `${a} → ${z}`; };
  const paid = LEAVE_TYPES.filter((k) => k !== "UNPAID");
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/me", label: me.code }} title={u("leaveTitle")} />
      <Flash ok={sp.ok} error={sp.error} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {paid.map((k) => <div key={k} className="rounded-xl border bg-white p-3"><div className="text-xs text-navy/70">{kind(k)}</div><div className="mt-1 text-xl font-bold text-navy">{b.left[k]}<span className="ml-1 text-xs font-normal text-navy/60">/ {b.quota[k]} {u("leaveDaysLeft")}</span></div><div className="text-xs text-navy/60">{u("leaveUsed", { n: b.used[k] })}</div></div>)}
      </div>

      <Card title={u("leaveAsk")} accent>
        <form id="leave" action={requestAction} className="space-y-3">
          <Grid>
            {hr && <Field label={u("leaveFor")}><select name="employeeCode" defaultValue="" className={inputCls}><option value="">{me.code} {me.name}</option>{staff.filter((s) => s.code !== me.code).map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}</select></Field>}
            <Field label={u("leaveKind")} required><select name="type" required defaultValue="SICK" className={inputCls}>{LEAVE_TYPES.map((k) => <option key={k} value={k}>{kind(k)}</option>)}</select></Field>
            <Field label={u("leaveFrom")} required><input name="from" type="date" required defaultValue={today} className={inputCls} /></Field>
            <Field label={u("leaveTo")}><input name="to" type="date" className={inputCls} /></Field>
            <Field label={u("leaveHalf")}><select name="half" defaultValue="" className={inputCls}><option value="">{u("leaveWholeDay")}</option><option value="AM">{u("leaveHalf_AM")}</option><option value="PM">{u("leaveHalf_PM")}</option></select></Field>
          </Grid>
          <Field label={u("leaveReason")} required><input name="reason" required className={inputCls} /></Field>
          <UploadRecognize kind="leave" formId="leave" title={u("leaveCert", { n: SICK_CERT_FROM_DAYS })} hint={u("leaveCertHint")} dictate={false} />
          <p className="rounded-lg bg-tint px-3 py-2 text-sm text-navy">{u("leaveRule")}</p>
          <button className={btnPrimary}>{u("leaveSubmit")}</button>
        </form>
      </Card>

      {pending.length > 0 && <Card title={`${u("leaveToApprove")} (${pending.length})`} accent>
        <Table head={[t("employees"), u("leaveKind"), u("leaveWhen"), u("leaveDays"), u("leaveReason"), ""]}>
          {pending.map((r) => <tr key={r.id}>
            <td className="whitespace-nowrap"><span className="font-mono text-xs">{r.employee.code}</span> {r.employee.name}</td><td className="whitespace-nowrap">{kind(r.type)}</td><td className="whitespace-nowrap">{span(r)}</td><td className="font-semibold">{Number(r.days)}</td>
            <td>{r.reason}{((r.attachments as { name: string; url: string }[] | null) ?? []).map((a) => <a key={a.url} href={a.url} target="_blank" className="ml-2 text-blue hover:underline">{a.name}</a>)}</td>
            <td><form action={decideAction.bind(null, r.id)} className="flex flex-wrap gap-1"><button name="decision" value="yes" className={btnBlue}>{u("poApprove")}</button><input name="note" placeholder={u("poDecideNotePh")} className={`${inputCls} w-36`} /><button name="decision" value="no" className={btnGhost}>{u("poRefuse")}</button></form></td>
          </tr>)}
        </Table>
      </Card>}

      <Card title={u("leaveMine")}>
        <Table head={[u("leaveKind"), u("leaveWhen"), u("leaveDays"), u("leaveReason"), t("status"), ""]}>
          {mine.map((r) => <tr key={r.id}>
            <td className="whitespace-nowrap">{kind(r.type)}</td><td className="whitespace-nowrap">{span(r)}</td><td className="font-semibold">{Number(r.days)}</td><td>{r.reason}</td>
            <td><Tag hot={r.status === "PENDING" || r.status === "REJECTED"}>{u(`leaveStatus_${r.status}`)}</Tag>{r.approver ? <span className="block text-xs text-navy/60">{r.approver.name}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span> : null}</td>
            <td>{(r.status === "PENDING" || (r.status === "APPROVED" && (hr || r.fromDate.getTime() > Date.now()))) && <form action={cancelAction.bind(null, r.id)}><button className="text-xs text-navy/60 hover:underline">{u("otWithdraw")}</button></form>}</td>
          </tr>)}
          {!mine.length && <tr><td colSpan={6} className="py-4 text-center text-navy/60">{u("leaveNone")}</td></tr>}
        </Table>
      </Card>

      {hr && <Card title={`${u("leaveSheet")} ${month}`}>
        <form className="mb-2 flex items-end gap-2"><Field label={u("leaveMonth")}><input name="month" type="month" defaultValue={month} className={inputCls} /></Field><button className={btnGhost}>{t("search")}</button></form>
        <Table head={[t("employees"), ...paid.map((k) => kind(k)), u("leave_UNPAID"), u("leaveUnpaidDays"), u("leaveWaiting"), u("leaveLeftCol")]}>
          {sheet.map((e) => <tr key={e.id}>
            <td className="whitespace-nowrap"><span className="font-mono text-xs">{e.code}</span> {e.name}</td>
            {paid.map((k) => <td key={k}>{e.taken[k] || ""}</td>)}<td>{e.taken.UNPAID || ""}</td>
            <td className={e.unpaid > 0 ? "font-semibold text-alert-ink" : ""}>{e.unpaid || ""}</td><td className={e.waiting > 0 ? "font-semibold text-alert-ink" : ""}>{e.waiting || ""}</td>
            <td className="whitespace-nowrap text-xs text-navy/70">{paid.map((k) => `${kind(k)} ${e.left[k]}/${e.quota[k]}`).join(" · ")}</td>
          </tr>)}
        </Table>
        <p className="mt-2 text-xs text-navy/70">{u("leaveSheetNote")}</p>
      </Card>}
    </div>
  );
}
