import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { createEmployee, STAFF_ROLES } from "@/server/opd";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { Forbidden } from "@/components/Forbidden";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function NewEmployee({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const me = await currentEmployee();
  if (me.role !== "MD") return <Forbidden />;
  const [t, c, r] = await Promise.all([getTranslations("ui"), getTranslations("common"), getTranslations("role")]);
  const entities = await prisma.legalEntity.findMany({ orderBy: { countryCode: "asc" } });
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const e = await createEmployee({ actorCode: me.code, entityCode: String(f.get("entityCode")), name: String(f.get("name")), nameLocal: s(f, "nameLocal"), role: f.get("role") as "ENGINEER", email: String(f.get("email")), phone: s(f, "phone"), locale: f.get("locale") as "th", password: String(f.get("password")), joinedAt: s(f, "joinedAt") ? new Date(String(f.get("joinedAt"))) : undefined });
      return { ok: e.code, to: "/people" };
    }, "/people/new");
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people", label: t("backToEmployees") }} title={t("newEmployee")}
        actions={<><Link href="/people" className={btnGhost}>{c("cancel")}</Link><button form="f" className={btnPrimary}>{c("save")}</button></>} />
      <Flash error={error} />
      <UploadRecognize kind="employee" formId="f" title={t("upEmployeeTitle")} hint={t("upEmployeeHint")} />
      <form id="f" action={save}>
        <Card title={t("employee")}>
          <Grid>
            <Field label={c("name")} required><input name="name" required className={inputCls} /></Field>
            <Field label={t("nameLocal")}><input name="nameLocal" className={inputCls} /></Field>
            <Field label={c("role")} required><select name="role" className={inputCls} defaultValue="ENGINEER">{STAFF_ROLES.map((x) => <option key={x} value={x}>{r(x)}</option>)}</select></Field>
            <Field label={t("legalEntity")} required><select name="entityCode" className={inputCls} defaultValue={entities[0]?.code}>{entities.map((e) => <option key={e.id} value={e.code}>{e.code} · {e.countryCode} · {e.localCurrency}</option>)}</select></Field>
            <Field label={t("emailLogin")} required><input name="email" type="email" required className={inputCls} /></Field>
            <Field label={c("phone")}><input name="phone" className={inputCls} /></Field>
            <Field label={t("initialPassword")} required><input name="password" type="password" minLength={6} required className={inputCls} /></Field>
            <Field label={t("uiLanguage")}><select name="locale" className={inputCls} defaultValue="th"><option value="th">ไทย</option><option value="zh">中文</option><option value="en">English</option></select></Field>
            <Field label={t("joinedAt")}><input name="joinedAt" type="date" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </div>
  );
}
const s = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
