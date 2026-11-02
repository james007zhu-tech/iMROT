import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { appendAssetEvent, getAssetPage, transferAsset } from "@/server/alm";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { saveUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border bg-white p-4"><h2 className="mb-3 text-base font-bold text-navy">{title}</h2>{children}</section>;
}
function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return <div><div className="text-xs text-slate-500">{label}</div><div className="font-medium">{value ?? "—"}</div></div>;
}

/** The asset page is the system's home page: header → timeline → linked orders → parts → backups → model knowledge. */
export default async function AssetDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { code } = await params;
  const { ok, error } = await searchParams;
  const asset = await getAssetPage(code);
  if (!asset) notFound();
  const t = await getTranslations("common");
  const [customers, others] = await Promise.all([
    prisma.customer.findMany({ orderBy: { name: "asc" }, include: { plants: true } }),
    prisma.asset.findMany({ where: { customerId: asset.customerId ?? undefined, NOT: { code } }, select: { code: true, type: true, location: true }, orderBy: { code: "asc" }, take: 200 }),
  ]);
  const back = `/assets/${code}`;
  async function transfer(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await transferAsset({ assetCode: code, actorEmployeeCode: me.code, customerId: String(f.get("customerId") || "") || undefined, plantId: String(f.get("plantId") || "") || undefined, location: String(f.get("location") || "") || undefined, note: String(f.get("note") || "") || undefined }); return "transferred"; }, back);
  }
  async function relate(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const a = await prisma.asset.findUniqueOrThrow({ where: { code } });
      const b = await prisma.asset.findUniqueOrThrow({ where: { code: String(f.get("other")) } });
      const dir = String(f.get("direction"));
      await prisma.assetRelation.create({ data: { fromAssetId: dir === "to" ? a.id : b.id, toAssetId: dir === "to" ? b.id : a.id, relation: f.get("relation") as "DRIVES" } });
      await appendAssetEvent({ assetCode: code, type: "RELATION_CHANGED", actorEmployeeCode: me.code, summary: `${dir === "to" ? code : b.code} ${String(f.get("relation"))} ${dir === "to" ? b.code : code}` });
      return "linked";
    }, back);
  }
  async function note(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const file = f.get("file") as File | null;
      const up = file && file.size > 0 ? await saveUpload(file, "att") : null;
      const type = String(f.get("type"));
      if (type === "PARAMETER_BACKUP") {
        if (!up) throw new Error("a parameter backup needs a file");
        const a = await prisma.asset.findUniqueOrThrow({ where: { code } });
        await prisma.parameterBackup.create({ data: { assetId: a.id, fileUrl: up.url, note: String(f.get("summary")), byName: me.name } });
      }
      await appendAssetEvent({ assetCode: code, type, actorEmployeeCode: me.code, summary: String(f.get("summary")), payload: f.get("payload") ? { note: String(f.get("payload")) } : undefined, attachments: up ? [{ name: file!.name, url: up.url }] : undefined });
      return "event added";
    }, back);
  }
  const input = "w-full rounded border px-2 py-1.5 text-sm";
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

      <Flash ok={ok} error={error} />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link href={`/service-orders/new?asset=${asset.code}`} className="rounded bg-navy px-3 py-1.5 text-white">{t("reportIssue")}</Link>
        <Link href={`/assets/${asset.code}/label?n=6`} className="rounded border px-3 py-1.5">QR label</Link>
        {asset.model && <Link href={`/models/${asset.model.id}`} className="rounded border px-3 py-1.5">{t("knowledge")}</Link>}
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
              <div><span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold">{te(e.type)}</span>{e.summary}{Array.isArray(e.attachments) && (e.attachments as { name: string; url: string }[]).map((f) => <a key={f.url} href={f.url} className="ml-2 text-xs text-blue underline">{f.name}</a>)}</div>
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

      <div className="grid gap-4 md:grid-cols-3">
        <Section title={te("TRANSFERRED")}>
          <form action={transfer} className="space-y-1">
            <select name="customerId" defaultValue={asset.customerId ?? ""} className={input}><option value="">{t("customer")}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select>
            <select name="plantId" defaultValue={asset.plantId ?? ""} className={input}><option value="">{t("plant")}</option>{customers.flatMap((c) => c.plants.map((p) => <option key={p.id} value={p.id}>{c.code} · {p.name}</option>))}</select>
            <input name="location" defaultValue={asset.location ?? ""} placeholder={t("location")} className={input} />
            <input name="note" placeholder="Note" className={input} />
            <button className="rounded border px-3 py-1 text-sm">{t("save")}</button>
          </form>
        </Section>
        <Section title={t("relations")}>
          <form action={relate} className="space-y-1">
            <select name="direction" className={input}><option value="to">{asset.code} →</option><option value="from">→ {asset.code}</option></select>
            <select name="relation" className={input}>{["DRIVES", "INSTALLED_IN", "CONTROLLED_BY", "COUPLED_TO"].map((r) => <option key={r}>{r}</option>)}</select>
            <select name="other" className={input} required><option value="">{t("asset")}</option>{others.map((o) => <option key={o.code} value={o.code}>{o.code} · {t(o.type)} · {o.location ?? ""}</option>)}</select>
            <button className="rounded border px-3 py-1 text-sm">{t("save")}</button>
          </form>
        </Section>
        <Section title={t("timeline")}>
          <form action={note} encType="multipart/form-data" className="space-y-1">
            <select name="type" className={input}>{["CONDITION_RECORDED", "PARAMETER_BACKUP", "READING", "ALARM", "CASE_ARCHIVED"].map((x) => <option key={x} value={x}>{te(x)}</option>)}</select>
            <input name="summary" placeholder="Summary" className={input} required />
            <textarea name="payload" placeholder="Details" className={input} rows={2} />
            <input type="file" name="file" className={input} />
            <button className="rounded border px-3 py-1 text-sm">{t("save")}</button>
          </form>
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
