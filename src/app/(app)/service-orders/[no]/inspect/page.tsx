import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { catchUpOrder } from "@/server/slm";
import { createInspection } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, Table, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";
const TESTS = ["visual", "supply", "faultLog", "functional", "extra1", "extra2"] as const;

/** 检测单 INTH — wireframe 6 (report: diagnostic report). */
export default async function Inspect({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const engineers = await prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const tests = TESTS.map((k) => ({ test: str(f, `t_${k}`) ?? "", criterion: str(f, `c_${k}`), result: str(f, `r_${k}`), recordId: str(f, `id_${k}`), pass: f.get(`p_${k}`) ? f.get(`p_${k}`) === "yes" : undefined })).filter((x) => x.test && (x.criterion || x.result));
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } });
      const i = await createInspection({ serviceOrderNo: no, assetCode: String(f.get("assetCode")), engineerCode: str(f, "engineerCode") ?? me.code, inspectedAt: str(f, "inspectedAt") ? new Date(str(f, "inspectedAt")!) : undefined, symptoms: str(f, "symptoms"), conditions: str(f, "conditions"), findings: str(f, "findings"), probableCause: str(f, "probableCause"), recommendation: str(f, "recommendation"), instruments: str(f, "instruments"), openIssues: str(f, "openIssues"), conclusion: str(f, "conclusion"), tests, attachments: atts(f), location: (str(f, "location") as "SITE" | undefined), attachmentRefs: str(f, "attachmentRefs") });
      if (cur.status === "RECEIVED" || cur.status === "ASSIGNED") await catchUpOrder(no, "DIAGNOSING", me.code, str(f, "engineerCode") ?? me.code);
      return { ok: i.no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/inspect`);
  }
  return (
    <StepPage order={order} title={u("step_inspect")} error={error} kind="inspection" uploadTitle={u("upInspectTitle")} uploadHint={u("upInspectHint")} saveLabel={u("saveAndReport")}>
      <form id="f" action={save} className="space-y-4">
        <Card title={u("basicInfo")}>
          <Grid>
            <Field label={t("asset")} required><select name="assetCode" className={inputCls}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code} · S/N {l.asset.serialNumber}</option>)}</select></Field>
            <Field label={u("inspector")}><select name="engineerCode" defaultValue={order.assignee?.code} className={inputCls}>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("inspectedAt")}><input name="inspectedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
            <Field label={u("inspectPlace")} required><select name="location" defaultValue={order.documents.some((d) => d.type === "ER") ? "WORKSHOP" : "SITE"} className={inputCls}><option value="SITE">{u("locSite")}</option><option value="WORKSHOP">{u("locWorkshop")}</option></select></Field>
          </Grid>
        </Card>
        <Card title={u("inspectSteps")}>
          <Field label={u("reportedSymptomEditable")}><textarea name="symptoms" rows={2} defaultValue={[order.reportedSymptom, order.reportedAlarm].filter(Boolean).join(" · ")} className={`${inputCls} font-semibold text-fault`} /></Field>
          <Field label={u("testConditions")} required><textarea name="conditions" required rows={2} className={inputCls} /></Field>
          <Field label={u("findings")} required><textarea name="findings" required rows={3} className={inputCls} /></Field>
          <Field label={t("probableCause")} required><input name="probableCause" required className={inputCls} /></Field>
          <Field label={u("recommendationAuth")} required><textarea name="recommendation" required rows={2} className={inputCls} /></Field>
        </Card>
        <Card title={u("evidence")}>
          <Table head={[u("testItem"), t("criterion"), t("result"), u("recordPhoto"), u("pass")]}>
            {TESTS.map((k, i) => <tr key={k}>
              <td><input name={`t_${k}`} defaultValue={i < 4 ? u(`test_${k}`) : ""} className={inputCls} /></td>
              <td><input name={`c_${k}`} className={inputCls} /></td><td><input name={`r_${k}`} className={inputCls} /></td><td><input name={`id_${k}`} className={inputCls} /></td>
              <td><select name={`p_${k}`} className={inputCls}><option value="">—</option><option value="yes">{u("yes")}</option><option value="no">{u("no")}</option></select></td>
            </tr>)}
          </Table>
          <Grid>
            <Field label={u("instrumentCal")}><input name="instruments" className={inputCls} /></Field>
            <Field label={u("attachmentRefs")}><input name="attachmentRefs" placeholder="P1–P3, M1, LOG" className={inputCls} /></Field>
            <Field label={u("openIssues")}><input name="openIssues" className={inputCls} /></Field>
          </Grid>
          <Field label={u("conclusionLimits")}><input name="conclusion" className={inputCls} /></Field>
        </Card>
      </form>
    </StepPage>
  );
}
