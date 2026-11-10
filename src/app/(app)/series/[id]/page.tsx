import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { getSeries, listFaultCodes } from "@/server/knowledge";
import { canApprove, canEditDictionary, KINDS, STATUSES, manualLabel, type Source } from "@/lib/knowledge";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Card, Field, Grid, PageHeader, Pager, Table, Tag, btnGhost, btnPrimary, filterCls, inputCls } from "@/components/ui";
import { CodeTable } from "../../fault-codes/CodeTable";
import { saveSeriesAction } from "../../fault-codes/actions";

export const dynamic = "force-dynamic";
const SIZE = 100;

/** One series (mockup v0.1 screen 3): overview form, its models, its fault-code library. /series/new = id "new". */
export default async function SeriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const me = await currentEmployee();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const isNew = id === "new";
  const s = isNew ? null : await getSeries(id);
  const tab = isNew ? "overview" : sp.tab ?? "codes";
  const [brands, categories, others] = await Promise.all([
    prisma.brand.findMany({ orderBy: { name: "asc" } }), prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.series.findMany({ where: isNew ? {} : { id: { not: id } }, include: { brand: true }, orderBy: { name: "asc" } }),
  ]);
  const page = Math.max(1, Number(sp.page) || 1);
  const codes = s && tab === "codes" ? await listFaultCodes({ seriesId: s.id, q: sp.q, kind: sp.kind, status: sp.status, pub: sp.pub as never, take: SIZE, skip: (page - 1) * SIZE }) : null;
  const counts = s ? await prisma.faultCode.groupBy({ by: ["status"], where: { seriesId: s.id }, _count: { _all: true } }) : [];
  const total = counts.reduce((a, c) => a + c._count._all, 0);
  const qs = (o: Record<string, string | number | undefined>) => `/series/${id}?${new URLSearchParams(Object.entries({ ...sp, ok: undefined, error: undefined, ...o }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`;
  const tabCls = (on: boolean) => `border-b-2 px-4 py-2 text-sm ${on ? "border-blue font-semibold text-navy" : "border-transparent text-navy/60"}`;
  const docs = (s?.documents ?? []) as Source[];
  const editable = canEditDictionary(me.role);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/series", label: u("kbSeriesTitle") }} title={s ? s.name : u("kbNewSeries")}
        badge={s && <><Tag>{s.brand.name}</Tag>{s.category && <Tag>{s.category.nameZh}</Tag>}</>}
        actions={s ? <><Link href={`/fault-codes/import?series=${s.id}`} className={btnGhost}>{u("kbImport")}</Link><Link href={`/fault-codes/new?series=${s.id}`} className={btnGhost}>{u("kbNewCode")}</Link></> : undefined} />
      <Flash ok={sp.ok} error={sp.error} />
      {s && (
        <div className="flex border-b border-navy/15">
          <Link href={qs({ tab: "overview", page: undefined })} className={tabCls(tab === "overview")}>{u("kbTabOverview")}</Link>
          <Link href={qs({ tab: "models", page: undefined })} className={tabCls(tab === "models")}>{u("kbModels")} {s.models.length}</Link>
          <Link href={qs({ tab: "codes" })} className={tabCls(tab === "codes")}>{u("kbTabCodes")} {total}</Link>
        </div>
      )}

      {tab === "overview" && (
        <form id="f" action={saveSeriesAction.bind(null, isNew ? "" : id)} className="space-y-4">
          <UploadRecognize kind="series" formId="f" title={u("upSeriesTitle")} hint={u("upSeriesHint")} />
          <Card title={u("kbSeriesForm")}>
            <Grid>
              <Field label={u("kbBrand")} required><select name="brandId" required defaultValue={s?.brandId ?? ""} className={inputCls}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
              <Field label={u("kbSeriesCode")} required><input name="code" required defaultValue={s?.code} className={`${inputCls} font-mono`} /></Field>
              <Field label={u("kbSeriesName")} required><input name="name" required defaultValue={s?.name} className={inputCls} /></Field>
              <Field label={u("kbCategory")}><select name="categoryCode" defaultValue={s?.categoryCode ?? ""} className={inputCls}><option value="">—</option>{categories.map((c) => <option key={c.code} value={c.code}>{c.nameZh} · {c.nameEn}</option>)}</select></Field>
              <Field label={u("kbLifecycle")}><select name="lifecycle" defaultValue={s?.lifecycle ?? "ACTIVE"} className={inputCls}>{["ACTIVE", "MATURE", "DISCONTINUED"].map((l) => <option key={l} value={l}>{u(`kbLife_${l}`)}</option>)}</select></Field>
              <Field label={u("kbSuccessor")}><select name="successorId" defaultValue={s?.successorId ?? ""} className={inputCls}><option value="">—</option>{others.map((o) => <option key={o.id} value={o.id}>{o.brand.name} {o.name}</option>)}</select></Field>
              <Field label={u("kbAliases")}><input name="aliases" defaultValue={s?.aliases.join(", ")} placeholder="S120, SINAMICS S120" className={inputCls} /></Field>
              <Field label={u("kbCodePattern")}><input name="codePattern" defaultValue={s?.codePattern ?? ""} placeholder="^[FA]\d{5}$" className={`${inputCls} font-mono`} /></Field>
              <Field label={u("kbCodeRule")}><input name="codeRule" defaultValue={s?.codeRule ?? ""} placeholder={u("kbCodeRulePh")} className={inputCls} /></Field>
              <Field label={u("kbStructure")} className="md:col-span-2"><textarea name="notes" defaultValue={s?.notes ?? ""} className={`${inputCls} min-h-16`} /></Field>
              <Field label={u("kbSlug")}><input name="slug" defaultValue={s?.slug ?? ""} className={`${inputCls} font-mono`} /></Field>
            </Grid>
            <div className="mt-3 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" name="publicVisible" defaultChecked={s?.publicVisible ?? true} />{u("kbPublicVisible")}</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={s?.active ?? true} />{u("kbActive")}</label>
            </div>
            {docs.length > 0 && <div className="mt-3 text-sm"><div className="text-navy/60">{u("kbDocuments")}</div><ul>{docs.map((d, i) => <li key={i}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="text-blue hover:underline">{manualLabel(d)}</a> : manualLabel(d)}</li>)}</ul></div>}
          </Card>
          {editable ? <div className="flex justify-end"><button className={btnPrimary}>{t("save")}</button></div> : <p className="text-sm text-navy/60">{u("kbDictionaryReadOnly")}</p>}
        </form>
      )}

      {s && tab === "models" && (
        <div className="rounded-xl border bg-white p-2">
          <Table head={[u("model"), u("kbAssets")]}>
            {s.models.map((m) => <tr key={m.id}><td className="font-mono"><Link href={`/models/${m.id}`} className="text-blue hover:underline">{m.code}</Link></td><td className="text-right">{m._count.assets}</td></tr>)}
            {s.models.length === 0 && <tr><td colSpan={2} className="py-6 text-center text-navy/60">—</td></tr>}
          </Table>
        </div>
      )}

      {s && codes && (
        <>
          {s.codeRule && <p className="text-sm text-navy/70">{u("kbCodeRule")}: {s.codeRule}</p>}
          <form className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
            <input type="hidden" name="tab" value="codes" />
            <input name="q" defaultValue={sp.q} placeholder={u("kbSearchPh")} className={`${filterCls} min-w-64 flex-1`} />
            <select name="kind" defaultValue={sp.kind ?? ""} className={filterCls}><option value="">{u("kbAllKinds")}</option>{KINDS.map((k) => <option key={k} value={k}>{u(`kbKind_${k}`)}</option>)}</select>
            <select name="status" defaultValue={sp.status ?? ""} className={filterCls}><option value="">{u("kbAllStatus")}</option>{STATUSES.map((k) => <option key={k} value={k}>{u(`kbStatus_${k}`)} {counts.find((c) => c.status === k)?._count._all ?? 0}</option>)}</select>
            <select name="pub" defaultValue={sp.pub ?? ""} className={filterCls}><option value="">{u("kbPublicAny")}</option><option value="public">{u("kbPublic")}</option><option value="internal">{u("kbInternal")}</option></select>
            <button className={btnPrimary}>{t("search")}</button>
          </form>
          <div className="rounded-xl border bg-white p-2">
            <CodeTable rows={codes.rows} back={qs({})} showSeries={false} canReview={canApprove(me.role)} />
          </div>
          <Pager page={page} total={codes.total} size={SIZE} href={(n) => qs({ page: n })} prev={u("prevPage")} next={u("nextPage")} />
        </>
      )}
    </div>
  );
}
