import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { createPurchaseOrder } from "@/server/purchasing";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { RevealRows } from "@/components/RevealRows";
import { Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const ROWS = 10;

/** A POTH raised by hand (stock replenishment, parts sale, anything without a PRTH). The supplier's quotation fills the lines. */
export default async function NewPurchaseOrder({ searchParams }: { searchParams: Promise<{ error?: string; order?: string }> }) {
  const { error, order } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [suppliers, parts, orders] = await Promise.all([
    prisma.supplier.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.part.findMany({ orderBy: { sku: "asc" }, take: 500, select: { sku: true, name: true, vendorPartNo: true } }),
    prisma.serviceOrder.findMany({ where: { lockedAt: null, status: { notIn: ["CLOSED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { no: true, customer: { select: { name: true } } } }),
  ]);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const lines = Array.from({ length: ROWS }, (_, i) => ({ partSku: str(f, `s${i}`), vendorPartNo: str(f, `v${i}`), description: str(f, `d${i}`) ?? "", qty: Number(str(f, `q${i}`) ?? 0), unit: str(f, `u${i}`) ?? "pcs", unitPrice: Number(str(f, `p${i}`) ?? 0) })).filter((l) => l.description && l.qty > 0);
      if (!lines.length) throw new Error("PO_NEEDS_LINE");
      const vat = str(f, "vatRate");
      const po = await createPurchaseOrder({ actorCode: me.code, supplierId: String(f.get("supplierId")), serviceOrderNo: str(f, "serviceOrderNo"), expectedAt: str(f, "expectedAt") ? new Date(str(f, "expectedAt")!) : undefined, currency: str(f, "currency") ?? "THB", vatRate: vat ? Number(vat) : undefined, supplierRef: str(f, "supplierRef"), paymentTerms: str(f, "paymentTerms"), lines, attachments: JSON.parse(String(f.get("attachments") || "[]")) });
      return { ok: po.no, to: `/purchasing/orders/${po.no}` };
    }, "/purchasing/orders/new");
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/purchasing/orders", label: u("purchaseOrders") }} title={u("newPo")} actions={<><Link href="/purchasing/orders" className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{u("savePo")}</button></>} />
      <Flash error={error} />
      <FormMemory formId="f" />
      <UploadRecognize kind="purchase" formId="f" title={u("upSupplierQuoteTitle")} hint={u("upSupplierQuoteHint")} lineFields={{ vendorPartNo: "v", description: "d", qty: "q", unit: "u", unitPrice: "p" }} />
      <form id="f" action={save} className="space-y-4">
        <Card title={u("poHeader")}>
          <Grid>
            <Field label={u("supplier")} required><select name="supplierId" required className={inputCls}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="QTTH"><select name="serviceOrderNo" defaultValue={order ?? ""} className={inputCls}><option value="">—</option>{orders.map((o) => <option key={o.no} value={o.no}>{o.no} · {o.customer.name}</option>)}</select></Field>
            <Field label={u("quoteNo")}><input name="supplierRef" className={`${inputCls} font-mono`} /></Field>
            <Field label={t("currency")}><select name="currency" className={inputCls}>{["THB", "USD", "CNY", "EUR", "JPY"].map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label={u("vatRateDec")}><input name="vatRate" type="number" step="0.0001" defaultValue="0.07" className={inputCls} /></Field>
            <Field label={u("expectedAt")}><input name="expectedAt" type="date" className={inputCls} /></Field>
            <Field label={u("paymentTerms")}><input name="paymentTerms" className={inputCls} /></Field>
          </Grid>
        </Card>
        <Card title={u("poLines")}>
          <div className="hidden grid-cols-[150px_150px_2fr_80px_70px_110px] gap-2 text-xs text-navy/70 md:grid"><span>{u("partSku")}</span><span>{u("vendorPartNo")}</span><span>{t("description")}</span><span>{t("qty")}</span><span>{u("uom")}</span><span>{u("unitPriceExVat")}</span></div>
          <RevealRows initial={2} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[150px_150px_2fr_80px_70px_110px]">
                <input name={`s${i}`} list="parts" className={`${inputCls} font-mono`} />
                <input name={`v${i}`} className={`${inputCls} font-mono`} />
                <input name={`d${i}`} className={inputCls} />
                <input name={`q${i}`} type="number" step="0.001" className={inputCls} />
                <input name={`u${i}`} defaultValue="pcs" className={inputCls} />
                <input name={`p${i}`} type="number" step="0.01" className={inputCls} />
              </div>))}
          </RevealRows>
          <datalist id="parts">{parts.map((p) => <option key={p.sku} value={p.sku}>{p.vendorPartNo} · {p.name}</option>)}</datalist>
          <p className="text-xs text-navy/70">{u("poSkuNote")}</p>
        </Card>
      </form>
    </div>
  );
}
