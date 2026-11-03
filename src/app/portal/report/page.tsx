import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentContact } from "@/server/auth";
import { createServiceOrder } from "@/server/slm";

export const dynamic = "force-dynamic";

/** 报修 from the portal. The QR on the nameplate links here with ?asset=ATH…, so the customer never types "which machine". */
export default async function PortalReport({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset } = await searchParams;
  const me = await currentContact();
  const t = await getTranslations("common");
  const assets = await prisma.asset.findMany({ where: { customerId: me.customerId, status: { not: "RETIRED" } }, orderBy: { code: "asc" } });
  if (asset && !assets.some((a) => a.code === asset)) redirect("/portal/report"); // not this customer's asset

  async function submit(form: FormData) {
    "use server";
    const me = await currentContact();
    const code = String(form.get("assetCode"));
    const a = await prisma.asset.findFirst({ where: { code, customerId: me.customerId } });
    if (!a) redirect("/portal/report");
    // the portal has no employee; the order is created in the name of the entity's service desk account
    const desk = await prisma.employee.findFirst({ where: { entityId: a.entityId, active: true, role: { in: ["ADMIN", "MANAGER"] } }, orderBy: { code: "asc" } });
    if (!desk) throw new Error("no service desk employee configured for this entity");
    const order = await createServiceOrder({ createdByEmployeeCode: desk.code, customerId: me.customerId, plantId: a.plantId ?? undefined, assetCodes: [code], kind: "REPAIR", reportedSymptom: String(form.get("symptom")), reportedAlarm: String(form.get("alarm") || "") || undefined, productionImpact: String(form.get("impact") || "") || undefined, reportedByContactId: me.id, customerRef: String(form.get("customerRef") || "") || undefined, currency: me.customer.defaultCurrency });
    redirect(`/portal/orders/${order.no}`);
  }
  const input = "w-full rounded border px-3 py-3 text-base";
  return (
    <form action={submit} className="space-y-3 rounded-lg border bg-white p-4">
      <h1 className="text-lg font-bold">{t("reportIssue")}</h1>
      <select name="assetCode" defaultValue={asset ?? ""} className={input} required><option value="">{t("asset")}</option>{assets.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.location ?? a.serialNumber}</option>)}</select>
      <textarea name="symptom" placeholder={t("whatHappening")} className={input} rows={4} required />
      <input name="alarm" placeholder={t("alarmOnDisplay")} className={input} />
      <select name="impact" className={input}><option value="">{t("impact")}</option><option>{t("impactStopped")}</option><option>{t("impactLimited")}</option><option>{t("impactNone")}</option></select>
      <input name="customerRef" placeholder={t("yourRef")} className={input} />
      <button className="w-full rounded bg-blue py-3 text-base font-bold text-white">{t("save")}</button>
    </form>
  );
}
