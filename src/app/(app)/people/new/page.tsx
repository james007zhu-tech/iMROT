import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { STAFF_ROLES, addQuickCredentials, createEmployee, setCareers } from "@/server/opd";
import { guarded } from "@/lib/action-result";
import { entityLabel } from "@/lib/entity";
import { Flash } from "@/components/Flash";
import { Forbidden } from "@/components/Forbidden";
import { FormMemory } from "@/components/FormMemory";
import { UploadRecognize } from "@/components/UploadRecognize";
import { EmployeeFormFields, readEmployeeForm } from "@/components/EmployeeFormFields";
import { Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const plain = (v: string | null | undefined) => v ?? "";

/** New ETH: the upload box reads a CV / passport / work permit into the form; one save creates the file. */
export default async function NewEmployee({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const me = await currentEmployee();
  if (me.role !== "MD") return <Forbidden />;
  const [t, c, r] = await Promise.all([getTranslations("ui"), getTranslations("common"), getTranslations("role")]);
  const [entities, managers] = await Promise.all([prisma.legalEntity.findMany({ orderBy: { createdAt: "asc" } }), prisma.employee.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { code: true, name: true } })]);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const { profile, careers, quick, attachments } = readEmployeeForm(f);
      const e = await createEmployee({ ...profile, actorCode: me.code, entityCode: String(f.get("entityCode")), name: profile.name ?? "", role: f.get("role") as "ENGINEER", email: String(f.get("email")), locale: f.get("locale") as "th", password: String(f.get("password")), attachments });
      if (careers.length) await setCareers(me.code, e.code, careers);
      await addQuickCredentials(me.code, e.code, quick);
      return { ok: e.code, to: `/people/${e.code}` };
    }, "/people/new");
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people", label: t("backToEmployees") }} title={t("newEmployee")}
        actions={<><Link href="/people" className={btnGhost}>{c("cancel")}</Link><button form="f" className={btnPrimary}>{c("save")}</button></>} />
      <Flash error={error} />
      <FormMemory formId="f" />
      <UploadRecognize kind="employee" formId="f" title={t("upEmployeeTitle")} hint={t("upEmployeeHint")} lineFields={{ fromYm: "cf", toYm: "ct", company: "cc", title: "cj", summary: "cs" }} />
      <form id="f" action={save} className="space-y-4">
        <Card title={t("empAccount")} accent>
          <Grid>
            <Field label={t("legalEntity")} required><select name="entityCode" className={inputCls} defaultValue={entities.find((e) => e.id === me.entityId)?.code ?? entities[0]?.code}>{entities.map((e) => <option key={e.id} value={e.code}>{entityLabel(e, t)}</option>)}</select></Field>
            <Field label={c("role")} required><select name="role" className={inputCls} defaultValue="ENGINEER">{STAFF_ROLES.map((x) => <option key={x} value={x}>{r(x)}</option>)}</select></Field>
            <Field label={t("uiLanguage")}><select name="locale" className={inputCls} defaultValue="th"><option value="th">ไทย</option><option value="zh">中文</option><option value="en">English</option></select></Field>
            <Field label={t("emailLogin")} required><input name="email" type="email" required className={inputCls} /></Field>
            <Field label={t("initialPassword")} required><input name="password" type="password" minLength={6} required className={inputCls} /></Field>
          </Grid>
        </Card>
        <EmployeeFormFields managers={managers} show={plain} contactsOpen />
      </form>
    </div>
  );
}
