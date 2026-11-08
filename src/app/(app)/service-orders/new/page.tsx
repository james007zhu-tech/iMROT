import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { advanceServiceOrder, createServiceOrder } from "@/server/slm";
import { currentEmployee } from "@/server/auth";
import { saveUpload } from "@/lib/uploads";
import { guarded } from "@/lib/action-result";
import { maskName } from "@/lib/mask";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { AssetPicker } from "@/components/AssetPicker";
import { ScanButton } from "@/components/ScanButton";
import { Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 新增服务单 (报修 → QTTH) — wireframe 4. */
export default async function NewOrder({ searchParams }: { searchParams: Promise<{ asset?: string; customer?: string; error?: string }> }) {
  const { asset, customer, error } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [assets, engineers, contacts] = await Promise.all([
    prisma.asset.findMany({ where: { status: { not: "RETIRED" }, customer: customer ? { code: customer } : undefined }, include: { customer: true, plant: true, model: true }, orderBy: { code: "asc" } }),
    prisma.employee.findMany({ where: { active: true, role: { in: ["ENGINEER", "MANAGER", "MD", "ADMIN"] } }, orderBy: { name: "asc" } }),
    prisma.contact.findMany({ include: { customer: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  async function submit(form: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const s = (k: string) => String(form.get(k) ?? "").trim() || undefined;
      const codes = [...new Set(form.getAll("assetCodes").map(String).filter(Boolean))];
      if (!codes.length) throw new Error("ASSET_REQUIRED");
      const first = await prisma.asset.findUniqueOrThrow({ where: { code: codes[0] } });
      const boxed = JSON.parse(s("attachments") ?? "[]") as { name: string; url: string; kind: string }[];
      const po = [];
      for (const f of form.getAll("poFiles")) if (f instanceof File && f.size > 0) po.push({ ...(await saveUpload(f, "po")), name: f.name, kind: "PO" });
      const order = await createServiceOrder({
        createdByEmployeeCode: me.code, customerId: first.customerId!, plantId: first.plantId ?? undefined, assetCodes: codes,
        kind: form.get("kind") as "REPAIR", reportedSymptom: s("reportedSymptom"), reportedAlarm: s("reportedAlarm"), productionImpact: s("productionImpact"),
        customerRef: s("customerRef"), reportedByContactId: s("reportedById"), reportedAt: s("reportedAt") ? new Date(s("reportedAt")!) : undefined,
        currency: "THB", attachments: [...boxed, ...po],
      });
      if (form.get("assign") && s("assigneeCode")) {
        await advanceServiceOrder(order.no, "ASSIGNED", me.code, [s("plannedAt") ? `📅 ${s("plannedAt")!.replace("T", " ")}` : "", s("internalNote") ?? ""].filter(Boolean).join(" · ") || undefined, s("assigneeCode"));
      }
      return { ok: order.no, to: `/service-orders/${order.no}` };
    }, "/service-orders/new");
  }

  const pick = assets.map((a) => ({ code: a.code, serial: a.serialNumber, location: a.location ?? "", customer: a.customer?.name ?? "", plant: a.plant ? `${a.plant.code} ${a.plant.name}` : "", label: `${a.code} · ${a.location ?? ""} · ${a.customer?.name ?? ""}${a.plant ? ` ${a.plant.code}` : ""} · S/N ${a.serialNumber}` }));
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/service-orders", label: u("backToOrders") }} title={u("newServiceOrder")}
        actions={<><Link href="/service-orders" className={btnGhost}>{t("cancel")}</Link><button form="f" name="assign" value="1" className={btnGhost}>{u("saveAndAssign")}</button><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      <Flash error={error === "ASSET_REQUIRED" ? u("assetRequired") : error} />
      <FormMemory formId="f" />
      <UploadRecognize kind="service" formId="f" title={u("upServiceTitle")} hint={u("upServiceHint")} />
      <form id="f" action={submit} className="space-y-4">
        <Card title={u("whichAsset")}>
          <AssetPicker formId="f" assets={pick} initial={asset ? [asset] : []} labels={{ asset: t("asset"), customer: u("customerAuto"), plant: u("plantAuto"), add: u("addAnotherAsset") }} />
          <div className="flex flex-wrap items-center gap-2">
            <ScanButton compact label={u("scanDcitLabel")} hrefTemplate="/service-orders/new?asset={code}" />
            <Link href="/assets/new" className="text-sm text-blue underline">{u("assetNotListed")}</Link>
          </div>
        </Card>
        <Card title={u("reportContent")}>
          <Grid>
            <Field label={t("kind")} required><select name="kind" className={inputCls}>{["REPAIR", "MAINTENANCE", "OVERHAUL", "CONTRACT", "PARTS_SALE"].map((k) => <option key={k} value={k}>{t(k)}</option>)}</select></Field>
            <Field label={t("alarmCode")}><input name="reportedAlarm" className={`${inputCls} font-semibold text-fault`} /></Field>
            <Field label={t("impact")} required><select name="productionImpact" className={inputCls}><option value="STOPPED">{u("impactStopped")}</option><option value="DEGRADED">{u("impactDegraded")}</option><option value="NONE">{u("impactNone")}</option></select></Field>
          </Grid>
          <Field label={t("symptom")} required><textarea name="reportedSymptom" required rows={2} className={`${inputCls} font-semibold text-fault`} /></Field>
          <Grid>
            <Field label={u("customerRefVerbatim")}><input name="customerRef" className={`${inputCls} font-mono`} /></Field>
            <Field label={u("reportedBy")}><select name="reportedById" className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)} · {c.customer.name}</option>)}</select></Field>
            <Field label={t("reportedAt")}><input name="reportedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
          </Grid>
          <Field label={u("poAttachments")}><input name="poFiles" type="file" multiple accept="image/*,application/pdf" className={inputCls} /></Field>
        </Card>
        <Card title={u("dispatch")}>
          <Grid>
            <Field label={t("assignee")}><select name="assigneeCode" className={inputCls}><option value="">—</option>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("plannedVisit")}><input name="plannedAt" type="datetime-local" className={inputCls} /></Field>
            <Field label={u("internalNote")}><input name="internalNote" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </div>
  );
}
