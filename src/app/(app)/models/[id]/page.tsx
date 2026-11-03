import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { addBomLine, addFaultCode, addMaintenanceStandard, getModel } from "@/server/models";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { AssetStatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

/** One model: series-level knowledge (shared) + model-level overrides, BOM, and every asset of this model. */
export default async function ModelPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { id } = await params;
  const { ok, error } = await searchParams;
  const m = await getModel(id);
  if (!m) notFound();
  const t = await getTranslations("common");
  const back = `/models/${id}`;
  const seriesId = m.series.id;
  async function fault(f: FormData) { "use server"; await guarded(async () => { await addFaultCode(seriesId, f.get("level") === "model" ? id : undefined, String(f.get("code")), String(f.get("title")), s(f, "meaning"), s(f, "firstChecks")); }, back); }
  async function maint(f: FormData) { "use server"; await guarded(async () => { await addMaintenanceStandard(seriesId, f.get("level") === "model" ? id : undefined, String(f.get("item")), n(f, "months"), n(f, "hours"), s(f, "criterion")); }, back); }
  async function bom(f: FormData) { "use server"; await guarded(async () => { await addBomLine(id, String(f.get("sku")), String(f.get("name")), String(f.get("vendorPartNo")), Number(f.get("qty") || 1), s(f, "position")); }, back); }
  const input = "rounded border px-2 py-1.5 text-sm";
  const faults = [...m.series.faultCodes, ...m.faultCodes];
  const stds = [...m.series.maintenanceStandards, ...m.maintenanceStandards];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><Link href="/models" className="text-sm text-blue">← ALM</Link><h1 className="font-mono text-2xl font-bold">{m.code}</h1><span>{m.series.brand.name} {m.series.name}</span><span className="text-slate-500">{m.ratedPowerKw ? `${Number(m.ratedPowerKw)} kW` : ""} {m.ratedVoltageV ? `${m.ratedVoltageV} V` : ""} {m.ratedCurrentA ? `${Number(m.ratedCurrentA)} A` : ""} · {m.lifecycle}</span></div>
      <Flash ok={ok} error={error} />
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("faultCodes")} ({faults.length})</h2>
          <ul className="max-h-64 overflow-y-auto text-sm">{faults.map((f) => <li key={f.id} className="border-t py-1"><span className="font-mono">{f.code}</span> <b>{f.title}</b>{f.modelId ? <span className="ml-1 rounded bg-amber-100 px-1 text-xs">{t("model")}</span> : null}{f.meaning ? <div className="text-slate-600">{f.meaning}</div> : null}{f.firstChecks ? <div className="text-xs text-slate-500">→ {f.firstChecks}</div> : null}</li>)}</ul>
          <form action={fault} className="mt-2 grid grid-cols-2 gap-1"><input name="code" placeholder={t("faultCodeHint")} className={input} required /><input name="title" placeholder={t("title")} className={input} required /><input name="meaning" placeholder={t("meaning")} className={`${input} col-span-2`} /><input name="firstChecks" placeholder={t("firstChecks")} className={`${input} col-span-2`} /><select name="level" className={input}><option value="series">{t("seriesShared")}</option><option value="model">{t("modelOnly")}</option></select><button className="rounded bg-navy px-2 py-1 text-xs text-white">+</button></form>
        </section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("maintenanceStandards")} ({stds.length})</h2>
          <ul className="max-h-64 overflow-y-auto text-sm">{stds.map((x) => <li key={x.id} className="border-t py-1">{x.item}{x.modelId ? <span className="ml-1 rounded bg-amber-100 px-1 text-xs">{t("model")}</span> : null} <span className="text-slate-500">{x.intervalMonths ? `${x.intervalMonths} ${t("months")}` : ""} {x.intervalHours ? `${x.intervalHours} h` : ""}</span>{x.criterion ? <div className="text-xs text-slate-500">{x.criterion}</div> : null}</li>)}</ul>
          <form action={maint} className="mt-2 grid grid-cols-2 gap-1"><input name="item" placeholder={t("maintItemHint")} className={`${input} col-span-2`} required /><input name="months" type="number" placeholder={t("months")} className={input} /><input name="hours" type="number" placeholder={t("runHours")} className={input} /><input name="criterion" placeholder={t("criterion")} className={`${input} col-span-2`} /><select name="level" className={input}><option value="series">{t("seriesShared")}</option><option value="model">{t("modelOnly")}</option></select><button className="rounded bg-navy px-2 py-1 text-xs text-white">+</button></form>
        </section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("bom")} ({m.bom.length})</h2>
          <ul className="text-sm">{m.bom.map((b) => <li key={b.id} className="border-t py-1"><Link href={`/parts/${b.part.sku}`} className="font-mono text-blue underline">{b.part.sku}</Link> {b.part.name} ×{b.qty} <span className="text-slate-500">{b.position ?? ""}</span></li>)}</ul>
          <form action={bom} className="mt-2 grid grid-cols-2 gap-1"><input name="sku" placeholder={t("skuHint")} className={input} required /><input name="vendorPartNo" placeholder={t("vendorPartNo")} className={input} required /><input name="name" placeholder={t("partName")} className={input} required /><input name="position" placeholder={t("position")} className={input} /><input name="qty" type="number" defaultValue={1} className={input} /><button className="rounded bg-navy px-2 py-1 text-xs text-white">+</button></form>
        </section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("assets")} ({m.assets.length})</h2>
          <ul className="max-h-64 overflow-y-auto text-sm">{m.assets.map((a) => <li key={a.code} className="flex items-center gap-2 border-t py-1"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span className="font-mono text-slate-500">{a.serialNumber}</span><span>{a.customer?.name}</span><AssetStatusBadge status={a.status} /></li>)}</ul>
        </section>
      </div>
    </div>
  );
}
const s = (f: FormData, k: string) => { const v = f.get(k); return v ? String(v) : undefined; };
const n = (f: FormData, k: string) => { const v = f.get(k); return v ? Number(v) : undefined; };
