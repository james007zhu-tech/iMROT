import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { advanceServiceOrder, createServiceOrder } from "@/server/slm";
import { createRepairJob } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { RevealRows } from "@/components/RevealRows";
import { maskName } from "@/lib/mask";
import { Card, Field, Grid, Table, Tag, Value, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";
const ROWS = 20;

/**
 * 维护保养单 PMTH — wireframe 7b. The checklist comes from the model's maintenance standards; the deliverable is
 * what was found and fixed, and the next due date. Hazards can be turned into a new repair order in one tick.
 */
export default async function Maintain({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getLocale()]);
  const asset = order.assets[0]?.asset;
  const draft = order.repairJobs.find((j) => !j.finishedAt && j.kind === "MAINTENANCE");
  const [standards, last, engineers, contacts] = await Promise.all([
    asset?.model ? prisma.maintenanceStandard.findMany({ where: { seriesId: asset.model.seriesId, OR: [{ modelId: null }, { modelId: asset.model.id }] }, orderBy: { item: "asc" } }) : Promise.resolve([]),
    asset ? prisma.repairJob.findFirst({ where: { assetId: asset.id, kind: "MAINTENANCE", serviceOrderId: { not: order.id } }, orderBy: { startedAt: "desc" } }) : Promise.resolve(null),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.contact.findMany({ where: { customerId: order.customerId }, orderBy: { name: "asc" } }),
  ]);
  const cond = (asset?.operatingConditions as Record<string, unknown> | null) ?? {};
  const fmt = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d);
  const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const finished = !f.getAll("finish").includes("0");
      // In-contract work has no quote step: move the order to IN_PROGRESS before the job is recorded.
      const before = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true, kind: true } });
      if (before.kind === "CONTRACT" && before.status === "ASSIGNED") await advanceServiceOrder(no, "DIAGNOSING", me.code);
      if (before.kind === "CONTRACT" && ["ASSIGNED", "DIAGNOSING"].includes(before.status)) await advanceServiceOrder(no, "IN_PROGRESS", me.code, "CONTRACT");
      const checklist = Array.from({ length: ROWS }, (_, i) => ({ item: str(f, `i${i}`) ?? "", criterion: str(f, `c${i}`), measured: str(f, `m${i}`), verdict: str(f, `v${i}`) as "OK" | undefined, photo: str(f, `ph${i}`) })).filter((x) => x.item && (x.measured || x.verdict));
      const job = await createRepairJob({
        serviceOrderNo: no, assetCode: String(f.get("assetCode")), engineerCode: str(f, "engineerCode") ?? me.code, kind: "MAINTENANCE", location: f.get("location") as "SITE",
        startedAt: str(f, "startedAt") ? new Date(str(f, "startedAt")!) : undefined, finishedAt: finished ? (str(f, "finishedAt") ? new Date(str(f, "finishedAt")!) : new Date()) : undefined,
        level: str(f, "level") as "ANNUAL", runHours: num(f, "runHours"), checklist, hazards: str(f, "hazards"), handled: str(f, "handled"), recommendation: str(f, "recommendation"),
        conditionRating: str(f, "conditionRating") as "GOOD", nextDueAt: str(f, "nextDueAt") ? new Date(str(f, "nextDueAt")!) : undefined, nextDueHours: num(f, "nextDueHours"),
        laborHours: num(f, "laborHours"), consumables: str(f, "consumables"), escortContactId: str(f, "escortContactId"), workPerformed: str(f, "handled"), openIssues: str(f, "hazards"), conclusion: str(f, "recommendation"), attachments: atts(f),
      });
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true, customerId: true, plantId: true } });
      if (finished && cur.status === "IN_PROGRESS") await advanceServiceOrder(no, "ACCEPTANCE_PENDING", me.code);
      let follow = "";
      if (f.get("hazardToRepair") === "on" && str(f, "hazards")) {
        const o = await createServiceOrder({ createdByEmployeeCode: me.code, customerId: cur.customerId, plantId: cur.plantId ?? undefined, assetCodes: [String(f.get("assetCode"))], kind: "REPAIR", reportedSymptom: str(f, "hazards"), productionImpact: "NONE", customerRef: undefined });
        follow = ` → ${o.no}`;
      }
      return { ok: `${job.no}${follow}`, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/maintain`);
  }
  // A saved draft comes back with what was measured; otherwise the checklist starts from the model's standards.
  const saved = (draft?.checklist as { item: string; criterion?: string; measured?: string; verdict?: string; photo?: string }[] | null) ?? [];
  const rows = saved.length ? saved.map((x) => ({ item: x.item, criterion: x.criterion ?? "", measured: x.measured ?? "", verdict: x.verdict ?? "", photo: x.photo ?? "" })) : standards.map((s) => ({ item: s.item, criterion: s.criterion ?? "", measured: "", verdict: "", photo: "" }));
  const outs = [...new Map(order.stockMovements.filter((m) => m.direction === "OUT").map((m) => [m.id, `${m.part.sku} ${m.part.name ?? ""} ×${Number(m.qty)}`])).values()].join("; ");
  return (
    <StepPage order={order} title={u("step_maintain")} badge={draft ? <Tag><span className="font-mono">{draft.no}</span> · {u("dn_DRAFT")}</Tag> : undefined} error={error} kind="maintenance" uploadTitle={u("upMaintTitle")} uploadHint={u("upMaintHint")} saveLabel={u("finishToAcceptance")}
      extraActions={<button form="f" name="finish" value="0" className="inline-flex min-h-10 items-center rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold">{u("saveDraft")}</button>}>
      <form id="f" action={save} className="space-y-4">
        <input type="hidden" name="finish" value="1" />
        <Card title={u("basicInfo")}>
          <Grid>
            <Field label={t("asset")} required><select name="assetCode" defaultValue={order.assets.find((l) => l.assetId === draft?.assetId)?.asset.code} className={inputCls}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code} · S/N {l.asset.serialNumber}</option>)}</select></Field>
            <Field label={u("engineer")}><select name="engineerCode" defaultValue={engineers.find((e) => e.id === draft?.engineerId)?.code ?? order.assignee?.code} className={inputCls}>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("pmLevel")} required><select name="level" defaultValue={draft?.level ?? undefined} className={inputCls}><option value="QUARTERLY">{u("lvlQuarterly")}</option><option value="HALF_YEAR">{u("lvlHalf")}</option><option value="ANNUAL">{u("lvlAnnual")}</option><option value="CONTRACT">{u("lvlContract")}</option></select></Field>
            <Field label={u("place")} required><select name="location" defaultValue={draft?.location} className={inputCls}><option value="SITE">{u("locSite")}</option><option value="WORKSHOP">{u("locWorkshop")}</option></select></Field>
            <Field label={u("startedAt")}><input name="startedAt" type="datetime-local" defaultValue={local(draft?.startedAt ?? new Date())} className={inputCls} /></Field>
            <Field label={u("finishedAt")}><input name="finishedAt" type="datetime-local" className={inputCls} /></Field>
            <Field label={u("lastPm")}><Value>{last ? `${last.no} · ${fmt(last.startedAt ?? new Date())}${last.runHours != null ? ` · ${last.runHours} h` : ""}` : "—"}</Value></Field>
            <Field label={u("runHoursNow")}><input name="runHours" type="number" defaultValue={draft?.runHours ?? ""} className={inputCls} /></Field>
            <Field label={u("conditionsFromFile")}><Value>{[cond.environment, cond.loadType, cond.hoursPerDay ? `${cond.hoursPerDay} h/d` : ""].filter(Boolean).join(" · ") || "—"}</Value></Field>
          </Grid>
        </Card>
        <Card title={u("pmChecklist")}>
          {rows.length === 0 && <p className="text-xs text-navy/70">{u("noStandards")}</p>}
          <Table head={["#", u("item"), u("standardCriterion"), u("measured"), u("verdict"), u("photo")]}>
            {Array.from({ length: Math.max(rows.length, 1) }, (_, i) => (
              <tr key={i}><td>{i + 1}</td><td><input name={`i${i}`} defaultValue={rows[i]?.item ?? ""} className={inputCls} /></td><td><input name={`c${i}`} defaultValue={rows[i]?.criterion ?? ""} className={inputCls} /></td><td><input name={`m${i}`} defaultValue={rows[i]?.measured ?? ""} className={inputCls} /></td>
                <td><select name={`v${i}`} defaultValue={rows[i]?.verdict ?? ""} className={inputCls}><option value="">—</option><option value="OK">{u("vOk")}</option><option value="HANDLED">{u("vHandled")}</option><option value="HAZARD">{u("vHazard")}</option><option value="WATCH">{u("vWatch")}</option></select></td><td><input name={`ph${i}`} defaultValue={rows[i]?.photo ?? ""} className={inputCls} /></td></tr>
            ))}
          </Table>
          <RevealRows initial={0} addLabel={u("addItemOnce")}>
            {Array.from({ length: ROWS - Math.max(rows.length, 1) }, (_, k) => { const i = k + Math.max(rows.length, 1); return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_2fr_1.5fr_1fr_1fr]"><input name={`i${i}`} placeholder={u("item")} className={inputCls} /><input name={`c${i}`} placeholder={u("standardCriterion")} className={inputCls} /><input name={`m${i}`} placeholder={u("measured")} className={inputCls} /><select name={`v${i}`} className={inputCls}><option value="">—</option><option value="OK">{u("vOk")}</option><option value="HANDLED">{u("vHandled")}</option><option value="HAZARD">{u("vHazard")}</option><option value="WATCH">{u("vWatch")}</option></select><input name={`ph${i}`} placeholder={u("photo")} className={inputCls} /></div>); })}
          </RevealRows>
        </Card>
        <Card title={u("pmResult")}>
          <Grid cols={2}>
            <Field label={u("hazardsFound")} required><textarea name="hazards" required rows={3} defaultValue={draft?.hazards ?? ""} className={`${inputCls} font-semibold text-fault`} /></Field>
            <Field label={u("handledNow")} required><textarea name="handled" required rows={3} defaultValue={draft?.handled ?? ""} className={inputCls} /></Field>
          </Grid>
          <Grid>
            <Field label={u("recommendation")} required><input name="recommendation" required defaultValue={draft?.recommendation ?? ""} className={inputCls} /></Field>
            <Field label={u("conditionRating")}><select name="conditionRating" defaultValue={draft?.conditionRating ?? undefined} className={inputCls}><option value="GOOD">{u("rateGood")}</option><option value="GOOD_WITH_ISSUE">{u("rateIssue")}</option><option value="POOR">{u("ratePoor")}</option></select></Field>
            <Field label={u("nextPm")}><div className="flex gap-2"><input name="nextDueAt" type="date" defaultValue={draft?.nextDueAt ? draft.nextDueAt.toISOString().slice(0, 10) : ""} className={inputCls} /><input name="nextDueHours" type="number" placeholder="+h" defaultValue={draft?.nextDueHours ?? ""} className={inputCls} /></div></Field>
            <Field label={u("laborHours")}><input name="laborHours" type="number" step="0.5" defaultValue={draft?.laborHours != null ? Number(draft.laborHours) : ""} className={inputCls} /></Field>
            <Field label={u("consumablesUsed")}><input name="consumables" defaultValue={draft?.consumables ?? outs} className={inputCls} /></Field>
            <Field label={u("customerEscort")}><select name="escortContactId" defaultValue={draft?.escortContactId ?? ""} className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)}{c.title ? ` · ${c.title}` : ""}</option>)}</select></Field>
          </Grid>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hazardToRepair" /> {u("hazardToRepair")}</label>
        </Card>
      </form>
    </StepPage>
  );
}
