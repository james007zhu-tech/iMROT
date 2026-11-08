/**
 * ETH file — the editable sections shared by /people/new and /people/[code] (MD view):
 * basic info, contacts, work history rows, quick credential entry (filled by the upload box), payroll identifiers.
 * The whole file is one form, saved once (mockup v0.1, 2026-11-08). Input `name`s match RECOGNIZE.employee fields.
 */
import { getTranslations } from "next-intl/server";
import { CONTRACT_TYPES } from "@/server/opd";
import { RevealRows } from "@/components/RevealRows";
import { Card, Field, Grid, Tag, inputCls } from "@/components/ui";

const d = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "");
export const CAREER_ROWS = 8;
export const ALLOWANCE_ROWS = 4;
export const DEDUCTION_ROWS = 2;

export type EmployeeDraft = {
  name?: string; nameLocal?: string | null; nationality?: string | null; birthDate?: Date | null; gender?: string | null; position?: string | null;
  manager?: { code: string } | null; joinedAt?: Date | null; probationEndsAt?: Date | null; confirmedAt?: Date | null; contractType?: string | null; contractEndsAt?: Date | null;
  workLocation?: string | null; leftAt?: Date | null; leftReason?: string | null;
  phone?: string | null; phone2?: string | null; lineId?: string | null; wechatId?: string | null; personalEmail?: string | null; address?: string | null;
  emergencyName?: string | null; emergencyRelation?: string | null; emergencyPhone?: string | null;
  bankName?: string | null; bankAccount?: string | null; ssoNo?: string | null; taxNo?: string | null;
  careers?: { fromYm: string; toYm: string | null; company: string; title: string | null; summary: string | null; source: string }[];
};

