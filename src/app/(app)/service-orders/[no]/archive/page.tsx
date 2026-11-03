import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { appendAssetEvent } from "@/server/alm";
import { addFaultCode, addMaintenanceStandard } from "@/server/models";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, inputCls } from "@/components/ui";
import { StepPage, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 案例归档 (step 10): root cause and lesson back onto each asset, optionally into the series' fault codes / maintenance standards. */
export default async function Archive({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const u = await getTranslations("ui");
  const job = order.repairJobs.at(-1);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { assets: { include: { asset: { include: { model: true } } } } } });
      const rootCause = str(f, "rootCause") ?? "";
      const lesson = str(f, "lesson") ?? "";
      for (const l of o.assets) {
        await appendAssetEvent({ assetCode: l.asset.code, type: "CASE_ARCHIVED", actorEmployeeCode: me.code, serviceOrderNo: no, sourceDocNo: no, summary: rootCause || lesson, payload: { rootCause, lesson, checks: str(f, "checks") } });
        const m = l.asset.model;
        if (m && f.get("toFaultCode") === "on" && o.reportedAlarm) await addFaultCode(m.seriesId, undefined, o.reportedAlarm, rootCause.slice(0, 80), lesson, str(f, "checks"));
        if (m && f.get("toMaintenance") === "on" && str(f, "maintItem")) await addMaintenanceStandard(m.seriesId, undefined, str(f, "maintItem")!, num(f, "maintMonths"), undefined, lesson);
      }
      return { ok: "archived", to: `/service-orders/${no}` };
    }, `/service-orders/${no}/archive`);
  }
  return (
    <StepPage order={order} title={u("step_archive")} error={error} saveLabel={u("archiveSave")}>
      <form id="f" action={save}>
        <Card title={u("caseLesson")}>
          <Grid cols={2}>
            <Field label={u("rootCause")} required><textarea name="rootCause" required rows={2} defaultValue={job?.rootCause ?? job?.hazards ?? ""} className={inputCls} /></Field>
            <Field label={u("lesson")} required><textarea name="lesson" required rows={2} className={inputCls} /></Field>
          </Grid>
          <Field label={u("checkSteps")}><input name="checks" className={inputCls} /></Field>
          {order.reportedAlarm && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="toFaultCode" /> {u("toFaultCode", { code: order.reportedAlarm })}</label>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="toMaintenance" /> {u("toMaintenance")}</label>
          <Grid cols={2}>
            <Field label={u("item")}><input name="maintItem" className={inputCls} /></Field>
            <Field label={u("everyNMonths")}><input name="maintMonths" type="number" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </StepPage>
  );
}
