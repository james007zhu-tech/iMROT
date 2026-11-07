import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { advanceServiceOrder } from "@/server/slm";
import { createRepairJob } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { RevealRows } from "@/components/RevealRows";
import { openJob } from "@/lib/drafts";
import { Card, Field, Grid, Table, Tag, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";
const TESTS = ["visual", "electrical", "noLoad", "load", "extra1"] as const;
const PARTS = 6;

/** 维修单 RPTH — wireframe 7. Maintenance is a different form (PMTH, ./maintain). */
export default async function Repair({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const engineers = await prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const outs = order.stockMovements.filter((m) => m.direction === "OUT");
  const insp = order.inspections.at(-1);
  // An unfinished RPTH (saved as draft) is reopened here and saved onto the same number.
  const draft = openJob(order.repairJobs, { maintenance: false, orderStatus: order.status });
  const dParts = (draft?.partsReplaced as { partSku: string; name?: string; qty: number; newSerial?: string; oldSerial?: string; obthNo?: string; oldDisposition?: string }[] | null) ?? [];
  // Parts: what the draft already holds, plus stock-outs made since that it does not list yet. Every prefilled row is shown.
  const partRows = [...dParts, ...outs.filter((m) => !dParts.some((p) => p.obthNo === m.no && p.partSku === m.part.sku)).map((m) => ({ partSku: m.part.sku, name: m.part.name ?? undefined, qty: Number(m.qty), obthNo: m.no, newSerial: undefined, oldSerial: undefined, oldDisposition: undefined }))].slice(0, PARTS);
  const dTests = (draft?.tests as { test: string; criterion?: string; result?: string; recordId?: string; pass?: boolean }[] | null) ?? [];
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const finished = f.get("draft") !== "1"; // only the "save draft" button posts draft=1
      const tests = TESTS.map((k) => ({ test: str(f, `t_${k}`) ?? "", criterion: str(f, `c_${k}`), result: str(f, `r_${k}`), recordId: str(f, `id_${k}`), pass: f.get(`p_${k}`) ? f.get(`p_${k}`) === "yes" : undefined })).filter((x) => x.test && (x.criterion || x.result));
      const parts = Array.from({ length: PARTS }, (_, i) => ({ partSku: str(f, `ps${i}`) ?? "", name: str(f, `pn${i}`), qty: num(f, `pq${i}`) ?? 0, newSerial: str(f, `pnew${i}`), oldSerial: str(f, `pold${i}`), obthNo: str(f, `pob${i}`), oldDisposition: (str(f, `pdisp${i}`) as "SCRAP" | undefined) })).filter((p) => p.partSku && p.qty > 0);
      const job = await createRepairJob({ serviceOrderNo: no, assetCode: String(f.get("assetCode")), engineerCode: str(f, "engineerCode") ?? me.code, kind: (str(f, "kind") as "REPAIR") ?? "REPAIR", location: f.get("location") as "SITE", startedAt: str(f, "startedAt") ? new Date(str(f, "startedAt")!) : undefined, finishedAt: finished ? (str(f, "finishedAt") ? new Date(str(f, "finishedAt")!) : new Date()) : undefined, confirmedFault: str(f, "confirmedFault"), rootCause: str(f, "rootCause"), workPerformed: str(f, "workPerformed"), partsReplaced: parts, configBackupRef: str(f, "configBackupRef"), laborHours: num(f, "laborHours"), travelCost: num(f, "travelCost"), tests, openIssues: str(f, "openIssues"), conclusion: str(f, "conclusion"), attachments: atts(f) });
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } });
      if (finished && cur.status === "IN_PROGRESS") await advanceServiceOrder(no, "ACCEPTANCE_PENDING", me.code);
      return { ok: job.no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/repair`);
  }
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  return (
    <StepPage order={order} title={u("step_repair")} badge={draft ? <Tag><span className="font-mono">{draft.no}</span> · {u("dn_DRAFT")}</Tag> : undefined} error={error} kind="repair" uploadTitle={u("upRepairTitle")} uploadHint={u("upRepairHint")} saveLabel={u("finishToAcceptance")}
      extraActions={<button form="f" name="draft" value="1" formNoValidate className="inline-flex min-h-10 items-center rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold">{u("saveDraft")}</button>}>
      <form id="f" action={save} className="space-y-4">
        <Card title={u("basicInfo")}>
          <Grid>
            <Field label={t("asset")} required><select name="assetCode" defaultValue={order.assets.find((l) => l.assetId === draft?.assetId)?.asset.code} className={inputCls}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code} · S/N {l.asset.serialNumber}</option>)}</select></Field>
            <Field label={u("engineer")}><select name="engineerCode" defaultValue={engineers.find((e) => e.id === draft?.engineerId)?.code ?? order.assignee?.code} className={inputCls}>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("repairMethod")} required><select name="kind" defaultValue={draft?.kind} className={inputCls}><option value="REPAIR">{u("kindRepair")}</option><option value="OVERHAUL">{u("kindOverhaul")}</option><option value="FIELD_SERVICE">{u("kindField")}</option></select></Field>
            <Field label={u("place")} required><select name="location" defaultValue={draft?.location ?? (order.documents.some((d) => d.type === "ER") ? "WORKSHOP" : "SITE")} className={inputCls}><option value="WORKSHOP">{u("locWorkshop")}</option><option value="SITE">{u("locSite")}</option></select></Field>
            <Field label={u("startedAt")}><input name="startedAt" type="datetime-local" defaultValue={local(draft?.startedAt ?? new Date())} className={inputCls} /></Field>
            <Field label={u("finishedAt")}><input name="finishedAt" type="datetime-local" className={inputCls} /></Field>
          </Grid>
        </Card>
        <Card title={u("repairSteps")}>
          <Grid cols={2}>
            <Field label={u("confirmedFault")} required><textarea name="confirmedFault" required rows={2} defaultValue={draft?.confirmedFault ?? insp?.findings ?? ""} className={inputCls} /></Field>
            <Field label={u("rootCause")} required><textarea name="rootCause" required rows={2} defaultValue={draft?.rootCause ?? insp?.probableCause ?? ""} className={inputCls} /></Field>
          </Grid>
          <Field label={u("workPerformed")} required><textarea name="workPerformed" required rows={3} defaultValue={draft?.workPerformed ?? ""} className={inputCls} /></Field>
          <div className="text-[13px] text-navy/80">{u("partsReplaced")}</div>
          <RevealRows initial={Math.max(partRows.length, 1)} addLabel={u("addPart")}>
            {Array.from({ length: PARTS }, (_, i) => { const dp = partRows[i]; return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[1.4fr_1.4fr_70px_1fr_1fr_1.2fr_1fr]">
                <input name={`ps${i}`} defaultValue={dp?.partSku ?? ""} placeholder={u("partSku")} className={inputCls} />
                <input name={`pn${i}`} defaultValue={dp?.name ?? ""} placeholder={t("name")} className={inputCls} />
                <input name={`pq${i}`} type="number" step="1" defaultValue={dp ? dp.qty : ""} placeholder={t("qty")} className={inputCls} />
                <input name={`pnew${i}`} defaultValue={dp?.newSerial ?? ""} placeholder={u("newSerial")} className={inputCls} />
                <input name={`pold${i}`} defaultValue={dp?.oldSerial ?? ""} placeholder={u("oldSerial")} className={inputCls} />
                <select name={`pdisp${i}`} defaultValue={dp?.oldDisposition} className={inputCls}><option value="SCRAP">{u("dispScrap")}</option><option value="RETURN_TO_CUSTOMER">{u("dispReturn")}</option><option value="KEEP_FOR_ANALYSIS">{u("dispKeep")}</option></select>
                <input name={`pob${i}`} defaultValue={dp?.obthNo ?? ""} placeholder="OBTH" className={inputCls} />
              </div>); })}
          </RevealRows>
          <Grid>
            <Field label={u("paramBackup")}><input name="configBackupRef" defaultValue={draft?.configBackupRef ?? ""} className={inputCls} /></Field>
            <Field label={u("laborHours")}><input name="laborHours" type="number" step="0.5" defaultValue={draft?.laborHours != null ? Number(draft.laborHours) : ""} className={inputCls} /></Field>
            <Field label={`${u("travelOtherCost")} (${order.currency})`}><input name="travelCost" type="number" step="0.01" min={0} defaultValue={draft?.travelCost != null ? Number(draft.travelCost) : ""} className={inputCls} /></Field>
          </Grid>
        </Card>
        <Card title={u("testVerify")}>
          <Table head={[u("testItem"), t("criterion"), t("result"), u("recordPhoto"), u("pass")]}>
            {TESTS.map((k, i) => <tr key={k}>
              <td><input name={`t_${k}`} defaultValue={dTests[i]?.test ?? (i < 4 ? u(`test_${k}`) : "")} className={inputCls} /></td>
              <td><input name={`c_${k}`} defaultValue={dTests[i]?.criterion ?? ""} className={inputCls} /></td><td><input name={`r_${k}`} defaultValue={dTests[i]?.result ?? ""} className={inputCls} /></td><td><input name={`id_${k}`} defaultValue={dTests[i]?.recordId ?? ""} className={inputCls} /></td>
              <td><select name={`p_${k}`} defaultValue={dTests[i]?.pass === true ? "yes" : dTests[i]?.pass === false ? "no" : ""} className={inputCls}><option value="">—</option><option value="yes">{u("yes")}</option><option value="no">{u("no")}</option></select></td>
            </tr>)}
          </Table>
          <Grid cols={2}>
            <Field label={u("openIssues")}><input name="openIssues" defaultValue={draft?.openIssues ?? ""} className={inputCls} /></Field>
            <Field label={u("conclusionLimits")}><input name="conclusion" defaultValue={draft?.conclusion ?? ""} className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </StepPage>
  );
}