export async function EmployeeFormFields({ e, managers, show, contactsOpen = true, selfOnly = false }: {
  e?: EmployeeDraft | null;
  managers: { code: string; name: string }[];
  /** mask function for contact values when not revealed */
  show: (v: string | null | undefined, kind: "phone" | "email" | "login" | "name" | "text") => string;
  contactsOpen?: boolean;
  /** the person editing their own contacts: only the contact section is rendered, as inputs */
  selfOnly?: boolean;
}) {
  const [t, c] = await Promise.all([getTranslations("ui"), getTranslations("common")]);
  const careers = [...(e?.careers ?? [])];
  const contactInput = (name: keyof EmployeeDraft, kind: "phone" | "email" | "login" | "text", type = "text") =>
    contactsOpen ? <input name={name} type={type} defaultValue={(e?.[name] as string | null | undefined) ?? ""} className={inputCls} /> : <div className={`${inputCls} bg-tint text-navy/70`}>{show(e?.[name] as string | null | undefined, kind) || "—"}</div>;

  const contacts = (
    <Card title={<>{t("empContacts")} <Tag>{contactsOpen ? t("revealed") : `🔒 ${t("masked")}`}</Tag></>}>
      <Grid>
        <Field label={t("empPhoneTh")}>{contactInput("phone", "phone")}</Field>
        <Field label={t("empPhoneHome")}>{contactInput("phone2", "phone")}</Field>
        <Field label="LINE ID">{contactInput("lineId", "login")}</Field>
        <Field label={t("empWechat")}>{contactInput("wechatId", "login")}</Field>
        <Field label={t("empPersonalEmail")}>{contactInput("personalEmail", "email", "email")}</Field>
        <Field label={t("empAddress")} className="md:col-span-3">{contactInput("address", "text")}</Field>
        <Field label={t("empEmergencyName")}>{contactInput("emergencyName", "text")}</Field>
        <Field label={t("empEmergencyRelation")}>{contactInput("emergencyRelation", "text")}</Field>
        <Field label={t("empEmergencyPhone")}>{contactInput("emergencyPhone", "phone")}</Field>
      </Grid>
    </Card>
  );
  if (selfOnly) return contacts;

  return (
    <>
      <Card title={t("empBasic")}>
        <Grid>
          <Field label={t("empNameEn")} required><input name="name" required defaultValue={e?.name ?? ""} className={inputCls} /></Field>
          <Field label={t("empNameLocal")}><input name="nameLocal" defaultValue={e?.nameLocal ?? ""} className={inputCls} /></Field>
          <Field label={t("empNationality")}><input name="nationality" defaultValue={e?.nationality ?? ""} className={inputCls} /></Field>
          <Field label={t("empBirthDate")}><input name="birthDate" type="date" defaultValue={d(e?.birthDate)} className={inputCls} /></Field>
          <Field label={t("empGender")}><select name="gender" defaultValue={e?.gender ?? ""} className={inputCls}><option value="">—</option><option value="M">{t("genderM")}</option><option value="F">{t("genderF")}</option><option value="other">{t("genderOther")}</option></select></Field>
          <Field label={t("empPosition")}><input name="position" defaultValue={e?.position ?? ""} className={inputCls} /></Field>
          <Field label={t("empManager")}><select name="managerCode" defaultValue={e?.manager?.code ?? ""} className={inputCls}><option value="">—</option>{managers.map((m) => <option key={m.code} value={m.code}>{m.code} · {m.name}</option>)}</select></Field>
          <Field label={t("joinedAt")}><input name="joinedAt" type="date" defaultValue={d(e?.joinedAt)} className={inputCls} /></Field>
          <Field label={t("empProbationEnds")}><input name="probationEndsAt" type="date" defaultValue={d(e?.probationEndsAt)} className={inputCls} /></Field>
          <Field label={t("empConfirmedAt")}><input name="confirmedAt" type="date" defaultValue={d(e?.confirmedAt)} className={inputCls} /></Field>
          <Field label={t("empContractType")}><select name="contractType" defaultValue={e?.contractType ?? ""} className={inputCls}><option value="">—</option>{CONTRACT_TYPES.map((x) => <option key={x} value={x}>{t(`contract_${x}`)}</option>)}</select></Field>
          <Field label={t("empContractEnds")}><input name="contractEndsAt" type="date" defaultValue={d(e?.contractEndsAt)} className={inputCls} /></Field>
          <Field label={t("empWorkLocation")}><input name="workLocation" defaultValue={e?.workLocation ?? ""} className={inputCls} /></Field>
          <Field label={t("empLeftAt")}><input name="leftAt" type="date" defaultValue={d(e?.leftAt)} className={inputCls} /></Field>
          <Field label={t("empLeftReason")} className="md:col-span-2"><input name="leftReason" defaultValue={e?.leftReason ?? ""} className={inputCls} /></Field>
        </Grid>
      </Card>

      {contacts}

      <Card title={t("empCareer")}>
        <RevealRows initial={Math.max(1, careers.length)} addLabel={t("empAddCareer")}>
          {Array.from({ length: CAREER_ROWS }, (_, i) => {
            const r = careers[i];
            return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-12">
                <input name={`cf${i}`} placeholder="YYYY-MM" pattern="\d{4}-\d{2}" defaultValue={r?.fromYm ?? ""} className={`${inputCls} md:col-span-1`} />
                <input name={`ct${i}`} placeholder={`YYYY-MM · ${t("empCurrent")}`} pattern="\d{4}-\d{2}" defaultValue={r?.toYm ?? ""} className={`${inputCls} md:col-span-1`} />
                <input name={`cc${i}`} placeholder={t("empCompany")} defaultValue={r?.company ?? ""} className={`${inputCls} md:col-span-3`} />
                <input name={`cj${i}`} placeholder={t("empJobTitle")} defaultValue={r?.title ?? ""} className={`${inputCls} md:col-span-2`} />
                <input name={`cs${i}`} placeholder={t("empSummary")} defaultValue={r?.summary ?? ""} className={`${inputCls} md:col-span-5`} />
                <input type="hidden" name={`co${i}`} defaultValue={r?.source ?? ""} />
              </div>
            );
          })}
        </RevealRows>
      </Card>

      <Card title={<>{t("empQuickCredentials")} <span className="text-xs font-normal text-navy/60">{t("empQuickCredentialsHint")}</span></>}>
        <Grid cols={4}>
          <Field label={t("cred_PASSPORT")}><input name="passportNo" className={inputCls} /></Field>
          <Field label={t("empExpires")}><input name="passportExpiresAt" type="date" className={inputCls} /></Field>
          <Field label={t("cred_ID_CARD")}><input name="idCardNo" className={inputCls} /></Field>
          <Field label={t("cred_VISA")} ><input name="visaExpiresAt" type="date" className={inputCls} /></Field>
          <Field label={t("cred_WORK_PERMIT")}><input name="workPermitNo" className={inputCls} /></Field>
          <Field label={t("empExpires")}><input name="workPermitExpiresAt" type="date" className={inputCls} /></Field>
          <Field label={t("cred_DEGREE")} className="md:col-span-2"><input name="education" className={inputCls} /></Field>
        </Grid>
      </Card>

      <Card title={<>{t("empPayrollIds")} <Tag>{t("mdOnly")}</Tag></>}>
        <Grid cols={4}>
          <Field label={t("empBankName")}><input name="bankName" defaultValue={e?.bankName ?? ""} className={inputCls} /></Field>
          <Field label={t("empBankAccount")}><input name="bankAccount" defaultValue={e?.bankAccount ?? ""} className={inputCls} /></Field>
          <Field label={t("empSsoNo")}><input name="ssoNo" defaultValue={e?.ssoNo ?? ""} className={inputCls} /></Field>
          <Field label={t("empTaxNo")}><input name="taxNo" defaultValue={e?.taxNo ?? ""} className={inputCls} /></Field>
        </Grid>
      </Card>
      <input type="hidden" name="_careerRows" value={CAREER_ROWS} />
      <span className="hidden">{c("save")}</span>
    </>
  );
}

