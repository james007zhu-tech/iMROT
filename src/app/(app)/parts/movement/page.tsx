import { PartDropdown } from "@/components/PartDropdown";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { recordStockDoc } from "@/server/scm";
import { dayNow, localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { RevealRows } from "@/components/RevealRows";
import { SkuNames } from "@/components/SkuNames";
import { Alert, Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const ROWS = 10;

/** 出入库 IBTH / OBTH — wireframe 10. Each line gets its own IBTH/OBTH number; OUT lines must name the asset or the order. */
export default async function Movement({ searchParams }: { searchParams: Promise<{ direction?: string; order?: string; error?: string; ok?: string }> }) {
  const { direction, order, error, ok } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [parts, orders, me] = await Promise.all([
    prisma.part.findMany({ orderBy: { sku: "asc" } }),
    prisma.serviceOrder.findMany({ where: { status: { in: ["ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING"] } }, include: { assets: { include: { asset: true } }, customer: true }, orderBy: { reportedAt: "desc" } }),
    currentEmployee(),
  ]);
  const assetsOfOrder = orders.flatMap((o) => o.assets.map((a) => ({ code: a.asset.code, label: `${a.asset.code} · ${o.no} · ${o.customer.name}` })));
  const backTo = order ? `/service-orders/${order}` : "/parts";
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const dir = f.get("direction") as "IN" | "OUT";
      const rows = Array.from({ length: ROWS }, (_, i) => ({ partSku: String(f.get(`s${i}`) ?? "").trim(), qty: Number(f.get(`q${i}`) || 0), batch: String(f.get(`b${i}`) ?? "").trim() || undefined, unitCost: dir === "IN" && f.get(`c${i}`) ? Number(f.get(`c${i}`)) : undefined, oldPartDisposition: dir === "OUT" ? String(f.get(`o${i}`) ?? "") || undefined : undefined })).filter((r) => r.partSku && r.qty > 0);
      const doc = await recordStockDoc({ actorCode: me.code, direction: dir, warehouse: String(f.get("warehouse") || "RAYONG"), assetCode: String(f.get("assetCode") || "") || undefined, serviceOrderNo: String(f.get("serviceOrderNo") || "") || undefined, supplierRef: String(f.get("supplierRef") || "") || undefined, costCurrency: "THB", movedAt: dayNow(String(f.get("movedAt") || "") || undefined), lines: rows });
      const nos = [`${doc.no} · ${doc.lines.length}`];
      const so = String(f.get("serviceOrderNo") || "");
      return { ok: nos.join(", "), to: so ? `/service-orders/${so}` : "/parts" };
    }, `/parts/movement${order ? `?order=${order}` : ""}`);
  }
  const [code, list] = (error ?? "").split(":");
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: backTo, label: order ?? u("backToParts") }} title={u("stockMovement")} actions={<><Link href={backTo} className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      <Flash ok={ok} error={code === "UNKNOWN_SKU" ? undefined : error} />
      {code === "UNKNOWN_SKU" && <Alert>{u("unknownSku", { list })} {list.split(",").map((s) => <Link key={s} href={`/parts/new?vendor=${encodeURIComponent(s.replace(/^[A-Z]{2,4}-/, ""))}&back=/parts/movement`} className="ml-2 underline">＋ {s}</Link>)}</Alert>}
      <FormMemory formId="f" />
      <UploadRecognize kind="stock" formId="f" title={u("upStockTitle")} hint={u("upStockHint")} />
      <form id="f" action={save} className="space-y-4">
        <Card title={u("movementDoc")}>
          <Grid>
            <Field label={u("direction")} required><select name="direction" defaultValue={direction === "OUT" ? "OUT" : "IN"} className={inputCls}><option value="IN">{u("dirIn")}</option><option value="OUT">{u("dirOut")}</option></select></Field>
            <Field label={u("warehouse")}><input name="warehouse" defaultValue="RAYONG" className={inputCls} /></Field>
            <Field label={u("date")}><input name="movedAt" type="date" defaultValue={localIso(new Date())!.slice(0, 10)} className={inputCls} /></Field>
            <Field label={u("relatedAsset")}><select name="assetCode" className={inputCls}><option value="">—</option>{assetsOfOrder.map((a) => <option key={a.label} value={a.code}>{a.label}</option>)}</select></Field>
            <Field label={u("relatedOrder")}><select name="serviceOrderNo" defaultValue={order ?? ""} className={inputCls}><option value="">—</option>{orders.map((o) => <option key={o.id} value={o.no}>{o.no} · {o.customer.name}</option>)}</select></Field>
            <Field label={u("supplierRef")}><input name="supplierRef" className={inputCls} /></Field>
            <Field label={u("handler")}><div className="min-h-10 rounded-md border bg-white px-2.5 py-2 text-sm">{me.code} {me.name}</div></Field>
          </Grid>
        </Card>
        <Card title={u("lines")}>
          <div className="hidden grid-cols-[2fr_80px_1fr_1fr_1.4fr] gap-2 text-xs text-navy/70 md:grid"><span>{t("sku")}</span><span>{t("qty")}</span><span>{u("batch")}</span><span>{u("unitCostThb")}</span><span>{u("oldPartOut")}</span></div>
          <RevealRows initial={2} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[2fr_80px_1fr_1fr_1.4fr]"><span><input name={`s${i}`} list="skus" data-sku className={`${inputCls} font-mono`} /><span data-sku-name={`s${i}`} /></span><input name={`q${i}`} type="number" step="1" className={inputCls} /><input name={`b${i}`} className={inputCls} /><input name={`c${i}`} type="number" step="0.01" className={inputCls} /><select name={`o${i}`} className={inputCls}><option value="">—</option><option value="SCRAP">{u("dispScrap")}</option><option value="RETURN_TO_CUSTOMER">{u("dispReturn")}</option><option value="KEEP_FOR_ANALYSIS">{u("dispKeep")}</option></select></div>)}
          </RevealRows>
          <PartDropdown formId="f" sku="s" labels={{ none: u("partNotListed"), onHand: u("briefOnHand"), own: u("partOfModel") }} parts={parts.map((p) => ({ sku: p.sku, vendorPartNo: p.vendorPartNo, name: p.name, unit: p.unit }))} />
          <SkuNames names={Object.fromEntries(parts.map((p) => [p.sku, p.name ?? ""]))} unknown={u("skuUnknown")} />
          <Link href="/parts/new?back=/parts/movement" className="text-sm text-blue underline">＋ {u("newPart")}</Link>
        </Card>
      </form>
    </div>
  );
}
