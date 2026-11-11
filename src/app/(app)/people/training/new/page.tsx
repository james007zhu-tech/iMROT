import { getLocale, getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { LEVELS, TRAINING_RESULTS, trainingFor } from "@/server/training";
import { dictItems, dictLabel } from "@/server/dict";
import { localToday } from "@/lib/overtime";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Card, Field, Grid, PageHeader, btnPrimary, inputCls } from "@/components/ui";
import { recordAction } from "../actions";

export const dynamic = "force-dynamic";

/** 新建培训记录: one session, tick everyone who attended. A certificate photo or a spoken summary fills the form. */
export default async function NewTraining({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [t, me, locale] = await Promise.all([getTranslations("ops"), currentEmployee(), getLocale()]);
  const [{ staff, all }, kinds] = await Promise.all([trainingFor(me.code), dictItems("trainingKind")]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/people/training", label: t("trTitle") }} title={t("trNew")} />
      <Flash error={error} />
      <UploadRecognize kind="training" formId="f" title={t("trUpTitle")} hint={t("trUpHint")} />
      <Card>
        <form id="f" action={recordAction} className="space-y-3">
          <Field label={t("trName")} required><input name="title" required placeholder={t("trNamePh")} className={inputCls} /></Field>
          {all ? <Field label={t("trWho")} required><div className="grid gap-1 rounded-md border bg-white p-2 sm:grid-cols-2 lg:grid-cols-3">{staff.map((s) => <label key={s.code} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" name="employeeCodes" value={s.code} defaultChecked={staff.length === 1} className="h-4 w-4" /><span>{s.name} <span className="font-mono text-xs text-navy/60">{s.code}</span></span></label>)}</div></Field>
            : <input type="hidden" name="employeeCodes" value={me.code} />}
          <Grid cols={4}>
            <Field label={t("trKind")} required><select name="kind" required defaultValue="INTERNAL" className={inputCls}>{kinds.map((k) => <option key={k.code} value={k.code}>{dictLabel(k, locale)}</option>)}</select></Field>
            <Field label={t("trProvider")}><input name="provider" className={inputCls} /></Field>
            <Field label={t("trStart")} required><input name="startedOn" type="date" required defaultValue={localToday().date} className={inputCls} /></Field>
            <Field label={t("trEnd")}><input name="endedOn" type="date" className={inputCls} /></Field>
            <Field label={t("trHoursLabel")}><input name="hours" type="number" step="0.5" min="0" inputMode="decimal" className={inputCls} /></Field>
            <Field label={t("trResult")}><select name="result" defaultValue="ATTENDED" className={inputCls}>{TRAINING_RESULTS.map((r) => <option key={r} value={r}>{t(`tr_${r}`)}</option>)}</select></Field>
            <Field label={t("trLevel")}><select name="level" defaultValue="" className={inputCls}><option value="">—</option>{LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}</select></Field>
            <Field label={t("trScoreLabel")}><input name="score" type="number" step="0.5" min="0" max="100" inputMode="decimal" className={inputCls} /></Field>
            <Field label={t("trCert")}><input name="certificateNo" className={`${inputCls} font-mono`} /></Field>
            <Field label={t("trExpires")}><input name="expiresAt" type="date" className={inputCls} /></Field>
          </Grid>
          <Field label={t("trNote")}><textarea name="note" rows={2} placeholder={t("trNotePh")} className={inputCls} /></Field>
          <div className="flex justify-end"><button className={btnPrimary}>{t("save")}</button></div>
        </form>
      </Card>
    </div>
  );
}