/** Shared by both pages: read the form into the service inputs. */
export function readEmployeeForm(f: FormData) {
  const s = (k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
  const careers = Array.from({ length: CAREER_ROWS }, (_, i) => ({ fromYm: s(`cf${i}`), toYm: s(`ct${i}`), company: s(`cc${i}`), title: s(`cj${i}`), summary: s(`cs${i}`), source: (s(`co${i}`) as "AI" | "MANUAL" | undefined) ?? "MANUAL" }))
    .filter((r) => r.company && r.fromYm) as { fromYm: string; toYm?: string; company: string; title?: string; summary?: string; source: "AI" | "MANUAL" }[];
  const quick = [
    { kind: "PASSPORT" as const, number: s("passportNo"), expiresAt: s("passportExpiresAt") },
    { kind: "ID_CARD" as const, number: s("idCardNo"), expiresAt: undefined },
    { kind: "VISA" as const, number: undefined, expiresAt: s("visaExpiresAt") },
    { kind: "WORK_PERMIT" as const, number: s("workPermitNo"), expiresAt: s("workPermitExpiresAt") },
    { kind: "DEGREE" as const, number: undefined, expiresAt: undefined, title: s("education") },
  ].filter((q) => q.number || q.expiresAt || ("title" in q && q.title));
  const profile = {
    name: s("name"), nameLocal: s("nameLocal"), nationality: s("nationality"), birthDate: s("birthDate"), gender: s("gender"), position: s("position"), managerCode: String(f.get("managerCode") ?? ""),
    joinedAt: s("joinedAt"), probationEndsAt: s("probationEndsAt"), confirmedAt: s("confirmedAt"), contractType: s("contractType") as "PROBATION" | undefined, contractEndsAt: s("contractEndsAt"), workLocation: s("workLocation"), leftAt: s("leftAt"), leftReason: s("leftReason"),
    bankName: s("bankName"), bankAccount: s("bankAccount"), ssoNo: s("ssoNo"), taxNo: s("taxNo"),
    ...readContacts(f),
  };
  return { profile, careers, quick, attachments: JSON.parse(String(f.get("attachments") || "[]")) as { name: string; url: string; kind?: string }[] };
}

export function readContacts(f: FormData) {
  const s = (k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
  return { phone: s("phone"), phone2: s("phone2"), lineId: s("lineId"), wechatId: s("wechatId"), personalEmail: s("personalEmail"), address: s("address"), emergencyName: s("emergencyName"), emergencyRelation: s("emergencyRelation"), emergencyPhone: s("emergencyPhone") };
}
