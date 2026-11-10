import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { savePlan } from "@/server/project";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { PHASES, type Phase, type ProjectInfo } from "@/lib/project";
import type { RequestLine } from "@/lib/modes";
import { RevealRows } from "@/components/RevealRows";
import { Alert, Card, Field, Grid, inputCls } from "@/components/ui";
import { StepPage, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";
const BOM_ROWS = 30, LAB_ROWS = 8, DLV_ROWS = 6;

/**
 * 方案与 BOM (自动化项目, flow 2026-11-09): the solution, what is delivered, the bill of materials (shortages raise one
 * PRTH, the quote starts from it), labour, and the nine milestones with the payment split and planned dates. Once the
 * customer's PO is in, BOM, labour and split are fixed (they are the contract); dates and texts can still change.
 */
export default async function Plan({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  if (order.mode !== "AUTOMATION_PROJECT") notFound();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [parts, milestones] = await Promise.all([
    prisma.part.findMany({ orderBy: { sku: "asc" }, take: 800, select: { sku: true, name: true, lastCost: true } }),
    prisma.projectMilestone.findMany({ where: { serviceOrderId: order.id }, orderBy: { seq: "asc" } }),
  ]);
  const info = (order.project as unknown as ProjectInfo | null) ?? { name: order.no };
  const bom = (order.requestLines as RequestLine[] | null) ?? [];
  const frozen = !["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING"].includes(order.status);
  const pct = (v: unknown) => (v == null ? "" : String(Math.round(Number(v) * 1000) / 10));
  const sum = milestones.reduce((s, m) => s + Number(m.payPct ?? 0), 0);

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const r = await savePlan({
        no, actorCode: me.code, solution: str(f, "solution"), dueDate: str(f, "projectDue"), scope: str(f, "projectScope"),
        deliverables: Array.from({ length: DLV_ROWS }, (_, i) => ({ name: str(f, `vn${i}`) ?? "", qty: num(f, `vq${i}`) ?? 0 })),
        bom: Array.from({ length: BOM_ROWS }, (_, i) => ({ sku: str(f, `bs${i}`), description: str(f, `bd${i}`), qty: num(f, `bq${i}`), unit: str(f, `bu${i}`), neededBy: str(f, `bn${i}`) })),
        labour: Array.from({ length: LAB_ROWS }, (_, i) => ({ description: str(f, `ld${i}`) ?? "", hours: num(f, `lh${i}`) ?? 0, costPerHour: num(f, `lc${i}`) })),
        milestones: PHASES.map((p) => ({ phase: p, payPct: num(f, `mp_${p}`) ? (num(f, `mp_${p}`) as number) / 100 : null, plannedOn: str(f, `md_${p}`) })),
      });
      return { ok: [r.no, r.prth].filter(Boolean).join(" · "), to: `/service-orders/${no}` };
    }, `/service-orders/${no}/plan`);
  }

  return (
    <StepPage order={order} title={u("step_plan")} error={error} ok={ok} kind="project" uploadTitle={u("upProjectTitle")} uploadHint={u("upProjectHint")}
      lineFields={{ sku: "bs", description: "bd", qty: "bq", unit: "bu" }} saveLabel={order.lockedAt ? "" : u("savePlan")}>
      <form id="f" action={save} className="space-y-4">
        {frozen && <Alert>{u("planFrozen")}</Alert>}
        <Card title={info.name}>
          <Grid>
            <Field label={u("projectDue")}><input name="projectDue" type="date" defaultValue={info.dueDate ?? ""} className={inputCls} /></Field>
          </Grid>
          <Field label={u("projectScope")}><textarea name="projectScope" rows={2} defaultValue={info.scope ?? ""} className={inputCls} /></Field>
          <Field label={u("projectSolution")}><textarea name="solution" rows={5} defaultValue={info.solution ?? ""} placeholder={u("projectSolutionPh")} className={inputCls} /></Field>
        </Card>

        <Card title={u("projectDeliverables")}>
          <RevealRows initial={Math.max(1, (info.deliverables ?? []).length)} addLabel={u("addLine")}>
            {Array.from({ length: DLV_ROWS }, (_, i) => { const d = info.deliverables?.[i]; return (
              <div key={i} className="grid grid-cols-[1fr_100px] gap-2">
                <input name={`vn${i}`} defaultValue={d?.name ?? ""} placeholder={u("deliverablePh")} className={inputCls} />
                <input name={`vq${i}`} type="number" min="0" step="1" defaultValue={d?.qty ?? ""} placeholder={t("qty")} className={inputCls} />
              </div>); })}
          </RevealRows>
          <p className="text-xs text-navy/70">{u("deliverablesHint")}</p>
        </Card>

        <Card title={u("projectBom")}>
          <datalist id="bom-parts">{parts.map((p) => <option key={p.sku} value={p.sku}>{p.name}{p.lastCost != null ? ` · ${Number(p.lastCost).toFixed(2)}` : ""}</option>)}</datalist>
          <div className="hidden grid-cols-[170px_2fr_90px_70px_150px] gap-2 text-xs text-navy/70 md:grid"><span>{u("partSku")}</span><span>{t("description")}</span><span>{t("qty")}</span><span>{u("unitShort")}</span><span>{u("neededBy")}</span></div>
          <RevealRows initial={Math.max(3, bom.length)} addLabel={u("addLine")}>
            {Array.from({ length: BOM_ROWS }, (_, i) => { const l = bom[i]; return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[170px_2fr_90px_70px_150px]">
                <input name={`bs${i}`} list="bom-parts" defaultValue={l?.sku ?? ""} disabled={frozen} className={`${inputCls} font-mono`} />
                <input name={`bd${i}`} defaultValue={l?.description ?? ""} disabled={frozen} className={inputCls} />
                <input name={`bq${i}`} type="number" min="0" step="0.001" defaultValue={l?.qty ?? ""} disabled={frozen} className={inputCls} />
                <input name={`bu${i}`} defaultValue={l?.unit ?? "pcs"} disabled={frozen} className={inputCls} />
                <input name={`bn${i}`} type="date" defaultValue={l?.neededBy ?? ""} disabled={frozen} className={inputCls} />
              </div>); })}
          </RevealRows>
          <p className="text-xs text-navy/70">{u("projectBomHint")}</p>
        </Card>

        <Card title={u("projectLabour")}>
          <div className="hidden grid-cols-[2fr_110px_130px] gap-2 text-xs text-navy/70 md:grid"><span>{t("description")}</span><span>{u("labourHours")}</span><span>{u("costPerHour")}</span></div>
          <RevealRows initial={Math.max(2, (info.labour ?? []).length)} addLabel={u("addLine")}>
            {Array.from({ length: LAB_ROWS }, (_, i) => { const l = info.labour?.[i]; return (
              <div key={i} className="grid grid-cols-3 gap-2 md:grid-cols-[2fr_110px_130px]">
                <input name={`ld${i}`} defaultValue={l?.description ?? ""} disabled={frozen} placeholder={u("labourPh")} className={inputCls} />
                <input name={`lh${i}`} type="number" min="0" step="0.5" defaultValue={l?.hours ?? ""} disabled={frozen} className={inputCls} />
                <input name={`lc${i}`} type="number" min="0" step="0.01" defaultValue={l?.costPerHour ?? ""} disabled={frozen} placeholder={u("costPh")} className={inputCls} />
              </div>); })}
          </RevealRows>
        </Card>

        <Card title={u("projectMilestones")}>
          <div className="grid grid-cols-[1fr_110px_160px] gap-2 text-xs text-navy/70"><span>{u("milestone")}</span><span>{u("payPct")}</span><span>{u("plannedOn")}</span></div>
          {PHASES.map((p) => { const m = milestones.find((x) => x.phase === p); return (
            <div key={p} className="mt-1 grid grid-cols-[1fr_110px_160px] items-center gap-2">
              <span className="text-sm">{m?.seq}. {u(`phase_${p as Phase}`)}{m?.doneAt ? <span className="ml-2 text-xs text-navy/60">✓ {m.doneAt.toISOString().slice(0, 10)}</span> : null}</span>
              <input name={`mp_${p}`} type="number" min="0" max="100" step="0.1" defaultValue={pct(m?.payPct)} disabled={frozen} placeholder="—" className={inputCls} />
              <input name={`md_${p}`} type="date" defaultValue={m?.plannedOn ? m.plannedOn.toISOString().slice(0, 10) : ""} className={inputCls} />
            </div>); })}
          <p className={`mt-2 text-xs ${Math.round(sum * 1000) === 1000 ? "text-navy/70" : "font-semibold text-alert-ink"}`}>{u("paySplitLine", { pct: Math.round(sum * 1000) / 10 })}</p>
        </Card>
      </form>
    </StepPage>
  );
}
