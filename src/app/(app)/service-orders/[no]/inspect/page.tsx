import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { catchUpOrder } from "@/server/slm";
import { createInspection, type InspectionNeed } from "@/server/slm-docs";
import { autoInquiryForOrder } from "@/server/purchasing";
import { RevealRows } from "@/components/RevealRows";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { inspectionGaps } from "@/lib/inspection-gaps";
import { Alert, Card, Field, Grid, Table, Tag, btnGhost, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";
const TESTS = ["visual", "supply", "faultLog", "functional", "extra1", "extra2"] as const;
const NEED_ROWS = 8;
const num = (f: FormData, k: string) => { const v = str(f, k); return v === undefined ? undefined : Number(v); };

/** 检测单 INTH — wireframe 6 (report: diagnostic report). */
export default async function Inspect({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [engineers, draft] = await Promise.all([
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.inspection.findFirst({ where: { serviceOrderId: order.id, draft: true }, orderBy: { no: "desc" }, include: { asset: { select: { code: true } }, engineer: { select: { code: true } } } }),
  ]);
  // Parts for the picker: the asset models' BOM first, then the rest of the catalogue (capped) — the engineer may also type a SKU that is not in it yet.
  const modelIds = [...new Set(order.assets.map((l) => l.asset.modelId).filter((x): x is string => !!x))];
  const [bom, catalogue] = await Promise.all([
    prisma.modelPart.findMany({ where: { modelId: { in: modelIds } }, include: { part: true } }),
    prisma.part.findMany({ orderBy: { sku: "asc" }, take: 400 }),
  ]);
  const partOptions = [...bom.map((b) => b.part), ...catalogue.filter((p) => !bom.some((b) => b.partId === p.id))];
  const dNeeds = (draft?.needs as InspectionNeed[] | null) ?? [];
  const dTests = (draft?.tests as { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean }[] | null) ?? [];
  // Rows: what the draft measured first, then the standard test names it does not have yet.
  const standard = TESTS.slice(0, 4).map((k) => u(`test_${k}`));
  const rows: { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean }[] = [...dTests, ...standard.filter((n) => !dTests.some((x) => x.test === n)).map((test) => ({ test }))].slice(0, TESTS.length);
  const gaps = draft ? inspectionGaps({ ...draft, tests: dTests }) : [];
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const tests = TESTS.map((k) => ({ test: str(f, `t_${k}`) ?? "", criterion: str(f, `c_${k}`), result: str(f, `r_${k}`), recordId: str(f, `id_${k}`), pass: f.get(`p_${k}`) ? f.get(`p_${k}`) === "yes" : undefined })).filter((x) => x.test && (x.criterion || x.result));
      const asDraft = f.get("draft") === "1"; // only the "save draft" button posts draft=1
      const needs = Array.from({ length: NEED_ROWS }, (_, i) => ({ kind: (str(f, `nk${i}`) ?? "PART") as "PART" | "LABOUR", partSku: str(f, `ns${i}`), description: str(f, `nd${i}`) ?? "", descriptionLocal: str(f, `nl${i}`), qty: num(f, `nq${i}`) ?? 0, unit: str(f, `nu${i}`) ?? "pcs" }))
        .map((n) => ({ ...n, description: n.description || n.partSku || "" })).filter((n) => n.description && n.qty > 0);
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } });
      const i = await createInspection({ serviceOrderNo: no, assetCode: String(f.get("assetCode")), engineerCode: str(f, "engineerCode") ?? me.code, inspectedAt: str(f, "inspectedAt") ? new Date(str(f, "inspectedAt")!) : undefined, symptoms: str(f, "symptoms"), conditions: str(f, "conditions"), findings: str(f, "findings"), probableCause: str(f, "probableCause"), recommendation: str(f, "recommendation"), instruments: str(f, "instruments"), openIssues: str(f, "openIssues"), conclusion: str(f, "conclusion"), tests, attachments: atts(f), location: (str(f, "location") as "SITE" | undefined), attachmentRefs: str(f, "attachmentRefs"), needs, draft: asDraft });
      if (asDraft) return { ok: i.no, to: `/service-orders/${no}/inspect` };
      if (cur.status === "RECEIVED" || cur.status === "ASSIGNED") await catchUpOrder(no, "DIAGNOSING", me.code, str(f, "engineerCode") ?? me.code);
      const pr = needs.some((n) => n.kind === "PART") ? await autoInquiryForOrder(no, str(f, "engineerCode") ?? me.code) : null; // flow step 3: short parts → PRTH
      return { ok: pr ? `${i.no} → PRTH ${pr}` : i.no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/inspect`);
  }
  return (
    <StepPage order={order} title={u("step_inspect")} badge={draft ? <Tag><span className="font-mono">{draft.no}</span> · {u("dn_DRAFT")}</Tag> : undefined} error={error} ok={ok} kind="inspection" uploadTitle={u("upInspectTitle")} uploadHint={u("upInspectHint")} saveLabel={u("saveAndReport")}
      extraActions={<button form="f" name="draft" value="1" formNoValidate className={btnGhost}>{u("saveDraft")}</button>}>
      {gaps.length > 0 && <Alert>{u("gapsTitle")} {gaps.map((g) => u(g.key, { detail: g.detail ?? "" })).join("；")}</Alert>}
      <form id="f" action={save} className="space-y-4">
        <Card title={u("basicInfo")}>
          <Grid>
            <Field label={t("asset")} required><select name="assetCode" defaultValue={draft?.asset.code} className={inputCls}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code} · S/N {l.asset.serialNumber}</option>)}</select></Field>
            <Field label={u("inspector")}><select name="engineerCode" defaultValue={draft?.engineer.code ?? order.assignee?.code} className={inputCls}>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("inspectedAt")}><input name="inspectedAt" type="datetime-local" defaultValue={draft?.inspectedAt ? local(draft.inspectedAt) : now} className={inputCls} /></Field>
            <Field label={u("inspectPlace")} required><select name="location" defaultValue={draft?.location ?? (order.documents.some((d) => d.type === "ER") ? "WORKSHOP" : "SITE")} className={inputCls}><option value="SITE">{u("locSite")}</option><option value="WORKSHOP">{u("locWorkshop")}</option></select></Field>
          </Grid>
        </Card>
        <Card title={u("inspectSteps")}>
          <Field label={u("reportedSymptomEditable")}><textarea name="symptoms" rows={2} defaultValue={draft?.symptoms ?? [order.reportedSymptom, order.reportedAlarm].filter(Boolean).join(" · ")} className={`${inputCls} font-semibold text-fault`} /></Field>
          <Field label={u("testConditions")} required><textarea name="conditions" required rows={2} defaultValue={draft?.conditions ?? ""} className={inputCls} /></Field>
          <Field label={u("findings")} required><textarea name="findings" required rows={3} defaultValue={draft?.findings ?? ""} className={inputCls} /></Field>
          <Field label={t("probableCause")} required><input name="probableCause" required defaultValue={draft?.probableCause ?? ""} className={inputCls} /></Field>
          <Field label={u("recommendationAuth")} required><textarea name="recommendation" required rows={2} defaultValue={draft?.recommendation ?? ""} className={inputCls} /></Field>
        </Card>
        <Card title={u("evidence")}>
          <Table head={[u("testItem"), t("criterion"), t("result"), u("recordPhoto"), u("pass")]}>
            {TESTS.map((k, i) => <tr key={k}>
              <td><input name={`t_${k}`} defaultValue={rows[i]?.test ?? ""} className={inputCls} /></td>
              <td><input name={`c_${k}`} defaultValue={rows[i]?.criterion ?? ""} className={inputCls} /></td><td><input name={`r_${k}`} defaultValue={rows[i]?.result ?? ""} className={inputCls} /></td><td><input name={`id_${k}`} defaultValue={rows[i]?.recordId ?? ""} className={inputCls} /></td>
              <td><select name={`p_${k}`} defaultValue={rows[i]?.pass === true ? "yes" : rows[i]?.pass === false ? "no" : ""} className={inputCls}><option value="">—</option><option value="yes">{u("yes")}</option><option value="no">{u("no")}</option></select></td>
            </tr>)}
          </Table>
          <Grid>
            <Field label={u("instrumentCal")}><input name="instruments" defaultValue={draft?.instruments ?? ""} className={inputCls} /></Field>
            <Field label={u("attachmentRefs")}><input name="attachmentRefs" placeholder="P1–P3, M1, LOG" defaultValue={draft?.attachmentRefs ?? ""} className={inputCls} /></Field>
            <Field label={u("openIssues")}><input name="openIssues" defaultValue={draft?.openIssues ?? ""} className={inputCls} /></Field>
          </Grid>
          <Field label={u("conclusionLimits")}><input name="conclusion" defaultValue={draft?.conclusion ?? ""} className={inputCls} /></Field>
        </Card>
        <Card title={<>{u("needsTitle")} <Tag>{u("internalOnly")}</Tag></>}>
          <p className="text-xs text-navy/70">{u("needsHint")}</p>
          <datalist id="parts">{partOptions.map((p) => <option key={p.id} value={p.sku}>{p.vendorPartNo} · {p.name}</option>)}</datalist>
          <div className="hidden grid-cols-[90px_170px_2fr_2fr_70px_70px_110px] gap-2 text-xs text-navy/70 md:grid"><span>{t("type")}</span><span>{u("partSku")}</span><span>{u("descEn")}</span><span>{u("descTh")}</span><span>{t("qty")}</span><span>{u("uom")}</span><span>{u("stockCheck")}</span></div>
          <RevealRows initial={Math.max(dNeeds.length, 2)} addLabel={u("addLine")}>
            {Array.from({ length: NEED_ROWS }, (_, i) => { const n = dNeeds[i]; return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[90px_170px_2fr_2fr_70px_70px_110px]">
                <select name={`nk${i}`} defaultValue={n?.kind ?? "PART"} className={inputCls}><option value="PART">{u("needPart")}</option><option value="LABOUR">{u("needLabour")}</option></select>
                <input name={`ns${i}`} list="parts" defaultValue={n?.partSku ?? ""} placeholder="SKU" className={`${inputCls} font-mono`} />
                <input name={`nd${i}`} defaultValue={n?.description ?? ""} className={inputCls} />
                <input name={`nl${i}`} defaultValue={n?.descriptionLocal ?? ""} className={inputCls} />
                <input name={`nq${i}`} type="number" step="0.5" min={0} defaultValue={n?.qty ?? ""} className={inputCls} />
                <input name={`nu${i}`} defaultValue={n?.unit ?? (n?.kind === "LABOUR" ? "h" : "pcs")} className={inputCls} />
                <div className="self-center text-xs">{n?.short ? <Tag hot>{u("short", { n: n.short })}</Tag> : n?.onHand !== undefined ? <span className="text-navy/70">{u("onHand", { n: n.onHand })}</span> : <span className="text-navy/50">{u("checkedOnSave")}</span>}</div>
              </div>); })}
          </RevealRows>
        </Card>
      </form>
    </StepPage>
  );
}
