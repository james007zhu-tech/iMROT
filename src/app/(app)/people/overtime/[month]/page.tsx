import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { overtimeMonthDetail } from "@/server/overtime";
import { OT_KINDS } from "@/lib/overtime";
import { Flash } from "@/components/Flash";
import { Card, PageHeader, Table, Tag, btnGhost } from "@/components/ui";
import { reopenMonthAction } from "../actions";

export const dynamic = "force-dynamic";

/** 加班费月结 — one closed month: per employee hours by kind, hourly wage, multipliers and pay (MD only). */
export default async function OvertimeMonth({ params, searchParams }: { params: Promise<{ month: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ month }, { ok, error }] = await Promise.all([params, searchParams]);
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  if (me.role !== "MD") notFound();
  const m = await overtimeMonthDetail(me.entityId, month);
  if (!m) notFound();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people/overtime", label: u("overtime") }} title={`${u("otMonthEnd")} ${m.month}`} badge={<><Tag>{u("mdOnly")}</Tag><Tag>{m.closedBy === "SYSTEM" ? u("otSystem") : m.closedBy}</Tag></>}
        actions={<form action={reopenMonthAction.bind(null, me.entityId, m.month)}><button className={btnGhost}>{u("otReopen")}</button></form>} />
      <Flash ok={ok} error={error} />
      <Card title={u("otPayLines")}>
        <Table head={[u("employee"), u("empBaseSalary"), u("otRate"), ...OT_KINDS.map((k) => u(`ot_${k}`)), u("otHours"), u("otPay")]}>
          {m.lines.map((l) => {
            const h = l.hours as Record<string, number>, a = l.amounts as Record<string, number>, x = l.multipliers as Record<string, number>;
            return <tr key={l.id}>
              <td><Link href={`/people/${l.employee.code}#salary`} className="font-mono text-blue hover:underline">{l.employee.code}</Link> {l.employee.name}{l.lateFrom.length ? <span className="block text-xs text-navy/60">{u("otLateFrom", { months: l.lateFrom.join(", ") })}</span> : null}{l.missingSalary ? <span className="block text-xs text-alert-ink">{u("otNoSalary")}</span> : null}</td>
              <td className="text-right">{Number(l.baseSalary).toFixed(2)}</td><td className="text-right">{Number(l.hourlyRate).toFixed(2)}</td>
              {OT_KINDS.map((k) => <td key={k} className="text-right">{h[k] ? <>{h[k]} h × {x[k]}<span className="block text-xs">{Number(a[k]).toFixed(2)}</span></> : "—"}</td>)}
              <td className="text-right">{Number(l.totalHours)}</td><td className="text-right font-semibold">{Number(l.total).toFixed(2)}</td>
            </tr>;
          })}
          <tr className="bg-tint font-semibold"><td colSpan={6}>{t("total")}</td><td className="text-right">{Number(m.totalHours)}</td><td className="text-right">{Number(m.totalAmount).toFixed(2)}</td></tr>
        </Table>
        <p className="mt-2 text-xs text-navy/70">{u("otPayBasis")}</p>
      </Card>
      <Card title={u("otRequestsPaid")}>
        <Table head={[u("employee"), u("otDate"), u("otTime"), u("otHours"), u("otKind"), u("otReason")]}>
          {m.requests.map((r) => <tr key={r.id}><td className="font-mono">{r.employee.code}</td><td>{r.workDate.toISOString().slice(0, 10)}</td><td>{r.actualStart ?? r.startTime}–{r.actualEnd ?? r.endTime}</td><td>{Number(r.actualHours ?? r.hours)}</td><td className="text-xs">{u(`ot_${r.kind}`)}</td><td>{r.reason}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}
