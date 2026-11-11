import { Fragment } from "react";
import { notFound } from "next/navigation";
import type { EmployeeRole } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { NAV } from "@/lib/nav";
import { ALWAYS_ON, MD_ONLY, ROLES, setRole, setRoleMenu } from "@/server/perm";
import { Flash } from "@/components/Flash";
import { Card, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const BACK = "/admin/permissions";

/**
 * 权限管理 (MD only): who has which role, and which menu entries each role may open. The rules inside pages
 * (who approves, who sees salaries) are fixed and listed at the bottom so nothing about access is hidden.
 */
export default async function Permissions({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, n, r, me] = await Promise.all([getTranslations("ops"), getTranslations("nav"), getTranslations("role"), currentEmployee()]);
  if (me.role !== "MD") notFound();
  const [staff, hidden] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { code: true, name: true, role: true, position: true } }),
    prisma.roleMenu.findMany(),
  ]);
  const off = new Set(hidden.map((h) => `${h.role}|${h.key}`));
  const roles = ROLES.filter((x) => x !== "MD");

  async function saveMenu(f: FormData) {
    "use server";
    await guarded(async () => { const actor = await currentEmployee(); for (const role of ROLES.filter((x) => x !== "MD")) await setRoleMenu(actor.code, role, f.getAll(`m_${role}`).map(String)); }, BACK);
  }
  async function saveRole(code: string, f: FormData) {
    "use server";
    await guarded(async () => { const actor = await currentEmployee(); await setRole(actor.code, code, String(f.get("role")) as EmployeeRole); return code; }, BACK);
  }
  return (
    <div className="space-y-4">
      <PageHeader title={n("permissions")} />
      <Flash ok={ok} error={error} />
      <Card title={t("permRoles")}>
        <ul className="grid gap-2 md:grid-cols-2">
          {staff.map((s) => <li key={s.code}><form action={saveRole.bind(null, s.code)} className="flex flex-wrap items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm">
            <span className="min-w-0 flex-1"><span className="font-semibold text-navy">{s.name}</span> <span className="font-mono text-xs text-navy/60">{s.code}</span>{s.position ? <span className="block text-xs text-navy/60">{s.position}</span> : null}</span>
            <select name="role" defaultValue={s.role} aria-label={`${t("permRole")} ${s.name}`} className={`${inputCls} w-40`}>{ROLES.map((x) => <option key={x} value={x}>{r(x)}</option>)}</select>
            <button className={btnGhost}>{t("save")}</button>
          </form></li>)}
        </ul>
      </Card>
      <Card title={t("permMenu")}>
        <p className="mb-2 text-xs text-navy/70">{t("permMenuHint")}</p>
        <form action={saveMenu} className="space-y-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0 text-sm">
              <thead><tr><th className="sticky left-0 bg-white py-1 text-left font-semibold text-navy">{t("permEntry")}</th>{roles.map((x) => <th key={x} className="px-2 py-1 text-center text-xs font-semibold text-navy">{r(x)}</th>)}</tr></thead>
              <tbody>
                {NAV.map((g) => g.items.length === 0 ? null : <Fragment key={g.key}>
                  <tr><td colSpan={roles.length + 1} className="border-t bg-tint px-2 py-1 text-xs font-semibold text-navy">{n(g.key)}</td></tr>
                  {g.items.map((i) => (
                    <tr key={i.key}>
                      <td className="sticky left-0 bg-white py-1 pl-2">{n(i.key)}</td>
                      {roles.map((x) => <td key={x} className="px-2 py-1 text-center">
                        {MD_ONLY.has(i.key) ? <span className="text-navy/30" title={t("permMdOnly")}>—</span>
                          : ALWAYS_ON.has(i.key) ? <span className="text-navy/50" title={t("permAlways")}>✓</span>
                          : <input type="checkbox" name={`m_${x}`} value={i.key} defaultChecked={!off.has(`${x}|${i.key}`)} aria-label={`${r(x)} · ${n(i.key)}`} className="h-4 w-4" />}
                      </td>)}
                    </tr>
                  ))}
                </Fragment>)}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end"><button className={btnPrimary}>{t("permSave")}</button></div>
        </form>
      </Card>
      <Card title={t("permFixed")}>
        <ul className="list-disc space-y-1 pl-5 text-sm text-navy">{Array.from({ length: 9 }, (_, i) => <li key={i}>{t(`permRule${i + 1}`)}</li>)}</ul>
      </Card>
    </div>
  );
}
