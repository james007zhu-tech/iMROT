import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { getFaultCode } from "@/server/knowledge";
import { KINDS, LANGS, canApprove, publicBlocker, type ManualText, type PublicText, type Source } from "@/lib/knowledge";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Alert, Card, Field, Grid, PageHeader, Tag, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { STATUS_TONE } from "../CodeTable";
import { bulkReviewAction, saveCodeAction } from "../actions";

export const dynamic = "force-dynamic";

const area = `${inputCls} min-h-20`;
/** Lists and manual text get as many rows as they have lines, so nothing hides behind a scrollbar. */
const rows = (v: string | string[] | undefined, min = 3) => Math.min(14, Math.max(min, (Array.isArray(v) ? v.length : Math.ceil((v ?? "").length / 70)) + 1));

/**
 * One fault code (mockup v0.1 screen 4): public content in three languages (our words — the only part that can be
 * published), the manufacturer's text (internal reference, never published), internal notes, our cases, and review.
 * /fault-codes/new uses the same page with id "new".
 */
export default async function FaultCodePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string; series?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await currentEmployee();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const isNew = id === "new";
  const c = isNew ? null : await getFaultCode(id);
  const series = await prisma.series.findMany({ where: { active: true }, include: { brand: true }, orderBy: [{ brand: { name: "asc" } }, { name: "asc" }] });
  const pub = (c?.publicText ?? {}) as PublicText, man = (c?.manualText ?? {}) as ManualText, src = (c?.source ?? {}) as Source;
  const seriesId = c?.seriesId ?? sp.series ?? "";
  const back = isNew ? "/fault-codes/new" : `/fault-codes/${id}`;
  const review = bulkReviewAction.bind(null, back, "");
  // each button carries its operation in its own bound action — a submit button's name/value did not reach the server
  const op = (o: string) => bulkReviewAction.bind(null, back, o);
  const blocker = c ? publicBlocker({ status: c.status, publicText: pub }) : null;
  const publicUrl = c?.published ? `/faults/${c.published.brandSlug}/${c.published.seriesSlug}/${encodeURIComponent(c.code.toLowerCase())}` : null;
  const L = { zh: "中文", en: "English", th: "ไทย" } as const;

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: c ? `/series/${c.seriesId}?tab=codes` : "/fault-codes", label: c ? `${c.series.brand.name} ${c.series.name}` : u("kbLibrary") }}
        title={c ? <><span className="font-mono text-fault">{c.code}</span> {c.title}</> : u("kbNewCode")}
        badge={c && <><Tag>{u(`kbKind_${c.kind}`)}</Tag><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[c.status]}`}>{u(`kbStatus_${c.status}`)}</span>{c.isPublic && c.status === "APPROVED" ? <Tag>{c.published ? u("kbPublished") : u("kbPublicPending")}</Tag> : null}</>}
        actions={publicUrl ? <Link href={publicUrl} target="_blank" className={btnGhost}>{u("kbPublicPreview")}</Link> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      {c?.mustStop === "UNVERIFIED" && <Alert>{u("kbMustStopUnverified")}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <form id="f" action={saveCodeAction.bind(null, isNew ? "" : id)} className="space-y-4">
          <UploadRecognize kind="faultcode" formId="f" title={u("upFaultCodeTitle")} hint={u("upFaultCodeHint")} />
          <Card title={u("kbBasics")}>
            <Grid>
              <Field label={u("kbSeries")} required><select name="seriesId" required defaultValue={seriesId} className={inputCls}><option value="">—</option>{series.map((s) => <option key={s.id} value={s.id}>{s.brand.name} {s.name}</option>)}</select></Field>
              <Field label={u("kbCode")} required><input name="code" required defaultValue={c?.code} className={`${inputCls} font-mono`} /></Field>
              <Field label={u("kbKind")}><select name="kind" defaultValue={c?.kind ?? "FAULT"} className={inputCls}>{KINDS.map((k) => <option key={k} value={k}>{u(`kbKind_${k}`)}</option>)}</select></Field>
              <Field label={u("kbMustStop")}><select name="mustStop" defaultValue={c?.mustStop ?? "UNVERIFIED"} className={inputCls}>{["UNVERIFIED", "YES", "NO"].map((k) => <option key={k} value={k}>{u(`kbMustStop_${k}`)}</option>)}</select></Field>
              <Field label={u("kbAppliesTo")}><input name="appliesTo" defaultValue={c?.appliesTo ?? ""} placeholder={u("kbAppliesToPh")} className={inputCls} /></Field>
              <Field label={u("kbRelated")}><input name="related" defaultValue={c?.related.join(", ")} className={`${inputCls} font-mono`} /></Field>
              <Field label={u("kbKeywords")} className="md:col-span-2"><input name="keywords" defaultValue={c?.keywords.join(" | ")} placeholder={u("kbKeywordsPh")} className={inputCls} /></Field>
            </Grid>
          </Card>

          <Card title={<>{u("kbPublicContent")} <span className="ml-2 text-xs font-normal text-navy/60">{u("kbPublicContentHint")}</span></>}>
            <div className="space-y-2">
              {LANGS.map((l) => (
                <details key={l} open={l === "zh" || !!pub[l]?.title} className="rounded-lg border border-navy/15 p-3">
                  <summary className="cursor-pointer font-semibold text-navy">{L[l]}{pub[l]?.title ? ` · ${pub[l]!.title}` : ""}</summary>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <Field label={u("kbTitle")}><input name={`title_${l}`} defaultValue={pub[l]?.title} className={inputCls} /></Field>
                    <Field label={u("kbMeaning")}><textarea name={`meaning_${l}`} defaultValue={pub[l]?.meaning} className={area} /></Field>
                    <Field label={u("kbCauses")}><textarea name={`causes_${l}`} rows={rows(pub[l]?.causes)} defaultValue={pub[l]?.causes?.join("\n")} placeholder={u("kbOnePerLine")} className={inputCls} /></Field>
                    <Field label={u("kbChecks")}><textarea name={`checks_${l}`} rows={rows(pub[l]?.checks)} defaultValue={pub[l]?.checks?.join("\n")} placeholder={u("kbOnePerLine")} className={inputCls} /></Field>
                    <Field label={u("kbRemedy")}><textarea name={`remedy_${l}`} defaultValue={pub[l]?.remedy} className={area} /></Field>
                    <Field label={u("kbSafety")}><textarea name={`safety_${l}`} defaultValue={pub[l]?.safety} className={area} /></Field>
                    <Field label={u("kbPrepare")} className="md:col-span-2"><textarea name={`prepare_${l}`} defaultValue={pub[l]?.prepare} placeholder={u("kbOnePerLine")} className={area} /></Field>
                  </div>
                </details>
              ))}
            </div>
          </Card>

          <Card title={<>{u("kbManualText")} <span className="ml-2 text-xs font-normal text-navy/60">{u("kbManualTextHint")}</span></>}>
            <div className="space-y-2">
              {LANGS.map((l) => (
                <details key={l} open={l === "en" && !!man.en?.meaning} className="rounded-lg border border-dashed border-navy/25 bg-navy/[0.02] p-3">
                  <summary className="cursor-pointer font-semibold text-navy">{L[l]}</summary>
                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                    <Field label={u("kbManualMeaning")}><textarea name={`manual_${l}_meaning`} defaultValue={man[l]?.meaning} className={area} /></Field>
                    <Field label={u("kbManualActions")}><textarea name={`manual_${l}_actions`} rows={rows(man[l]?.actions, 5)} defaultValue={man[l]?.actions} className={inputCls} /></Field>
                  </div>
                </details>
              ))}
              <Grid cols={3}>
                <Field label={u("kbSourceTitle")} className="md:col-span-2"><input name="source_title" defaultValue={src.title} className={inputCls} /></Field>
                <Field label={u("kbSourceDoc")}><input name="source_docId" defaultValue={src.docId} className={`${inputCls} font-mono`} /></Field>
                <Field label={u("kbSourceRev")}><input name="source_revision" defaultValue={src.revision} className={inputCls} /></Field>
                <Field label={u("kbSourceDate")}><input name="source_date" defaultValue={src.date} className={inputCls} /></Field>
                <Field label={u("kbSourcePage")}><input name="source_page" type="number" defaultValue={src.page} className={inputCls} /></Field>
                <Field label={u("kbSourceUrl")} className="md:col-span-3"><input name="source_url" defaultValue={src.url} className={inputCls} /></Field>
              </Grid>
            </div>
          </Card>

          <Card title={<>{u("kbInternal")} <span className="ml-2 text-xs font-normal text-navy/60">{u("kbInternalHint")}</span></>}>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label={u("kbInternalNotes")}><textarea name="internalNotes" defaultValue={c?.internalNotes ?? ""} className={area} /></Field>
              <Field label={u("kbCommonParts")}><textarea name="commonParts" defaultValue={c?.commonParts ?? ""} className={area} /></Field>
            </div>
          </Card>
          <div className="flex justify-end"><button className={btnPrimary}>{t("save")}</button></div>
        </form>

        {c && (
          <aside className="space-y-4">
            <Card title={u("kbReview")}>
              <dl className="space-y-1 text-sm">
                <div><dt className="inline text-navy/60">{u("kbVersion")}: </dt><dd className="inline">v{c.version}</dd></div>
                <div><dt className="inline text-navy/60">{u("kbOrigin")}: </dt><dd className="inline">{u(`kbOrigin_${c.origin}`)}{c.import ? ` · ${c.import.fileName} · ${c.import.actor.name} · ${localIso(c.import.createdAt)!.slice(0, 10)}` : ""}</dd></div>
                {c.reviewedBy && <div><dt className="inline text-navy/60">{u("kbReviewedBy")}: </dt><dd className="inline">{c.reviewedBy.name} · {localIso(c.reviewedAt)?.slice(0, 10)}</dd></div>}
                {c.reviewNote && <div className="rounded bg-alert/10 px-2 py-1 text-alert-ink">{c.reviewNote}</div>}
                {c.published && <div><dt className="inline text-navy/60">{u("kbPublishedAt")}: </dt><dd className="inline">{localIso(c.published.publishedAt)!.slice(0, 10)} · v{c.published.version}</dd></div>}
              </dl>
              <form action={review} className="mt-3 space-y-2">
                <input type="hidden" name="id" value={c.id} />
                <div className="flex flex-wrap gap-2">
                  {c.status === "DRAFT" && <button formAction={op("submit")} className={btnGhost}>{u("kbSubmit")}</button>}
                  {canApprove(me.role) && c.status !== "APPROVED" && c.status !== "RETIRED" && <button formAction={op("approve")} className={btnPrimary}>{u("kbApprove")}</button>}
                  {canApprove(me.role) && !c.isPublic && !blocker && <button formAction={op("public")} className={btnGhost}>{u("kbMakePublic")}</button>}
                  {canApprove(me.role) && c.isPublic && <button formAction={op("internal")} className={btnGhost}>{u("kbMakeInternal")}</button>}
                </div>
                {canApprove(me.role) && c.status !== "RETIRED" && <div className="flex gap-2"><input name="note" placeholder={u("kbRejectNote")} className={`${inputCls} min-w-0 flex-1`} /><button formAction={op("reject")} className={`${btnGhost} shrink-0 whitespace-nowrap`}>{u("kbReject")}</button></div>}
                {blocker && !c.isPublic && <p className="text-xs text-navy/60">{u(`err_${blocker}`)}</p>}
              </form>
            </Card>
            <Card title={`${u("kbOurCases")} (${c.cases.length})`}>
              {c.cases.length ? <ul className="space-y-1 text-sm">{c.cases.map((o) => <li key={o.no}><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link> <span className="text-navy/70">{o.customer.name} · {localIso(o.createdAt)!.slice(0, 10)}</span></li>)}</ul> : <p className="text-sm text-navy/60">{u("kbNoCases")}</p>}
            </Card>
          </aside>
        )}
      </div>
    </div>
  );
}
