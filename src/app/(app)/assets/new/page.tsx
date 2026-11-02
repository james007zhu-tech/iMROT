import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { onboardAsset } from "@/server/alm";
import { currentEmployee } from "@/server/auth";
import { saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** 建档 / 接管 form. Six required fields; ATH is allocated server-side from the creator's country. */
export default async function NewAsset() {
  const t = await getTranslations("common");
  const [customers, models, employees] = await Promise.all([
    prisma.customer.findMany({ orderBy: { name: "asc" }, include: { plants: true } }),
    prisma.model.findMany({ include: { series: { include: { brand: true } } }, orderBy: { code: "asc" } }),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);

  async function submit(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const photo = form.get("photo") as File | null;
    const nameplatePhoto = photo && photo.size > 0 ? (await saveUpload(photo, "nameplate")).url : undefined;
    const asset = await onboardAsset({
      nameplatePhoto,
      createdByEmployeeCode: me.code,
      type: form.get("type") as "VFD",
      serialNumber: String(form.get("serialNumber")),
      modelId: String(form.get("modelId") || "") || undefined,
      customerId: String(form.get("customerId")),
      plantId: String(form.get("plantId") || "") || undefined,
      location: String(form.get("location") || "") || undefined,
      responsibleEmployeeId: String(form.get("responsibleEmployeeId") || "") || undefined,
      origin: (form.get("origin") as "TAKEOVER") || "TAKEOVER",
      customerAssetNo: String(form.get("customerAssetNo") || "") || undefined,
      installedAt: form.get("installedAt") ? new Date(String(form.get("installedAt"))) : undefined,
    });
    redirect(`/assets/${asset.code}`);
  }

  const input = "w-full rounded border px-3 py-2 text-sm";
  return (
    <form action={submit} encType="multipart/form-data" className="mx-auto max-w-2xl space-y-3 rounded-lg border bg-white p-4">
      <h1 className="text-xl font-bold">{t("onboard")}</h1>
      <p className="text-sm text-slate-600">{t("requiredSix")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="text-sm">{t("type")}<select name="type" className={input} required>{["VFD", "MOTOR", "PLC", "PANEL", "DRIVE_TRAIN", "SENSOR", "OTHER"].map((x) => <option key={x} value={x}>{t(x)}</option>)}</select></label>
        <label className="text-sm">{t("origin")}<select name="origin" className={input}><option value="TAKEOVER">{t("TAKEOVER")}</option><option value="NEW_INSTALL">{t("NEW_INSTALL")}</option></select></label>
        <label className="text-sm">{t("serial")} *<input name="serialNumber" className={input} required /></label>
        <label className="text-sm">{t("model")} *<select name="modelId" className={input} required><option value="">—</option>{models.map((m) => <option key={m.id} value={m.id}>{m.series.brand.name} {m.series.name} {m.code}</option>)}</select></label>
        <label className="text-sm">{t("customer")} *<select name="customerId" className={input} required><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
        <label className="text-sm">{t("plant")}<select name="plantId" className={input}><option value="">—</option>{customers.flatMap((c) => c.plants.map((p) => <option key={p.id} value={p.id}>{c.code} · {p.name}</option>))}</select></label>
        <label className="text-sm">{t("location")} *<input name="location" className={input} required /></label>
        <label className="text-sm">{t("responsible")} *<select name="responsibleEmployeeId" className={input} required><option value="">—</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.code} {e.name}</option>)}</select></label>
        <label className="text-sm">{t("installedAt")}<input type="date" name="installedAt" className={input} /></label>
        <label className="text-sm">Customer asset no.<input name="customerAssetNo" className={input} /></label>
        <label className="text-sm md:col-span-2">{t("nameplatePhoto")}<input type="file" name="photo" accept="image/*" capture="environment" className={input} /></label>
      </div>
      <button className="rounded bg-navy px-4 py-2 text-sm text-white">{t("save")}</button>
    </form>
  );
}
