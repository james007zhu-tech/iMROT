import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { findModelByCode, onboardAsset, relateAssets } from "@/server/alm";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { ModelPicker } from "@/components/ModelPicker";
import { SerialInput } from "@/components/SerialInput";
import { Alert, Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 新增设备 (建档 / 接管) — wireframe 2. Six required items; ATH is allocated by the server. */
export default async function NewAsset({ searchParams }: { searchParams: Promise<{ error?: string; customerId?: string }> }) {
  const { error, customerId } = await searchParams;
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("assetStatus")]);
  const [customers, models, employees, others] = await Promise.all([
    prisma.customer.findMany({ orderBy: { name: "asc" }, include: { plants: true } }),
    prisma.model.findMany({ include: { series: { include: { brand: true } } }, orderBy: { code: "asc" } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.asset.findMany({ where: { type: { in: ["MOTOR", "PANEL", "PLC"] } }, select: { code: true, type: true, serialNumber: true, customer: { select: { name: true } } }, orderBy: { code: "desc" }, take: 300 }),
  ]);

  async function submit(form: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const serial = String(form.get("serialNumber") ?? "").trim();
      const modelCode = String(form.get("modelCode") ?? "").trim();
      const model = modelCode ? await findModelByCode(modelCode) : null;
      if (modelCode && !model) throw new Error(`MODEL_UNKNOWN:${modelCode}`);
      const dup = await prisma.asset.findFirst({ where: { serialNumber: { equals: serial, mode: "insensitive" } }, include: { customer: { select: { name: true } }, plant: { select: { code: true } } } });
      if (dup) throw new Error(`SERIAL_EXISTS:${serial}:${dup.code}:${dup.customer?.name ?? ""}${dup.plant ? ` · ${dup.plant.code}` : ""}`);
      const atts = JSON.parse(String(form.get("attachments") || "[]")) as { name: string; url: string; kind: string }[];
      const num = (k: string) => (form.get(k) ? Number(form.get(k)) : undefined);
      const txt = (k: string) => String(form.get(k) ?? "").trim() || undefined;
      const asset = await onboardAsset({
        createdByEmployeeCode: me.code,
        type: form.get("type") as "VFD",
        origin: form.get("origin") as "TAKEOVER",
        initialStatus: form.get("initialStatus") as "IN_SERVICE",
        serialNumber: serial,
        modelId: model?.id,
        customerId: String(form.get("customerId")),
        plantId: txt("plantId"),
        location: txt("location"),
        responsibleEmployeeId: txt("responsibleEmployeeId"),
        customerAssetNo: txt("customerAssetNo"),
        installedAt: form.get("installedAt") ? new Date(String(form.get("installedAt"))) : undefined,
        nameplatePhoto: atts[0]?.url,
        configuration: { ratedPowerKw: num("ratedPowerKw"), ratedVoltageV: num("ratedVoltageV"), ratedCurrentA: num("ratedCurrentA"), options: txt("options"), photos: atts },
        operatingConditions: { loadType: txt("loadType"), hoursPerDay: num("hoursPerDay"), environment: txt("environment"), grid: txt("grid") },
      });
      for (const rel of ["DRIVES", "INSTALLED_IN", "CONTROLLED_BY"] as const) {
        const to = txt(`rel_${rel}`);
        if (to) await relateAssets({ fromCode: asset.code, toCode: to, relation: rel, actorEmployeeCode: me.code });
      }
      return { ok: asset.code, to: form.get("print") ? `/assets/${asset.code}/label` : `/assets/${asset.code}` };
    }, "/assets/new");
  }

  // Server errors come back as codes so the warning can be shown in the viewer's language.
  const [code, a1, a2, a3] = (error ?? "").split(":");
  const known = code === "SERIAL_EXISTS" || code === "MODEL_UNKNOWN";
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/assets", label: u("backToAssets") }} title={u("newAsset")}
        actions={<><Link href="/assets" className={btnGhost}>{t("cancel")}</Link><button form="f" name="print" value="1" className={btnGhost}>{u("savePrintLabel")}</button><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      {error && !known && <Flash error={error} />}
      <FormMemory formId="f" />
      <UploadRecognize kind="asset" formId="f" title={u("upAssetTitle")} hint={u("upAssetHint")} />
      <form id="f" action={submit} className="space-y-4">
        <Card title={u("identity")}>
          <Grid>
            <Field label={t("type")} required><select name="type" className={inputCls}>{["VFD", "MOTOR", "PLC", "PANEL", "DRIVE_TRAIN", "SENSOR", "OTHER"].map((x) => <option key={x} value={x}>{t(x)}</option>)}</select></Field>
            <Field label={t("origin")} required><select name="origin" className={inputCls}><option value="TAKEOVER">{t("TAKEOVER")}</option><option value="NEW_INSTALL">{t("NEW_INSTALL")}</option></select></Field>
            <Field label={u("initialStatus")} required><select name="initialStatus" className={inputCls}><option value="IN_SERVICE">{ts("IN_SERVICE")}</option><option value="ONBOARDED">{ts("ONBOARDED")}</option><option value="SPARE">{ts("SPARE")}</option></select></Field>
            <ModelPicker models={models.map((m) => ({ brand: m.series.brand.name, series: m.series.name, code: m.code }))} inputCls={inputCls} labels={{ brand: u("brand"), series: u("series"), model: u("modelCodeLabel"), unknown: u("modelNotInLibrary") }} />
            <Field label={u("serialLabel")} required><SerialInput inputCls={inputCls} text={u("serialExists", { serial: "{serial}", code: "{code}", where: "{where}" })} /></Field>
            <Field label={t("customer")} required><select name="customerId" required defaultValue={customerId ?? ""} className={inputCls}><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label={u("plantWorkshop")}><select name="plantId" className={inputCls}><option value="">—</option>{customers.flatMap((c) => c.plants.map((p) => <option key={p.id} value={p.id}>{c.name} · {p.code} {p.name}</option>))}</select></Field>
            <Field label={u("locationPosition")} required><input name="location" required className={inputCls} /></Field>
            <Field label={t("responsible")} required><select name="responsibleEmployeeId" required className={inputCls}><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={t("customerAssetNo")}><input name="customerAssetNo" className={inputCls} /></Field>
          </Grid>
          {code === "SERIAL_EXISTS" && <Alert>{u("serialExists", { serial: a1, code: a2, where: a3 })} <Link className="underline" href={`/assets/${a2}`}>{a2}</Link></Alert>}
          {code === "MODEL_UNKNOWN" && <Alert>{u("modelUnknown", { model: a1 })} <Link className="underline" href="/models">{u("modelLibrary")}</Link></Alert>}
        </Card>
        <Card title={u("configConditions")}>
          <Grid>
            <Field label={u("ratedPower")}><input name="ratedPowerKw" type="number" step="0.01" className={inputCls} /></Field>
            <Field label={u("ratedVoltage")}><input name="ratedVoltageV" type="number" className={inputCls} /></Field>
            <Field label={u("ratedCurrent")}><input name="ratedCurrentA" type="number" step="0.01" className={inputCls} /></Field>
            <Field label={u("options")}><input name="options" className={inputCls} /></Field>
            <Field label={u("loadType")}><input name="loadType" className={inputCls} /></Field>
            <Field label={u("hoursPerDay")}><input name="hoursPerDay" type="number" className={inputCls} /></Field>
            <Field label={u("environment")}><input name="environment" className={inputCls} /></Field>
            <Field label={u("grid")}><input name="grid" className={inputCls} /></Field>
            <Field label={t("installedAt")}><input name="installedAt" type="date" className={inputCls} /></Field>
          </Grid>
        </Card>
        <Card title={u("relatedAssets")}>
          <Grid>
            {(["DRIVES", "INSTALLED_IN", "CONTROLLED_BY"] as const).map((r) => (
              <Field key={r} label={u(`rel_${r}`)}>
                <select name={`rel_${r}`} className={inputCls}><option value="">—</option>{others.filter((o) => (r === "DRIVES" ? o.type === "MOTOR" : r === "INSTALLED_IN" ? o.type === "PANEL" : o.type === "PLC")).map((o) => <option key={o.code} value={o.code}>{o.code} · {o.customer?.name ?? ""} · S/N {o.serialNumber}</option>)}</select>
              </Field>
            ))}
          </Grid>
        </Card>
      </form>
    </div>
  );
}
