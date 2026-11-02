import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getAssetPage } from "@/server/alm";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border bg-white p-4"><h2 className="mb-3 text-base font-bold text-navy">{title}</h2>{children}</section>;
}
function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value ?? "—"}</div></div>;
}

/** The asset page is the system's home page: header → timeline → linked orders → parts → backups → model knowledge. */
export default async function AssetDetail({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const asset = await getAssetPage(code);
  if (!asset) notFound();
  const t = await getTranslations("common");
  const te = await getTranslations("eventType");
  const locale = await getLocale();
  const fmt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d) : "—");
  const orders = Array.from(new Map(asset.orderLinks.map((l) => [l.serviceOrder.no, l.serviceOrder])).values());
  const replaced = asset.events.filter((e) => e.type === "PART_REPLACED");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/assets" className="text-sm text-blue">← {t("assets")}</Link>
        <h1 className="font-mono text-2xl font-bold">{asset.code}</h1>
        <AssetStatusBadge status={asset.status} />
        <span className="text-slate-600">{t(asset.type)} · S/N <span className="font-mono">{asset.serialNumber}</span></span>
      </div>

      <Section title={t("asset")}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label={t("brand")} value={asset.model?.series.brand.name} />
          <Field label={t("series")} value={asset.model?.series.name} />
          <Field label={t("model")} value={asset.model?.code} />
          <Field label={t("origin")} value={t(asset.origin)} />
          <Field label={t("customer")} value={asset.customer ? <Link className="text-blue underline" href={`/customers/${asset.customer.code}`}>{asset.customer.name}</Link> : undefined} />
          <Field label={t("plant")} value={asset.plant?.name} />
          <Field label={t("location")} value={asset.location} />
          <Field label={t("responsible")} value={asset.responsible ? `${asset.responsible.name} (${asset.responsible.code})` : undefined} />
          <Field label={t("installedAt")} value={fmt(asset.installedAt)} />
        </div>
        {asset.nameplatePhoto && <img src={asset.nameplatePhoto} alt="nameplate" className="mt-3 max-h-48 rounded border" />}
      </Section>

      <Section title={t("timeline")}>
        {asset.events.length === 0 && <p className="text-sm text-slate-500">{t("noEvents")}</p>}
        <ol className="relative border-l border-slate-200 pl-4">
          {asset.events.map((e) => (
            <li key={e.id} className="mb-4">
              <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full bg-blue" />
              <div className="text-xs text-slate-500">{fmt(e.occurredAt)}{e.actor ? ` · ${t("by")} ${e.actor.name}` : e.actorName ? ` · ${e.actorName}` : ""}{e.sourceDocNo ? ` · ${e.sourceDocNo}` : ""}</div>
              <div><span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{te(e.type)}</span>{e.summary}</div>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title={t("linkedOrders")}>
          <ul className="space-y-1 text-sm">
            {orders.map((o) => (
              <li key={o.no} className="flex items-center gap-2">
                <Link href={`/service-orders/${o.no}`} className="font-mono text-blue underline">{o.no}</Link>
                <OrderStatusBadge status={o.status} />
                <span className="text-slate-500">{t(o.kind)} · {fmt(o.reportedAt)}</span>
                {o.total != null && <span className="ml-auto">{o.currency} {Number(o.total).toFixed(2)}</span>}
              </li>
            ))}
            {orders.length === 0 && <li className="text-slate-500">{t("none")}</li>}
          </ul>
        </Section>
        <Section title={t("relations")}>
          <ul className="space-y-1 text-sm">
            {asset.relationsFrom.map((r) => <li key={r.id}>{asset.code} → <b>{r.relation}</b> → <Link className="font-mono text-blue underline" href={`/assets/${r.toAsset.code}`}>{r.toAsset.code}</Link> ({t(r.toAsset.type)} · {r.toAsset.serialNumber})</li>)}
            {asset.relationsTo.map((r) => <li key={r.id}><Link className="font-mono text-blue underline" href={`/assets/${r.fromAsset.code}`}>{r.fromAsset.code}</Link> ({t(r.fromAsset.type)}) → <b>{r.relation}</b> → {asset.code}</li>)}
            {asset.relationsFrom.length + asset.relationsTo.length === 0 && <li className="text-slate-500">{t("none")}</li>}
          </ul>
        </Section>
        <Section title={te("PART_REPLACED")}>
          <ul className="space-y-1 text-sm">
            {replaced.map((e) => <li key={e.id}>{fmt(e.occurredAt)} · {e.summary}</li>)}
            {replaced.length === 0 && <li className="text-slate-500">{t("none")}</li>}
          </ul>
        </Section>
        <Section title={t("backups")}>
          <ul className="space-y-1 text-sm">
            {asset.parameterBackups.map((b) => <li key={b.id}>{fmt(b.takenAt)} · <a className="text-blue underline" href={b.fileUrl}>{b.note ?? b.fileUrl}</a></li>)}
            {asset.parameterBackups.length === 0 && <li className="text-slate-500">{t("none")}</li>}
          </ul>
        </Section>
      </div>

      {asset.model && (
        <Section title={t("knowledge")}>
          <div className="grid gap-4 md:grid-cols-3 text-sm">
            <div><h3 className="mb-1 font-semibold">{t("faultCodes")}</h3>
              <ul>{asset.model.faultCodes.map((f) => <li key={f.id}><span className="font-mono">{f.code}</span> {f.title}{f.firstChecks ? ` — ${f.firstChecks}` : ""}</li>)}{asset.model.faultCodes.length === 0 && <li className="text-slate-500">{t("none")}</li>}</ul></div>
            <div><h3 className="mb-1 font-semibold">{t("maintenanceStandards")}</h3>
              <ul>{asset.model.maintenanceStandards.map((m) => <li key={m.id}>{m.item}{m.intervalMonths ? ` · ${m.intervalMonths} mo` : ""}{m.intervalHours ? ` · ${m.intervalHours} h` : ""}</li>)}{asset.model.maintenanceStandards.length === 0 && <li className="text-slate-500">{t("none")}</li>}</ul></div>
            <div><h3 className="mb-1 font-semibold">{t("bom")}</h3>
              <ul>{asset.model.bom.map((b) => <li key={b.id}><Link className="font-mono text-blue underline" href={`/parts/${b.part.sku}`}>{b.part.sku}</Link> {b.part.name} ×{b.qty}</li>)}{asset.model.bom.length === 0 && <li className="text-slate-500">{t("none")}</li>}</ul></div>
          </div>
        </Section>
      )}
    </div>
  );
}
