import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { listModelTree, upsertBrand, upsertModel, upsertSeries } from "@/server/models";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

/** Product knowledge tree: brand → series → model. Everything an asset inherits lives here. */
export default async function Models({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const t = await getTranslations("common");
  const brands = await listModelTree();
  async function addBrand(f: FormData) { "use server"; await guarded(async () => { await upsertBrand(String(f.get("code")), String(f.get("name"))); }, "/models"); }
  async function addSeries(f: FormData) { "use server"; await guarded(async () => { await upsertSeries(String(f.get("brandCode")), String(f.get("code")), String(f.get("name")), String(f.get("notes") || "") || undefined); }, "/models"); }
  async function addModel(f: FormData) { "use server"; await guarded(async () => { await upsertModel(String(f.get("seriesId")), { code: String(f.get("code")), ratedPowerKw: num(f, "kw"), ratedVoltageV: num(f, "v"), ratedCurrentA: num(f, "a") }); }, "/models"); }
  const input = "rounded border px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">ALM · {t("brand")} → {t("series")} → {t("model")}</h1>
      <Flash ok={ok} error={error} />
      <div className="grid gap-3 md:grid-cols-3">
        <form action={addBrand} className="flex flex-wrap gap-1 rounded-xl border bg-white p-4"><b className="w-full text-xs text-navy/70">{t("brand")}</b><input name="code" placeholder={t("brandCodeHint")} className={`${input} w-20`} required /><input name="name" placeholder={t("brandNameHint")} className={input} required /><button className="rounded bg-navy px-2 text-xs text-white">+</button></form>
        <form action={addSeries} className="flex flex-wrap gap-1 rounded-xl border bg-white p-4"><b className="w-full text-xs text-navy/70">{t("series")}</b><select name="brandCode" className={input}>{brands.map((b) => <option key={b.id} value={b.code}>{b.name}</option>)}</select><input name="code" placeholder={t("seriesCodeHint")} className={`${input} w-20`} required /><input name="name" placeholder={t("seriesNameHint")} className={input} required /><button className="rounded bg-navy px-2 text-xs text-white">+</button></form>
        <form action={addModel} className="flex flex-wrap gap-1 rounded-xl border bg-white p-4"><b className="w-full text-xs text-navy/70">{t("model")}</b><select name="seriesId" className={input}>{brands.flatMap((b) => b.series.map((s) => <option key={s.id} value={s.id}>{b.name} {s.name}</option>))}</select><input name="code" placeholder={t("modelCodeHint")} className={input} required /><input name="kw" type="number" step="0.1" placeholder={t("kw")} className={`${input} w-16`} /><input name="v" type="number" placeholder={t("volt")} className={`${input} w-16`} /><input name="a" type="number" step="0.1" placeholder={t("amp")} className={`${input} w-16`} /><button className="rounded bg-navy px-2 text-xs text-white">+</button></form>
      </div>
      <div className="space-y-3">
        {brands.map((b) => (
          <section key={b.id} className="rounded-xl border bg-white p-4">
            <h2 className="font-bold text-navy">{b.name} <span className="font-mono text-xs text-navy/70">{b.code}</span></h2>
            {b.series.map((s) => (
              <div key={s.id} className="mt-2 pl-3">
                <div className="font-semibold">{s.name} <span className="font-mono text-xs text-navy/70">{s.code}</span></div>
                <ul className="grid gap-1 pl-3 text-sm md:grid-cols-3">{s.models.map((m) => <li key={m.id}><Link href={`/models/${m.id}`} className="font-mono text-blue underline">{m.code}</Link> <span className="text-navy/70">{m.ratedPowerKw ? `${Number(m.ratedPowerKw)} kW` : ""} · {m._count.assets} {t("assets")}</span></li>)}</ul>
              </div>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
function num(f: FormData, k: string) { const v = f.get(k); return v ? Number(v) : undefined; }
