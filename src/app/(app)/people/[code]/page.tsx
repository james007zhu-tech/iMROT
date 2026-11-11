import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee, revealActive } from "@/server/auth";
import { CREDENTIAL_KINDS, REVIEW_KINDS, STAFF_ROLES, credentialAlerts, getEmployeeFile, mayViewEmployee, probationDue, salaryHistory } from "@/server/opd";
import { guarded } from "@/lib/action-result";
import { maskEmail, maskLogin, maskName, maskPhone } from "@/lib/mask";
import { maskAmount, statutoryFor } from "@/lib/payroll";
import { Flash } from "@/components/Flash";
import { Forbidden } from "@/components/Forbidden";
import { FormMemory } from "@/components/FormMemory";
import { UploadRecognize } from "@/components/UploadRecognize";
import { RevealRows } from "@/components/RevealRows";
import { ALLOWANCE_ROWS, DEDUCTION_ROWS, EmployeeFormFields } from "@/components/EmployeeFormFields";
import { overtimeLinesOf } from "@/server/overtime";
import { credential, dropCredential, letter, reveal, review, salary, save, saveOwn } from "./actions";
import { salaryChange, type LetterDetails } from "@/lib/salary-letter";
import { Alert, Card, Field, Grid, PageHeader, Table, Tag, Value, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "—");
const fmt = (v: unknown, open: boolean, cur = "") => v === null || v === undefined ? "—" : open ? `${cur ? `${cur} ` : ""}${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : maskAmount(Number(v));
const pct = (v: unknown) => (v === null || v === undefined ? "—" : `${(Number(v) * 100).toFixed(2).replace(/\.?0+$/, "")} %`);

/** ETH file: the MD edits everything; the person sees their own file (no salary) and edits their contacts. */
export default async function EmployeeFile({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ code }, { ok, error }] = await Promise.all([params, searchParams]);
  const me = await currentEmployee();
  if (!mayViewEmployee(me, code)) return <Forbidden />;
  const md = me.role === "MD";
  const self = me.code === code;
  const e = await getEmployeeFile(me, code);
  if (!e) notFound();
  const [t, c, r] = await Promise.all([getTranslations("ui"), getTranslations("common"), getTranslations("role")]);
  const managers = md ? await prisma.employee.findMany({ where: { active: true, NOT: { code } }, orderBy: { code: "asc" }, select: { code: true, name: true } }) : [];
  const open = self || (await revealActive(code));
  const show = (v: string | null | undefined, kind: "phone" | "email" | "login" | "name" | "text") => (open ? v ?? "" : kind === "phone" ? maskPhone(v) : kind === "email" ? maskEmail(v) : kind === "login" ? maskLogin(v) : kind === "name" ? maskName(v) : v ? "••••" : "");
  const now = new Date();
  const alerts = credentialAlerts(e.credentials, now);
  const due = probationDue(e, e.reviews, now);
  const stat = statutoryFor(e.entity.countryCode);
  const salaries = await salaryHistory(me, e.id);
  const otLines = md ? await overtimeLinesOf(e.id) : [];

  const status = e.leftAt || !e.active ? <Tag hot>{t("empLeft")}</Tag> : e.probationEndsAt && !e.confirmedAt && e.probationEndsAt > now ? <Tag>{t("empProbation")}</Tag> : <Tag>{t("empActive")}</Tag>;
  const tabs = [["basic", t("empBasic")], ["contacts", t("empContacts")], ["career", t("empCareerAndCredentials")], ...(md ? [["salary", t("empSalary")]] : []), ["reviews", t("empReviews")], ["account", t("empAccount")], ["files", t("attachments")]] as const;
  const revealForm = !open && <form action={reveal.bind(null, code)} className="flex items-center gap-2"><input name="password" type="password" required placeholder={t("reenterPassword")} className={`${inputCls} w-48`} /><button className={btnGhost}>{t("showFull")}</button></form>;

  return (
    <div className="space-y-4">
      <PageHeader back={md ? { href: "/people", label: t("backToEmployees") } : undefined} title={<><span className="font-mono">{e.code}</span> <span className="font-normal">· {e.name}{e.nameLocal ? ` ${e.nameLocal}` : ""}</span></>}
        badge={<><Tag>{r(e.role)}</Tag><Tag>{e.entity.code}</Tag>{status}</>}
        actions={<>{(self || md) && <Link href="/people/overtime" className={btnGhost}>{t("overtime")}</Link>}{revealForm}{md ? <button form="f" className={btnPrimary}>{c("save")}</button> : <button form="own" className={btnPrimary}>{t("empSaveContacts")}</button>}</>} />
      <Flash ok={ok === "revealed" ? t("revealedFor5") : ok === "saved" ? c("saved") : ok} error={error} />
      {(alerts.length > 0 || due) && (
        <Alert>
          {alerts.map((a) => <span key={a.id} className="mr-3">{t(`cred_${a.kind}`)}{a.number ? ` ${show(a.number, "login")}` : ""} {a.days! < 0 ? t("empExpired") : t("empExpiresInDays", { n: a.days! })} ({day(a.expiresAt)})</span>)}
          {due && <span>{t("empProbationReviewDue")} {day(e.probationEndsAt)}</span>}
        </Alert>
      )}
      <nav className="flex flex-wrap gap-1 border-b border-line text-sm">{tabs.map(([id, label]) => <a key={id} href={`#${id}`} className="px-3 py-2 text-navy/70 hover:text-navy">{label}</a>)}</nav>

      {md ? (
        <>
          <FormMemory formId="f" />
          <UploadRecognize kind="employee" formId="f" title={t("upEmployeeTitle")} hint={t("upEmployeeHint")} initial={[]} lineFields={{ fromYm: "cf", toYm: "ct", company: "cc", title: "cj", summary: "cs" }} />
          <form id="f" action={save.bind(null, code)} className="space-y-4">
            <div id="basic" />
            <EmployeeFormFields e={e} managers={managers} show={show} contactsOpen={open} />
            <div id="account" />
            <Card title={t("empAccount")}>
              <Grid cols={4}>
                <Field label={t("emailLogin")}><Value>{show(e.email, "email") || "—"}</Value></Field>
                <Field label={c("role")}><select name="role" defaultValue={e.role} className={inputCls}>{[...new Set([...STAFF_ROLES, e.role])].map((x) => <option key={x} value={x}>{r(x)}</option>)}</select></Field>
                <Field label={t("uiLanguage")}><select name="locale" defaultValue={e.locale} className={inputCls}><option value="th">ไทย</option><option value="zh">中文</option><option value="en">English</option></select></Field>
                <Field label={c("newPassword")}><input name="password" type="password" minLength={6} className={inputCls} /></Field>
                <Field label={t("empLastLogin")}><Value>{e.lastLoginAt ? e.lastLoginAt.toISOString().replace("T", " ").slice(0, 16) : "—"}</Value></Field>
                <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={e.active} /> {c("active")}</label>
              </Grid>
            </Card>
          </form>
        </>
      ) : (
        <>
          <div id="basic" />
          <Card title={t("empBasic")}>
            <Grid>
              <Field label={t("empPosition")}><Value>{e.position ?? "—"}</Value></Field>
              <Field label={t("empManager")}><Value>{e.manager ? `${e.manager.code} · ${e.manager.name}` : "—"}</Value></Field>
              <Field label={t("joinedAt")}><Value>{day(e.joinedAt)}</Value></Field>
              <Field label={t("empContractType")}><Value>{e.contractType ? t(`contract_${e.contractType}`) : "—"}</Value></Field>
              <Field label={t("empContractEnds")}><Value>{day(e.contractEndsAt)}</Value></Field>
              <Field label={t("empWorkLocation")}><Value>{e.workLocation ?? "—"}</Value></Field>
            </Grid>
          </Card>
          <div id="contacts" />
          <form id="own" action={saveOwn.bind(null, code)}><EmployeeFormFields e={e} managers={[]} show={show} contactsOpen selfOnly /></form>
          <p className="text-xs text-navy/60">{t("empSelfNote")}</p>
        </>
      )}

      <div id="career" />
      {!md && e.careers.length > 0 && (
        <Card title={t("empCareer")}>
          <Table head={[t("empPeriod"), t("empCompany"), t("empJobTitle"), t("empSummary")]}>
            {e.careers.map((k) => <tr key={k.id}><td className="whitespace-nowrap">{k.fromYm} → {k.toYm ?? t("empCurrent")}</td><td>{k.company}</td><td>{k.title ?? ""}</td><td>{k.summary ?? ""}</td></tr>)}
          </Table>
        </Card>
      )}
      <div id="credentials" />
      <Card title={t("empCredentials")}>
        <Table head={[c("type"), c("title"), t("empNumber"), t("empIssued"), t("empExpires"), t("empReminder"), c("note"), ""]}>
          {e.credentials.map((k) => {
            const a = alerts.find((x) => x.id === k.id);
            return (
              <tr key={k.id}>
                <td>{t(`cred_${k.kind}`)}</td><td>{k.title ?? ""}</td><td className="font-mono">{k.number ? show(k.number, "login") : ""}</td><td>{day(k.issuedAt)}</td>
                <td>{a ? <Tag hot>{day(k.expiresAt)} · {a.days! < 0 ? t("empExpired") : t("empExpiresInDays", { n: a.days! })}</Tag> : day(k.expiresAt)}</td>
                <td>{k.expiresAt ? t("empDaysBefore", { n: k.remindDays }) : "—"}</td><td>{k.note ?? ""}</td>
                <td>{md && <form action={dropCredential.bind(null, code)}><input type="hidden" name="id" value={k.id} /><button className="text-xs text-alert-ink hover:underline">{c("remove")}</button></form>}</td>
              </tr>
            );
          })}
          {!e.credentials.length && <tr><td colSpan={8} className="text-navy/60">—</td></tr>}
        </Table>
        {md && (
          <form action={credential.bind(null, code)} className="grid grid-cols-2 gap-2 md:grid-cols-8">
            <select name="kind" className={inputCls} defaultValue="WORK_PERMIT">{CREDENTIAL_KINDS.map((k) => <option key={k} value={k}>{t(`cred_${k}`)}</option>)}</select>
            <input name="title" placeholder={c("title")} className={inputCls} />
            <input name="number" placeholder={t("empNumber")} className={inputCls} />
            <input name="issuedAt" type="date" title={t("empIssued")} className={inputCls} />
            <input name="expiresAt" type="date" title={t("empExpires")} className={inputCls} />
            <input name="remindDays" type="number" min={0} max={365} defaultValue={90} title={t("empReminder")} className={inputCls} />
            <input name="note" placeholder={c("note")} className={inputCls} />
            <button className={btnGhost}>＋ {t("empAddCredential")}</button>
          </form>
        )}
      </Card>

      {md && (
        <>
          <div id="salary" />
          <Card title={<>{t("empSalary")} <Tag>{t("mdOnly")}</Tag> <Tag>{open ? t("revealed") : `🔒 ${t("masked")}`}</Tag></>} accent>
            <Table head={[t("empEffectiveFrom"), t("empBaseSalary"), t("empAllowances"), t("empGross"), t("empSsoBase"), t("empSsoEmployee"), t("empSsoEmployer"), t("empPvd"), t("empWht"), t("empNetEstimate"), t("empTaxDeductions"), t("empReason"), t("empApprovedBy"), t("empLetter")]}>
              {salaries.map((s, i) => (
                <tr key={s.id} className={i === 0 ? "font-semibold" : ""}>
                  <td className="whitespace-nowrap">{day(s.effectiveFrom)}{i === 0 && <Tag>{t("empCurrent")}</Tag>}</td>
                  <td className="text-right">{fmt(s.baseSalary, open)}</td>
                  <td className="text-right">{fmt(s.allowanceTotal, open)}{open && Array.isArray(s.allowances) && (s.allowances as { name: string; amount: number }[]).map((a) => <span key={a.name} className="block text-xs font-normal text-navy/60">{a.name} {Number(a.amount).toLocaleString()}</span>)}</td>
                  <td className="text-right">{fmt(s.grossMonthly, open, s.currency)}{open && s.variablePay != null && Number(s.variablePay) > 0 && <span className="block text-xs text-navy/60">{t("empVariablePay")} {fmt(s.variablePay, open)}</span>}</td>
                  <td className="text-right">{fmt(s.ssoWageBase, open)}</td><td className="text-right">{fmt(s.ssoEmployee, open)}</td><td className="text-right">{fmt(s.ssoEmployer, open)}</td>
                  <td className="text-right">{s.pvdEmployeeRate ? `${pct(s.pvdEmployeeRate)} / ${pct(s.pvdEmployerRate)}` : "—"}</td>
                  <td className="text-right">{fmt(s.whtMonthly, open)}</td>
                  <td className="text-right">{fmt(s.netEstimate, open)}</td>
                  <td className="text-xs">{open && s.taxDeductions ? Object.entries(s.taxDeductions as Record<string, unknown>).map(([k, v]) => <span key={k} className="block">{t(`tax_${k}`)}: {String(v)}</span>) : s.taxDeductions ? "••••" : "—"}</td>
                  <td>{s.reason}{s.note && <span className="block text-xs text-navy/60">{s.note}</span>}</td>
                  <td>{s.approvedBy.name}</td>
                  <td className="whitespace-nowrap text-xs">{salaries[i + 1] && Number(s.baseSalary) > Number(salaries[i + 1].baseSalary) ? <><a className="text-blue hover:underline" href={`/api/people/${code}/salary/${s.id}/letter?format=pdf`}>PDF</a> · <a className="text-blue hover:underline" href={`/api/people/${code}/salary/${s.id}/letter`}>Word</a></> : "—"}</td>
                </tr>
              ))}
              {!salaries.length && <tr><td colSpan={14} className="text-navy/60">—</td></tr>}
            </Table>
            <p className="text-xs text-navy/60">{t("empSalaryNote")}</p>
            {otLines.length > 0 && <div><p className="mb-1 text-sm font-semibold text-navy">{t("otPayOnFile")}</p>
              <Table head={[t("otMonth"), t("otHours"), t("otRate"), t("otPay")]}>
                {otLines.map((l) => <tr key={l.id}><td><Link href={`/people/overtime/${l.month.month}`} className="font-mono text-blue hover:underline">{l.month.month}</Link></td><td>{Number(l.totalHours)}</td><td className="text-right">{fmt(l.hourlyRate, open)}</td><td className="text-right font-semibold">{fmt(l.total, open)}</td></tr>)}
              </Table></div>}
            {(() => {
              const [cur, prev] = salaries;
              const ch = cur && prev ? salaryChange(Number(prev.baseSalary), Number(cur.baseSalary)) : undefined;
              if (!cur || !ch || ch.diff <= 0) return null;
              const l = (cur.letter as LetterDetails | null) ?? {};
              return (
                <div id="letter" className="rounded-lg border border-blue/40 bg-tint p-3">
                  <p className="text-sm font-semibold text-navy">{t("empLetter")} <Tag>STRICTLY CONFIDENTIAL</Tag></p>
                  <p className="mb-2 text-xs text-navy/70">{t("empLetterHint", { from: day(cur.effectiveFrom), pct: ch.pct })}</p>
                  <form action={letter.bind(null, code, cur.id)} className="space-y-2">
                    <Grid cols={2}>
                      <Field label={t("empLetterSalutation")}><input name="salutation" defaultValue={l.salutation ?? e.name.split(" ")[0]} className={inputCls} /></Field>
                      <Field label={t("empLetterPosition")}><input name="position" defaultValue={l.position ?? e.position ?? ""} className={inputCls} /></Field>
                      <Field label={t("empLetterEmployeeNo")}><input name="employeeNo" defaultValue={l.employeeNo ?? ""} placeholder={e.code} className={`${inputCls} font-mono`} /></Field>
                    </Grid>
                    <Field label={t("empLetterPraiseTh")}><textarea name="praiseTh" rows={2} defaultValue={l.praiseTh ?? ""} className={inputCls} /></Field>
                    <Field label={t("empLetterPraiseEn")}><textarea name="praiseEn" rows={2} defaultValue={l.praiseEn ?? ""} className={inputCls} /></Field>
                    <Field label={t("empLetterPraiseZh")}><textarea name="praiseZh" rows={2} defaultValue={l.praiseZh ?? ""} className={inputCls} /></Field>
                    <div className="flex flex-wrap gap-2">
                      <button className={btnPrimary}>{t("empLetterSave")}</button>
                      <a className={btnGhost} href={`/api/people/${code}/salary/${cur.id}/letter?format=pdf`}>{t("empLetterPdf")}</a>
                      <a className={btnGhost} href={`/api/people/${code}/salary/${cur.id}/letter`}>{t("empLetterWord")}</a>
                    </div>
                  </form>
                </div>
              );
            })()}
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-navy">＋ {t("empAddSalary")}</summary>
              <form action={salary.bind(null, code)} className="mt-3 space-y-3">
                <Grid cols={4}>
                  <Field label={t("empEffectiveFrom")} required><input name="effectiveFrom" type="date" required className={inputCls} /></Field>
                  <Field label={c("currency")}><input name="currency" defaultValue={e.entity.localCurrency} pattern="[A-Z]{3}" className={inputCls} /></Field>
                  <Field label={t("empBaseSalary")} required><input name="baseSalary" type="number" step="0.01" min={0} required className={inputCls} /></Field>
                  <Field label={t("empReason")} required><input name="reason" required placeholder={t("empReasonHint")} className={inputCls} /></Field>
                </Grid>
                <div>
                  <div className="mb-1 text-[13px] text-navy/80">{t("empAllowances")}</div>
                  <RevealRows initial={1} addLabel={t("empAddAllowance")}>
                    {Array.from({ length: ALLOWANCE_ROWS }, (_, i) => <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-4"><input name={`an${i}`} placeholder={t("empAllowanceName")} className={inputCls} /><input name={`aa${i}`} type="number" step="0.01" min={0} placeholder={c("amount")} className={inputCls} /></div>)}
                  </RevealRows>
                </div>
                <Grid cols={4}>
                  <Field label={t("empSsoBase")}><input name="ssoWageBase" type="number" step="0.01" min={0} placeholder={stat ? t("empSsoBaseHint", { floor: stat.ssoWageFloor.toLocaleString(), ceiling: stat.ssoWageCeiling.toLocaleString() }) : ""} className={inputCls} /></Field>
                  <Field label={t("empSsoEmployeeRate")}><input name="ssoEmployeeRate" type="number" step="0.0001" min={0} max={1} defaultValue={stat?.ssoEmployeeRate} className={inputCls} /></Field>
                  <Field label={t("empSsoEmployerRate")}><input name="ssoEmployerRate" type="number" step="0.0001" min={0} max={1} defaultValue={stat?.ssoEmployerRate} className={inputCls} /></Field>
                  <Field label={t("empVariablePay")}><input name="variablePay" type="number" step="0.01" min={0} placeholder={t("empVariablePayPh")} className={inputCls} /></Field>
                  <Field label={t("empWht")}><input name="whtMonthly" type="number" step="0.01" min={0} className={inputCls} /></Field>
                  <Field label={t("empPvdEmployeeRate")}><input name="pvdEmployeeRate" type="number" step="0.0001" min={0} max={1} className={inputCls} /></Field>
                  <Field label={t("empPvdEmployerRate")}><input name="pvdEmployerRate" type="number" step="0.0001" min={0} max={1} className={inputCls} /></Field>
                  <Field label={t("empApprovedBy")}><select name="approvedByCode" defaultValue={me.code} className={inputCls}>{[{ code: me.code, name: me.name }, ...managers].map((m) => <option key={m.code} value={m.code}>{m.code} · {m.name}</option>)}</select></Field>
                  <Field label={t("empApprovedAt")}><input name="approvedAt" type="date" className={inputCls} /></Field>
                </Grid>
                <div>
                  <div className="mb-1 text-[13px] text-navy/80">{t("empTaxDeductions")} <span className="text-xs text-navy/60">{t("empTaxDeductionsHint")}</span></div>
                  <Grid cols={4}>
                    <Field label={t("tax_maritalStatus")}><select name="tx_maritalStatus" className={inputCls} defaultValue=""><option value="">—</option><option value="single">{t("marital_single")}</option><option value="married">{t("marital_married")}</option><option value="divorced">{t("marital_divorced")}</option><option value="widowed">{t("marital_widowed")}</option></select></Field>
                    <Field label={t("tax_spouseNoIncome")}><select name="tx_spouseNoIncome" className={inputCls} defaultValue=""><option value="">—</option><option value="yes">{c("yes")}</option><option value="no">{c("no")}</option></select></Field>
                    <Field label={t("tax_children")}><input name="tx_children" type="number" min={0} className={inputCls} /></Field>
                    <Field label={t("tax_parentsSupported")}><input name="tx_parentsSupported" type="number" min={0} max={4} className={inputCls} /></Field>
                    <Field label={t("tax_lifeInsurance")}><input name="tx_lifeInsurance" type="number" step="0.01" min={0} className={inputCls} /></Field>
                    <Field label={t("tax_homeLoanInterest")}><input name="tx_homeLoanInterest" type="number" step="0.01" min={0} className={inputCls} /></Field>
                    <Field label={t("tax_pvdDeclared")}><input name="tx_pvdDeclared" type="number" step="0.01" min={0} className={inputCls} /></Field>
                    <Field label={t("tax_otherDeductionsNote")} className="md:col-span-2"><input name="tx_otherDeductionsNote" className={inputCls} /></Field>
                  </Grid>
                </div>
                <div>
                  <div className="mb-1 text-[13px] text-navy/80">{t("empOtherDeductions")}</div>
                  <RevealRows initial={1} addLabel={t("empAddDeduction")}>
                    {Array.from({ length: DEDUCTION_ROWS }, (_, i) => <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-4"><input name={`dn${i}`} placeholder={t("empDeductionName")} className={inputCls} /><input name={`da${i}`} type="number" step="0.01" min={0} placeholder={c("amount")} className={inputCls} /></div>)}
                  </RevealRows>
                </div>
                <Field label={c("note")}><input name="note" className={inputCls} /></Field>
                <button className={btnPrimary}>{t("empAddSalary")}</button>
              </form>
            </details>
          </Card>
        </>
      )}

      <div id="reviews" />
      <Card title={<>{t("empReviews")} {md && <Tag>{t("empReviewsHint")}</Tag>}</>}>
        <Table head={[t("empPeriod"), c("type"), t("empScore"), t("empGrade"), t("empReviewer"), c("date"), t("empConclusion"), t("empImprovements")]}>
          {e.reviews.map((k) => <tr key={k.id}><td>{k.period}</td><td>{t(`review_${k.kind}`)}</td><td className="text-right">{k.score === null ? "—" : Number(k.score)}</td><td>{k.grade ?? "—"}</td><td>{k.reviewer.name}</td><td>{day(k.reviewedAt)}</td><td>{k.conclusion ?? ""}</td><td>{k.improvements ?? ""}{md && !k.visibleToEmployee && <Tag hot>{t("empHiddenFromEmployee")}</Tag>}</td></tr>)}
          {!e.reviews.length && <tr><td colSpan={8} className="text-navy/60">—</td></tr>}
        </Table>
        {md && (
          <form action={review.bind(null, code)} className="space-y-2">
            <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
              <input name="period" required placeholder={t("empPeriodHint")} className={inputCls} />
              <select name="kind" className={inputCls} defaultValue="QUARTERLY">{REVIEW_KINDS.map((k) => <option key={k} value={k}>{t(`review_${k}`)}</option>)}</select>
              <input name="score" type="number" step="0.1" min={0} max={100} placeholder={t("empScore")} className={inputCls} />
              <input name="grade" placeholder={t("empGrade")} className={inputCls} />
              <input name="reviewedAt" type="date" required defaultValue={now.toISOString().slice(0, 10)} className={inputCls} />
              <button className={btnGhost}>＋ {t("empAddReview")}</button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2"><input name="conclusion" placeholder={t("empConclusion")} className={inputCls} /><input name="improvements" placeholder={t("empImprovements")} className={inputCls} /></div>
            <div className="flex flex-wrap gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" name="visibleToEmployee" defaultChecked /> {t("empVisibleToEmployee")}</label><label className="flex items-center gap-2"><input type="checkbox" name="confirmProbation" /> {t("empConfirmProbation")}</label></div>
          </form>
        )}
      </Card>

      {!md && (
        <>
          <div id="account" />
          <Card title={t("empAccount")}>
            <Grid cols={4}>
              <Field label={t("emailLogin")}><Value>{e.email ?? "—"}</Value></Field>
              <Field label={c("role")}><Value>{r(e.role)}</Value></Field>
              <Field label={t("uiLanguage")}><Value>{e.locale}</Value></Field>
              <Field label={t("empLastLogin")}><Value>{e.lastLoginAt ? e.lastLoginAt.toISOString().replace("T", " ").slice(0, 16) : "—"}</Value></Field>
            </Grid>
          </Card>
        </>
      )}

      <div id="files" />
      <Card title={t("attachments")}>
        {Array.isArray(e.attachments) && (e.attachments as { name: string; url: string; kind?: string }[]).length
          ? <ul className="space-y-1 text-sm">{(e.attachments as { name: string; url: string; kind?: string }[]).map((a, i) => <li key={i}><Link href={a.url} target="_blank" className="text-blue hover:underline">{a.name}</Link>{a.kind && <span className="ml-2 text-xs text-navy/60">{a.kind}</span>}</li>)}</ul>
          : <p className="text-sm text-navy/60">—</p>}
        {md && <p className="text-xs text-navy/60">{t("empFilesNote")}</p>}
      </Card>
    </div>
  );
}
