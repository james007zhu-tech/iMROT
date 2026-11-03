import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { assetsUsingPart, stockOnHand } from "@/server/scm";
import { AssetStatusBadge } from "@/components/StatusBadge";
import { recordMovement } from "@/server/scm";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

/** The shared-spare view: one part, its stock, and every asset across all customers that uses it. */
export default async function PartPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { sku } = await params;
  const { ok, error } = await searchParams;
  const t = await getTranslations("common");
  const part = await prisma.part.findUnique({ where: { sku }, include: { brand: true, movements: { orderBy: { movedAt: "desc" }, take: 30, include: { asset: { select: { code: true } } } } } });
  if (!part) notFound();
  const [onHand, assets] = await Promise.all([stockOnHand(sku), assetsUsingPart(sku)]);
  async function move(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); const mv = await recordMovement({ actorCode: me.code, direction: f.get("direction") as "IN", partSku: sku, qty: Number(f.get("qty")), batch: String(f.get("batch") || "") || undefined, assetCode: String(f.get("assetCode") || "") || undefined, serviceOrderNo: String(f.get("serviceOrderNo") || "") || undefined, oldPartDisposition: String(f.get("old") || "") || undefined, unitCost: f.get("unitCost") ? Number(f.get("unitCost")) : undefined, costCurrency: "THB" }); return mv.no; }, `/parts/${sku}`);
  }
  const input = "rounded border px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <Flash ok={ok} error={error} />
      <div className="flex items-center gap-3"><Link href="/parts" className="text-sm text-blue">← {t("nav_scm")}</Link><h1 className="font-mono text-2xl font-bold">{part.sku}</h1><span>{part.name}</span><span className="rounded bg-slate-100 px-2 py-0.5 text-sm">{t("onHand")} {onHand}</span>{part.lastCost != null && <span className="text-sm text-slate-500">{t("lastCost")} {part.lastCostCurrency} {Number(part.lastCost).toFixed(2)}</span>}</div>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("usedBy")} ({assets.length})</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">{assets.map((a) => <li key={a.code} className="flex items-center gap-2"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span>{a.customer?.name}</span><span className="text-slate-500">{a.model?.code}</span><AssetStatusBadge status={a.status} /></li>)}</ul>
      </section>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("stockIn")} / {t("stockOut")}</h2>
        <form action={move} className="flex flex-wrap gap-1"><select name="direction" className={input}><option value="IN">{t("stockIn")}</option><option value="OUT">{t("stockOut")}</option></select><input name="qty" type="number" step="0.001" placeholder={t("qty")} className={`${input} w-20`} required /><input name="batch" placeholder={t("batch")} className={`${input} w-24`} /><input name="unitCost" type="number" step="0.01" placeholder={t("unitCostIn")} className={`${input} w-36`} /><input name="assetCode" placeholder={t("athOut")} className={`${input} w-32`} /><input name="serviceOrderNo" placeholder={t("qtthOut")} className={`${input} w-32`} /><input name="old" placeholder={t("oldPart")} className={input} /><button className="rounded bg-navy px-3 text-sm text-white">{"+"}</button></form>
      </section>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("movements")}</h2>
        <ul className="text-sm">{part.movements.map((m) => <li key={m.id}><span className="font-mono">{m.no}</span> · {m.direction} {Number(m.qty)} · {m.movedAt.toISOString().slice(0, 10)}{m.asset ? ` → ${m.asset.code}` : ""}{m.oldPartDisposition ? ` · ${t("oldPart")}: ${m.oldPartDisposition}` : ""}</li>)}</ul>
      </section>
    </div>
  );
}
