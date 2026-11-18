import { OT_MULTIPLIER } from "@/lib/overtime";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { hasRole } from "@/lib/caps";
import { currentEmployee } from "@/server/auth";
import { PageHeader, Table, btnGhost, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * 操作记录 (派修单 v4): everything the system wrote into its audit log — who, when, what, on which record. The MD sees
 * all of it; finance sees money, payroll, overtime and rates. Filter by a word of the action, the record, the person, the day.
 */
const FIN = ["PAYROLL", "OT_", "FX_", "PAYMENT", "PAYABLE", "PO_", "TAX_", "INVOICE", "RECEIPT", "CREDIT", "EXPENSE", "LEAVE", "HOLIDAY", "NO_INVOICE"];
export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; who?: string; day?: string; page?: string }> }) {
  const sp = await searchParams;
  const [u, me] = await Promise.all([getTranslations("ui"), currentEmployee()]);
  const md = hasRole(me, "MD"), q = (sp.q ?? "").trim(), who = (sp.who ?? "").trim(), day = /^\d{4}-\d{2}-\d{2}$/.test(sp.day ?? "") ? sp.day! : "", page = Math.max(1, Number(sp.page) || 1), size = 100;
  const from = day ? new Date(new Date(`${day}T00:00:00Z`).getTime() - 7 * 3600_000) : undefined;
  const where = { AND: [
    md ? {} : { OR: FIN.map((p) => ({ action: { startsWith: p } })) },
    q ? { OR: [{ action: { contains: q.toUpperCase() } }, { target: { contains: q, mode: "insensitive" as const } }] } : {},
    who ? { actor: { OR: [{ code: { contains: who, mode: "insensitive" as const } }, { name: { contains: who, mode: "insensitive" as const } }] } } : {},
    from ? { at: { gte: from, lt: new Date(from.getTime() + 86_400_000) } } : {},
  ] };
  const rows = await prisma.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * size, take: size + 1, include: { actor: { select: { code: true, name: true } } } });
  // 派修单 v5 P1-10: an overtime row says whose overtime, which day and which hours — not an internal id
  const otIds = rows.filter((r) => r.action.startsWith("OT_") && /^c[a-z0-9]{20,}$/.test(r.target ?? "")).map((r) => r.target!);
  const ots = new Map((otIds.length ? await prisma.overtimeRequest.findMany({ where: { id: { in: otIds } }, select: { id: true, workDate: true, startTime: true, endTime: true, actualStart: true, actualEnd: true, hours: true, actualHours: true, kind: true, employee: { select: { code: true, name: true } } } }) : []).map((o) => [o.id, o]));
  // H-R84 / H-R77 / H-R85: the payroll and overtime rows are sentences, not raw JSON; a carried overtime links to its request (H-R78)
  const stageName: Record<string, string> = { COMPUTING: "HR 计算中", REVIEW: "待财务复核", APPROVE: "待 MD 批准", APPROVED: "已批准", PAID: "已发放" };
  const say = (r: { action: string; detail: unknown }) => {
    const d = (r.detail ?? null) as Record<string, unknown> | null; if (!d) return "";
    const st = d.from && d.to ? `${stageName[String(d.from)] ?? d.from} → ${stageName[String(d.to)] ?? d.to}` : "";
    const gross = d.grossBefore != null && d.grossAfter != null ? `应发合计 ${d.grossBefore} → ${d.grossAfter}` : "";
    if (r.action === "OT_CARRIED") { const who = (d.who as { id: string; code: string; month: string }[] | undefined) ?? []; const list = (d.list as string[] | undefined) ?? [];
      return <>挂到 {String(d.to)} 发放：{list.map((x, i) => <span key={i}>{i ? "；" : ""}{who[i] ? <Link href={`/people/overtime?code=${who[i].code}&month=${who[i].month}`} className="text-blue hover:underline">{x}</Link> : x}</span>)}。本月工资金额不变，状态不变{d.stateBefore ? `（${stageName[String(d.stateBefore)] ?? d.stateBefore}）` : ""}。</>; }
    if (r.action === "PAYROLL_RECOUNT") return `补算进本月：${((d.list as string[] | undefined) ?? []).join("；")}。${gross}。${d.stateBefore && d.stateAfter ? `${stageName[String(d.stateBefore)] ?? d.stateBefore} → ${stageName[String(d.stateAfter)] ?? d.stateAfter}` : ""}`;
    if (r.action === "PAYROLL_STATE") return `状态变化：${st}。原因：${d.reason === "RECOUNT" ? "补算，金额变化，需财务重新复核" : String(d.reason)}。系统（由 ${String(d.trigger ?? "")} 触发）`;
    if (r.action.startsWith("PAYROLL_") && (st || gross)) return [st && `状态：${st}`, gross, Array.isArray(d.people) && d.people.length ? `变动：${(d.people as string[]).join("；")}` : "", d.note ? `原因：${d.note}` : "", d.reason === "RECOMPUTED_MOVED" ? "重新计算后数字有变，退回财务复核" : ""].filter(Boolean).join("。");
    return JSON.stringify(d);
  };
  const otLabel = (id: string) => { const o = ots.get(id); return o ? { text: `${o.employee.code} ${o.employee.name} · ${o.workDate.toISOString().slice(0, 10)} ${o.actualStart ?? o.startTime}–${o.actualEnd ?? o.endTime} · ${Number(o.actualHours ?? o.hours)} h ×${OT_MULTIPLIER[o.kind]}`, href: `/people/overtime?code=${o.employee.code}&month=${o.workDate.toISOString().slice(0, 7)}` } : null; };
  const qs = (p: number) => new URLSearchParams({ ...(q ? { q } : {}), ...(who ? { who } : {}), ...(day ? { day } : {}), page: String(p) }).toString();
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin", label: "←" }} title={u("auditTitle")} />
      <form className="flex flex-wrap items-end gap-2 rounded-xl border bg-white p-3">
        <label className="text-xs text-navy/70">{u("auditQ")}<input name="q" defaultValue={q} placeholder="PAYROLL / 2026-11 / PVTH…" className={`${inputCls} mt-1 block w-56`} /></label>
        <label className="text-xs text-navy/70">{u("auditWho")}<input name="who" defaultValue={who} className={`${inputCls} mt-1 block w-40`} /></label>
        <label className="text-xs text-navy/70">{u("auditDay")}<input name="day" type="date" defaultValue={day} className={`${inputCls} mt-1 block`} /></label>
        <button className={btnGhost}>{u("auditShow")}</button>
      </form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[u("auditWhen"), u("auditWho"), u("auditAction"), u("auditTarget"), u("auditDetail")]}>
          {rows.slice(0, size).map((r) => <tr key={r.id}>
            <td className="whitespace-nowrap font-mono text-xs">{localIso(r.at)!.slice(0, 19).replace("T", " ")}</td>
            <td className="whitespace-nowrap text-xs"><span className="font-mono">{r.actor?.code}</span> {r.actor?.name}</td>
            <td className="whitespace-nowrap font-mono text-xs">{r.action}</td><td className="text-xs">{otLabel(r.target ?? "") ? <Link href={otLabel(r.target!)!.href} className="text-blue hover:underline">{otLabel(r.target!)!.text}</Link> : <span className="font-mono">{r.target}</span>}</td>
            <td className="max-w-[36rem] break-words text-xs text-navy/80">{say(r)}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={5} className="py-4 text-center text-navy/60">{u("auditNone")}</td></tr>}
        </Table>
      </div>
      <div className="flex gap-3 text-sm">{page > 1 && <Link href={`/admin/audit?${qs(page - 1)}`} className="text-blue hover:underline">←</Link>}<span className="text-navy/60">{page}</span>{rows.length > size && <Link href={`/admin/audit?${qs(page + 1)}`} className="text-blue hover:underline">→</Link>}</div>
    </div>
  );
}
