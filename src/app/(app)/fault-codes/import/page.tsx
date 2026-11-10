import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { importFaultCodes } from "@/server/knowledge";
import { isBlocking, manualLabel } from "@/lib/knowledge";
import { Flash } from "@/components/Flash";
import { Alert, Card, Field, Grid, PageHeader, Table, Tag, btnPrimary, inputCls } from "@/components/ui";
import { commitImportAction, previewImportAction, readImport } from "../actions";

export const dynamic = "force-dynamic";

/**
 * 导入 (doc §导入格式): Grok's export (zip / JSON / CSV) or our CSV template. Step 1 uploads and shows what would
 * happen; step 2 imports. Imported codes land as 待审核; approved codes are never overwritten; missing brands and
 * series are created (category picked here).
 */
export default async function ImportCodes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await currentEmployee();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [categories, series] = await Promise.all([
    prisma.productCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.series.findMany({ where: { active: true }, include: { brand: true }, orderBy: { name: "asc" } }),
  ]);
  let preview: Awaited<ReturnType<typeof importFaultCodes>>["preview"] | null = null, previewError: string | null = null;
  if (sp.token) {
    try { preview = (await importFaultCodes({ fileName: sp.name ?? "import", text: await readImport(sp.token), actorCode: me.code, dryRun: true, createMissing: true, categoryCode: sp.category, seriesId: sp.series })).preview; }
    catch (e) { previewError = (e as Error).message; }
  }
  const n = (a: string) => preview?.rows.filter((r) => r.action === a).length ?? 0;
  // issues group by their code ("PAGE_REF:zh.remedy" → PAGE_REF); the part after the colon says where
  const codeOf = (i: string) => i.split(":")[0];
  const issues = preview ? [...new Set(preview.rows.flatMap((r) => r.issues.map(codeOf)))].map((code) => ({
    code, rows: preview!.rows.filter((r) => r.issues.some((i) => codeOf(i) === code)).length,
    where: [...new Set(preview!.rows.flatMap((r) => r.issues.filter((i) => codeOf(i) === code && i.includes(":")).map((i) => i.split(":")[1])))].slice(0, 8),
  })).sort((a, b) => Number(isBlocking(b.code)) - Number(isBlocking(a.code))) : [];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/fault-codes", label: u("kbLibrary") }} title={u("kbImport")} />
      <Flash ok={sp.token ? undefined : sp.ok} error={sp.error ?? previewError ?? undefined} />
      <form action={previewImportAction} className="space-y-3">
        <Card title={u("kbImportStep1")}>
          <p className="mb-2 text-sm text-navy/70">{u("kbImportHint")}</p>
          <Grid>
            <Field label={u("kbImportFile")} required><input type="file" name="file" required accept=".zip,.json,.csv" className={inputCls} /></Field>
            <Field label={u("kbImportCategory")}><select name="categoryCode" defaultValue={sp.category ?? "VFD"} className={inputCls}><option value="">—</option>{categories.map((c) => <option key={c.code} value={c.code}>{c.nameZh}</option>)}</select></Field>
            <Field label={u("kbImportIntoSeries")}><select name="seriesId" defaultValue={sp.series ?? ""} className={inputCls}><option value="">{u("kbImportSeriesFromFile")}</option>{series.map((s) => <option key={s.id} value={s.id}>{s.brand.name} {s.name}</option>)}</select></Field>
          </Grid>
          <div className="mt-3 flex justify-end"><button className={btnPrimary}>{u("kbImportPreview")}</button></div>
        </Card>
      </form>
      {preview && sp.token && (
        <Card title={`${u("kbImportStep2")} · ${sp.name}`} accent>
          <div className="mb-3 flex flex-wrap gap-2 text-sm">
            <Tag>{u("kbImportCreate", { n: n("create") })}</Tag><Tag>{u("kbImportUpdate", { n: n("update") })}</Tag><Tag hot={n("skip") > 0}>{u("kbImportSkip", { n: n("skip") })}</Tag>
            {preview.manual?.title && <span className="text-navy/70">{manualLabel(preview.manual)}</span>}
          </div>
          {preview.missing.length > 0 && <Alert>{u("kbImportMissing", { list: preview.missing.map((m) => `${m.brand ?? ""} ${m.series ?? ""}`.trim()).join("、") })}</Alert>}
          {issues.length > 0 && <ul className="my-2 space-y-1 text-sm">{issues.map((i) => <li key={i.code}><Tag hot={isBlocking(i.code)}>{i.rows}</Tag> {u(`kbIssue_${i.code}`)}{i.where.length > 0 && <span className="ml-1 font-mono text-xs text-navy/60">{i.where.join(", ")}</span>}</li>)}</ul>}
          <Table head={[u("kbCode"), u("kbTitle"), u("kbKind"), u("kbMustStop"), u("kbSourcePage"), u("kbImportIssues"), u("kbImportAction")]}>
            {[...preview.rows].sort((a, b) => Number(b.issues.some(isBlocking)) - Number(a.issues.some(isBlocking))).slice(0, 40).map((r, n) => <tr key={`${n}${r.series}${r.code}`}><td className="font-mono text-fault">{r.code}</td><td>{r.publicText.zh?.title ?? r.publicText.en?.title}</td><td>{u(`kbKind_${r.kind}`)}</td><td>{u(`kbMustStop_${r.mustStop}`)}</td><td>{r.source.page ?? ""}</td><td className="font-mono text-xs text-navy/70">{r.issues.filter((i) => i !== "MUST_STOP_UNVERIFIED").map((i) => <span key={i} className={isBlocking(i) ? "mr-1 text-alert-ink" : "mr-1"}>{i}</span>)}</td><td>{u(`kbImportAction_${r.action}`)}</td></tr>)}
          </Table>
          {preview.rows.length > 40 && <p className="px-2 text-xs text-navy/60">{u("kbImportMore", { n: preview.rows.length - 40 })}</p>}
          <form action={commitImportAction.bind(null, sp.token, sp.name ?? "import", sp.category ?? "", sp.series ?? "")} className="mt-3 flex items-center justify-end gap-3">
            <span className="text-xs text-navy/60">{u("kbImportLandsAs")}</span>
            <button className={btnPrimary}>{u("kbImportConfirm")}</button>
          </form>
        </Card>
      )}
      <p className="text-xs text-navy/50">{t("note")}: {u("kbImportCopyright")}</p>
    </div>
  );
}
