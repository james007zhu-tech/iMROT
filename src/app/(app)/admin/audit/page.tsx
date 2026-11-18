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
            <td className="whitespace-nowrap font-mono text-xs">{r.action}</td><td className="font-mono text-xs">{r.target}</td>
            <td className="max-w-[36rem] break-all text-xs text-navy/80">{r.detail ? JSON.stringify(r.detail) : ""}</td>
          </tr>)}
          {!rows.length && <tr><td colSpan={5} className="py-4 text-center text-navy/60">{u("auditNone")}</td></tr>}
        </Table>
      </div>
      <div className="flex gap-3 text-sm">{page > 1 && <Link href={`/admin/audit?${qs(page - 1)}`} className="text-blue hover:underline">←</Link>}<span className="text-navy/60">{page}</span>{rows.length > size && <Link href={`/admin/audit?${qs(page + 1)}`} className="text-blue hover:underline">→</Link>}</div>
    </div>
  );
}
