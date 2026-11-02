import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { createServiceOrder } from "@/server/slm";
import { currentEmployee } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Internal 报修 (phone / walk-in). Creates the QTTH draft on behalf of the customer. */
export default async function NewOrder({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset } = await searchParams;
  const t = await getTranslations("common");
  const assets = await prisma.asset.findMany({ where: { status: { not: "RETIRED" } }, include: { customer: true, plant: true }, orderBy: { code: "asc" } });

  async function submit(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const codes = form.getAll("assetCodes").map(String).filter(Boolean);
    const first = await prisma.asset.findUniqueOrThrow({ where: { code: codes[0] } });
    const order = await createServiceOrder({
      createdByEmployeeCode: me.code,
      customerId: first.customerId!,
      plantId: first.plantId ?? undefined,
      assetCodes: codes,
      kind: form.get("kind") as "REPAIR",
      reportedSymptom: String(form.get("reportedSymptom") || "") || undefined,
      reportedAlarm: String(form.get("reportedAlarm") || "") || undefined,
      productionImpact: String(form.get("productionImpact") || "") || undefined,
      customerRef: String(form.get("customerRef") || "") || undefined,
      currency: "THB",
    });
    redirect(`/service-orders/${order.no}`);
  }
  const input = "w-full rounded border px-3 py-2 text-sm";
  return (
    <form action={submit} className="mx-auto max-w-2xl space-y-3 rounded-lg border bg-white p-4">
      <h1 className="text-xl font-bold">{t("reportIssue")}</h1>
      <label className="block text-sm">{t("assets")} *<select name="assetCodes" multiple size={6} className={input} defaultValue={asset ? [asset] : []} required>
        {assets.map((a) => <option key={a.id} value={a.code}>{a.code} · {a.serialNumber} · {a.customer?.name}{a.plant ? ` / ${a.plant.name}` : ""} · {a.location ?? ""}</option>)}
      </select></label>
      <label className="block text-sm">{t("kind")}<select name="kind" className={input}>{["REPAIR", "MAINTENANCE", "OVERHAUL", "CONTRACT", "PARTS_SALE"].map((k) => <option key={k} value={k}>{t(k)}</option>)}</select></label>
      <label className="block text-sm">Symptom<textarea name="reportedSymptom" className={input} rows={3} /></label>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm">Alarm code<input name="reportedAlarm" className={input} /></label>
        <label className="text-sm">Production impact<input name="productionImpact" className={input} /></label>
        <label className="text-sm">Customer ref (verbatim)<input name="customerRef" className={input} /></label>
      </div>
      <button className="rounded bg-navy px-4 py-2 text-sm text-white">{t("save")}</button>
    </form>
  );
}
