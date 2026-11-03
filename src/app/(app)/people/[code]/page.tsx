import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { STAFF_ROLES, updateEmployee } from "@/server/opd";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { Forbidden } from "@/components/Forbidden";
import { Card, Field, Grid, PageHeader, Value, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EditEmployee({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ code }, { ok, error }] = await Promise.all([params, searchParams]);
  const me = await currentEmployee();
  if (me.role !== "MD") return <Forbidden />;
  const e = await prisma.employee.findUnique({ where: { code }, include: { entity: true } });
  if (!e) notFound();
  const [t, c, r] = await Promise.all([getTranslations("ui"), getTranslations("common"), getTranslations("role")]);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await updateEmployee({ actorCode: me.code, code, role: f.get("role") as "ENGINEER", active: f.get("active") === "on", phone: String(f.get("phone") || "") || undefined, locale: String(f.get("locale")), password: String(f.get("password") || "") || undefined });
      return code;
    }, `/people/${code}`);
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people", label: t("backToEmployees") }} title={<span className="font-mono">{e.code}</span>} actions={<button form="f" className={btnPrimary}>{c("save")}</button>} />
      <Flash ok={ok} error={error} />
      <form id="f" action={save}>
        <Card title={e.name}>
          <Grid>
            <Field label={t("legalEntity")}><Value>{e.entity.code}</Value></Field>
            <Field label={c("email")}><Value>{e.email ?? "—"}</Value></Field>
            <Field label={c("role")}><select name="role" defaultValue={e.role} className={inputCls}>{[...new Set([...STAFF_ROLES, e.role])].map((x) => <option key={x} value={x}>{r(x)}</option>)}</select></Field>
            <Field label={c("phone")}><input name="phone" defaultValue={e.phone ?? ""} className={inputCls} /></Field>
            <Field label={t("uiLanguage")}><select name="locale" defaultValue={e.locale} className={inputCls}><option value="th">ไทย</option><option value="zh">中文</option><option value="en">English</option></select></Field>
            <Field label={c("newPassword")}><input name="password" type="password" minLength={6} className={inputCls} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={e.active} /> {c("active")}</label>
          </Grid>
        </Card>
      </form>
    </div>
  );
}
