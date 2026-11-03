import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentContact } from "@/server/auth";
import { createServiceOrder } from "@/server/slm";
import { UploadRecognize } from "@/components/UploadRecognize";
import { ScanButton } from "@/components/ScanButton";

export const dynamic = "force-dynamic";

/** 报修 from the portal (wireframe 12). The DCiT QR label on the machine links here with ?asset=ATH…. */
export default async function PortalReport({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset } = await searchParams;
  const me = await currentContact();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const assets = await prisma.asset.findMany({ where: { customerId: me.customerId, status: { not: "RETIRED" } }, orderBy: { code: "asc" } });
  if (asset && !assets.some((a) => a.code === asset)) redirect("/portal/report"); // not this customer's asset

  async function submit(form: FormData) {
    "use server";
    const me = await currentContact();
    const code = String(form.get("assetCode"));
    const a = await prisma.asset.findFirst({ where: { code, customerId: me.customerId } });
    if (!a) redirect("/portal/report");
    // The portal has no employee; the order is created in the name of the entity's service desk (MD / manager).
    const desk = await prisma.employee.findFirst({ where: { entityId: a.entityId, active: true, role: { in: ["MD", "ADMIN", "MANAGER"] } }, orderBy: { code: "asc" } });
    if (!desk) throw new Error("no service desk employee configured for this entity");
    let attachments: { name: string; url: string; kind: string }[] = [];
    try { attachments = JSON.parse(String(form.get("attachments") || "[]")); } catch { /* none */ }
    const order = await createServiceOrder({ createdByEmployeeCode: desk.code, customerId: me.customerId, plantId: a.plantId ?? undefined, assetCodes: [code], kind: "REPAIR", reportedSymptom: String(form.get("reportedSymptom")), reportedAlarm: String(form.get("reportedAlarm") || "") || undefined, productionImpact: String(form.get("productionImpact") || "") || undefined, reportedByContactId: me.id, customerRef: String(form.get("customerRef") || "") || undefined, currency: me.customer.defaultCurrency, attachments });
    redirect(`/portal/orders/${order.no}`);
  }
  const input = "w-full rounded-md border px-3 py-3 text-base";
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2"><Link href="/portal" className="inline-flex min-h-11 items-center rounded-lg border border-navy/45 bg-white px-3">←</Link><h1 className="text-lg font-bold">{t("reportIssue")}</h1></div>
      <UploadRecognize kind="service" formId="f" title={u("portalUpTitle")} hint={u("portalUpHint")} />
      <form id="f" action={submit} className="space-y-3 rounded-xl border bg-white p-4">
        <label className="block text-[13px]"><span className="text-navy/80">{t("asset")}<span className="text-alert"> *</span></span>
          <select name="assetCode" defaultValue={asset ?? ""} className={input} required><option value="">—</option>{assets.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.location ?? a.serialNumber}</option>)}</select></label>
        <ScanButton compact label={t("scanQr")} />
        <label className="block text-[13px]"><span className="text-navy/80">{t("whatHappening")}<span className="text-alert"> *</span></span><textarea name="reportedSymptom" className={`${input} font-semibold text-fault`} rows={4} required /></label>
        <label className="block text-[13px]"><span className="text-navy/80">{t("alarmOnDisplay")}</span><input name="reportedAlarm" className={`${input} font-semibold text-fault`} /></label>
        <label className="block text-[13px]"><span className="text-navy/80">{t("impact")}<span className="text-alert"> *</span></span><select name="productionImpact" className={input}><option value="STOPPED">{u("impactStopped")}</option><option value="DEGRADED">{u("impactDegraded")}</option><option value="NONE">{u("impactNone")}</option></select></label>
        <label className="block text-[13px]"><span className="text-navy/80">{t("yourRef")}</span><input name="customerRef" className={input} /></label>
        <button className="w-full rounded-lg bg-blue py-3.5 text-base font-bold text-white">{u("submitReport")}</button>
      </form>
    </div>
  );
}
