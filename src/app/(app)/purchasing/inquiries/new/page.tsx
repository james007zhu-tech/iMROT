import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { createInquiry, inquiryLinesFromOrder } from "@/server/purchasing";
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

/** New PRTH. With ?order=QTTH… the lines are the order's quoted parts that stock cannot cover; otherwise free lines. */
export default async function NewInquiry({ searchParams }: { searchParams: Promise<{ error?: string; order?: string }> }) {
  const { error, order } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [orders, parts] = await Promise.all([
    prisma.serviceOrder.findMany({ where: { status: { in: ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS"] }, lockedAt: null }, orderBy: { createdAt: "desc" }, take: 100, select: { no: true, customer: { select: { name: true } } } }),
    prisma.part.findMany({ orderBy: { sku: "asc" }, take: 500, select: { sku: true, name: true, vendorPartNo: true } }),
  ]);
  const prefill = order ? await inquiryLinesFromOrder(order).catch(() => []) : [];
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const lines = Array.from({ length: ROWS }, (_, i) => ({ partSku: str(f, `s${i}`), vendorPartNo: str(f, `v${i}`), description: str(f, `d${i}`) ?? "", qty: Number(str(f, `q${i}`) ?? 0), unit: str(f, `u${i}`) ?? "pcs", assetCode: str(f, `a${i}`) })).filter((l) => l.description && l.qty > 0);
      if (!lines.length) throw new Error("INQUIRY_NEEDS_LINE");
      const r = await createInquiry({ actorCode: me.code, serviceOrderNo: str(f, "serviceOrderNo"), neededBy: str(f, "neededBy") ? new Date(str(f, "neededBy")!) : undefined, note: str(f, "note"), lines, attachments: JSON.parse(String(f.get("attachments") || "[]")) });
      return { ok: r.no, to: `/purchasing/inquiries/${r.no}` };
    }, `/purchasing/inquiries/new${order ? `?order=${order}` : ""}`);
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: order ? `/service-orders/${order}` : "/purchasing/inquiries", label: order ?? u("inquiries") }} title={u("newInquiry")} actions={<><Link href="/purchasing/inquiries" className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{u("saveInquiry")}</button></>} />
      <Flash error={error} />
      <FormMemory formId="f" />
      <UploadRecognize kind="purchase" formId="f" title={u("upInquiryTitle")} hint={u("upInquiryHint")} lineFields={{ vendorPartNo: "v", description: "d", qty: "q", unit: "u" }} />
      <form id="f" action={save} className="space-y-4">
        <Card title={u("inquiryHeader")}>
          <Grid>
            <Field label="QTTH"><select name="serviceOrderNo" defaultValue={order ?? ""} className={inputCls}><option value="">—</option>{orders.map((o) => <option key={o.no} value={o.no}>{o.no} · {o.customer.name}</option>)}</select></Field>
            <Field label={u("neededBy")}><input name="neededBy" type="date" className={inputCls} /></Field>
            <Field label={t("note")}><input name="note" className={inputCls} /></Field>
          </Grid>
        </Card>
        <Card title={u("inquiryLines")}>
          <div className="hidden grid-cols-[150px_150px_2fr_80px_70px_120px] gap-2 text-xs text-navy/70 md:grid"><span>{u("partSku")}</span><span>{u("vendorPartNo")}</span><span>{t("description")}</span><span>{t("qty")}</span><span>{u("uom")}</span><span>{t("asset")}</span></div>
          <RevealRows initial={Math.max(prefill.length, 2)} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => { const l = prefill[i]; return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[150px_150px_2fr_80px_70px_120px]">
                <input name={`s${i}`} list="parts" defaultValue={l?.partSku ?? ""} className={`${inputCls} font-mono`} />
                <input name={`v${i}`} defaultValue={l?.vendorPartNo ?? ""} className={`${inputCls} font-mono`} />
                <input name={`d${i}`} defaultValue={l?.description ?? ""} className={inputCls} />
                <input name={`q${i}`} type="number" step="0.001" defaultValue={l?.qty ?? ""} className={inputCls} />
                <input name={`u${i}`} defaultValue={l?.unit ?? "pcs"} className={inputCls} />
                <input name={`a${i}`} defaultValue={l?.assetCode ?? ""} className={`${inputCls} font-mono`} />
              </div>); })}
          </RevealRows>
          <datalist id="parts">{parts.map((p) => <option key={p.sku} value={p.sku}>{p.vendorPartNo} · {p.name}</option>)}</datalist>
          <p className="text-xs text-navy/70">{u("inquiryLinesNote")}</p>
        </Card>
      </form>
    </div>
  );
}
