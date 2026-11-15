import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { currentEmployee, renewSession } from "@/server/auth";
import { changeOwnPassword, updateOwnContacts } from "@/server/opd";
import { guarded } from "@/lib/action-result";
import { PasswordInput } from "@/components/PasswordInput";
import { Flash } from "@/components/Flash";
import { readContacts } from "@/components/EmployeeFormFields";
import { PageHeader, Card, Grid, Field, Value, inputCls, btnPrimary, btnGhost } from "@/components/ui";

/**
 * 我的 (朱总 2026-11-15): what a person may do to their own account — change the password, keep their own contact
 * details current. What HR keeps (name, role, post, manager, pay, credentials) is shown, never editable here.
 */
export default async function Me({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [u, c] = await Promise.all([getTranslations("ui"), getTranslations("common")]);
  const me = await currentEmployee();
  const e = await prisma.employee.findUniqueOrThrow({ where: { id: me.id }, include: { entity: true, manager: { select: { name: true, code: true } } } });

  async function contacts(f: FormData) {
    "use server";
    await guarded(async () => { const who = await currentEmployee(); await updateOwnContacts(who.code, readContacts(f)); return "saved"; }, "/me");
  }
  async function password(f: FormData) {
    "use server";
    await guarded(async () => {
      const who = await currentEmployee();
      await changeOwnPassword(who.code, String(f.get("current") ?? ""), String(f.get("next") ?? ""), String(f.get("again") ?? ""));
      await renewSession(who.code); // this device stays signed in; every other one is signed out
      return "passwordChanged";
    }, "/me");
  }
  const own = (name: keyof typeof e & string, type = "text", mode?: "tel" | "email") => <input name={name} type={type} inputMode={mode} defaultValue={(e[name] as string | null) ?? ""} className={inputCls} />;
  return (
    <div className="space-y-4">
      <PageHeader title={u("meTitle")} badge={<span className="font-mono text-sm text-navy/60">{e.code}</span>} />
      <Flash ok={ok === "passwordChanged" ? u("mePasswordChanged") : ok} error={error} />
      <Card title={u("meFile")}>
        <Grid>
          <Field label={u("personName")}><Value>{e.name}{e.nameLocal ? ` · ${e.nameLocal}` : ""}</Value></Field>
          <Field label={u("meLogin")}><Value>{e.email ?? "—"}</Value></Field>
          <Field label={c("role")}><Value>{e.role}{e.position ? ` · ${e.position}` : ""}</Value></Field>
          <Field label={c("entity")}><Value>{e.entity.code}</Value></Field>
          <Field label={u("meManager")}><Value>{e.manager ? `${e.manager.name} · ${e.manager.code}` : "—"}</Value></Field>
          <Field label={u("meJoined")}><Value>{localIso(e.joinedAt)?.slice(0, 10) ?? "—"}</Value></Field>
        </Grid>
        <p className="mt-3 text-xs text-navy/60">{u("meHrNote")} <Link href={`/people/${e.code}`} className="text-blue">{u("meOpenFile")}</Link></p>
      </Card>
      <Card title={u("meContacts")}>
        <form action={contacts}>
          <Grid>
            <Field label={u("empPhoneTh")}>{own("phone", "text", "tel")}</Field>
            <Field label={u("empPhoneHome")}>{own("phone2", "text", "tel")}</Field>
            <Field label="LINE ID">{own("lineId")}</Field>
            <Field label={u("empWechat")}>{own("wechatId")}</Field>
            <Field label={u("empPersonalEmail")}>{own("personalEmail", "email", "email")}</Field>
            <Field label={u("empAddress")}>{own("address")}</Field>
            <Field label={u("empEmergencyName")}>{own("emergencyName")}</Field>
            <Field label={u("empEmergencyRelation")}>{own("emergencyRelation")}</Field>
            <Field label={u("empEmergencyPhone")}>{own("emergencyPhone", "text", "tel")}</Field>
          </Grid>
          <div className="mt-3"><button className={btnPrimary}>{c("save")}</button></div>
        </form>
      </Card>
      <Card title={u("mePassword")}>
        <form action={password} className="max-w-md space-y-3">
          <Field label={u("mePasswordNow")} required><PasswordInput label={{ show: c("pwShow"), hide: c("pwHide") }} name="current" autoComplete="current-password" required className={inputCls} /></Field>
          <Field label={u("mePasswordNew")} required><PasswordInput label={{ show: c("pwShow"), hide: c("pwHide") }} name="next" autoComplete="new-password" minLength={8} required className={inputCls} /></Field>
          <Field label={u("mePasswordAgain")} required><PasswordInput label={{ show: c("pwShow"), hide: c("pwHide") }} name="again" autoComplete="new-password" minLength={8} required className={inputCls} /></Field>
          <button className={btnGhost}>{u("mePasswordSave")}</button>
        </form>
      </Card>
    </div>
  );
}
