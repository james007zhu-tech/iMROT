import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { receivePurchaseOrder } from "@/server/purchasing";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { Alert, Card, Field, Grid, PageHeader, Table, Tag, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
type PoLine = { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; unitPrice: number; amount: number; receivedQty: number };

/** POTH detail — lines, what has arrived, and the receipt form that posts an IBTH against the order. */
export default async function PurchaseOrder({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("poStatus")]);
  const po = await prisma.purchaseOrder.findUnique({ where: { no }, include: { supplier: true, inquiry: { select: { no: true } }, serviceOrder: { select: { no: true, customer: { select: { name: true } } } }, createdBy: { select: { name: true } }, receipts: { orderBy: { movedAt: "asc" }, include: { part: { select: { sku: true } } } } } });
  if (!po) notFound();
  const lines = po.lines as PoLine[];
  const openPo = po.status !== "RECEIVED" && po.status !== "CANCELLED";
  async function markSent() {
    "use server";
    await guarded(async () => { await prisma.purchaseOrder.update({ where: { no }, data: { status: "SENT" } }); return { ok: no, to: `/purchasing/orders/${no}` }; }, `/purchasing/orders/${no}`);
  }
  async function receive(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const received = lines.map((l, i) => ({ lineNo: l.lineNo, qty: Number(str(f, `r${i}`) ?? 0), batch: str(f, `b${i}`) })).filter((r) => r.qty > 0);
      const r = await receivePurchaseOrder({ poNo: no, actorCode: me.code, supplierRef: str(f, "supplierRef"), movedAt: str(f, "movedAt") ? new Date(str(f, "movedAt")!) : undefined, received, attachments: JSON.parse(String(f.get("attachments") || "[]")) });
      return { ok: r.ibthNo, to: `/purchasing/orders/${no}` };
    }, `/purchasing/orders/${no}`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const receiptsByNo = new Map<string, typeof po.receipts>();
  for (const r of po.receipts) receiptsByNo.set(r.no, [...(receiptsByNo.get(r.no) ?? []), r]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/purchasing/orders", label: u("purchaseOrders") }} title={<span className="font-mono">{po.no}</span>} badge={<Tag hot={po.status === "SENT" || po.status === "PARTIAL"}>{ts(po.status)}</Tag>}
        actions={po.status === "DRAFT" ? <form action={markSent}><button className={btnGhost}>{u("markSent")}</button></form> : null} />
      <Flash ok={ok} error={error?.startsWith("UNKNOWN_SKU") ? undefined : error} />
      {error?.startsWith("UNKNOWN_SKU") && <Alert>{u("unknownSku", { list: error.split(":").slice(1).join(":") })} {error.split(":").slice(1).join(":").split(",").map((s) => <Link key={s} href={`/parts/new?vendor=${encodeURIComponent(s.replace(/^[A-Z]{2,4}-/, ""))}&back=/purchasing/orders/${po.no}`} className="ml-2 underline">＋ {s}</Link>)}</Alert>}
      <Card title={u("poHeader")}>
        <div className="grid gap-2 text-sm md:grid-cols-4">
          <div><span className="text-navy/60">{u("supplier")}</span><br /><b>{po.supplier.name}</b>{po.supplier.contactName ? <span className="block text-xs text-navy/70">{po.supplier.contactName}{po.supplier.phone ? ` · ${po.supplier.phone}` : ""}</span> : null}</div>
          <div><span className="text-navy/60">PRTH / QTTH</span><br />{po.inquiry ? <Link href={`/purchasing/inquiries/${po.inquiry.no}`} className="font-mono text-blue hover:underline">{po.inquiry.no}</Link> : "—"} / {po.serviceOrder ? <Link href={`/service-orders/${po.serviceOrder.no}`} className="font-mono text-blue hover:underline">{po.serviceOrder.no}</Link> : "—"}</div>
          <div><span className="text-navy/60">{u("quoteNo")} · {u("paymentTerms")}</span><br />{po.supplierRef ?? "—"} · {po.paymentTerms ?? "—"}</div>
          <div><span className="text-navy/60">{t("date")} · {u("expectedAt")}</span><br />{po.orderedAt.toISOString().slice(0, 10)} · {po.expectedAt?.toISOString().slice(0, 10) ?? "—"}</div>
        </div>
      </Card>
      <Card title={u("poLines")}>
        <Table head={["#", u("partSku"), u("vendorPartNo"), t("description"), t("qty"), u("unitPriceExVat"), t("amount"), u("received")]}>
          {lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td className="font-mono">{l.partSku ? <Link href={`/parts/${l.partSku}`} className="text-blue hover:underline">{l.partSku}</Link> : <span className="text-alert-ink">{u("noSkuYet")}</span>}</td><td className="font-mono">{l.vendorPartNo ?? ""}</td><td>{l.description}</td><td>{l.qty} {l.unit}</td><td className="text-right">{l.unitPrice.toFixed(2)}</td><td className="text-right">{l.amount.toFixed(2)}</td><td className={l.receivedQty < l.qty ? "font-semibold text-alert-ink" : ""}>{l.receivedQty} / {l.qty}</td></tr>)}
        </Table>
        <p className="text-right text-[13px]">{t("subtotal")} {Number(po.subtotal).toFixed(2)} · {t("vat")} {(Number(po.vatRate) * 100).toFixed(0)}% {Number(po.vatAmount).toFixed(2)} · <b>{t("total")} {po.currency} {Number(po.total).toFixed(2)}</b>{po.totalCny != null ? ` · CNY ${Number(po.totalCny).toFixed(2)}` : ""}</p>
      </Card>
      {receiptsByNo.size > 0 && <Card title={u("receiptsIb")}>
        <Table head={["IBTH", t("date"), u("partSku"), t("qty"), u("unitCost"), u("supplierDocNo")]}>
          {[...receiptsByNo.entries()].flatMap(([ibNo, rs]) => rs.map((r, i) => <tr key={r.id}><td className="font-mono">{i === 0 ? ibNo : ""}</td><td>{r.movedAt.toISOString().slice(0, 10)}</td><td className="font-mono">{r.part?.sku ?? ""}</td><td>{Number(r.qty)}</td><td className="text-right">{r.unitCost != null ? Number(r.unitCost).toFixed(2) : ""}</td><td>{r.supplierRef ?? ""}</td></tr>))}
        </Table>
      </Card>}
      {openPo && (<>
        <FormMemory formId="r" />
        <UploadRecognize kind="stock" formId="r" title={u("upReceiptTitle")} hint={u("upReceiptHint")} />
        <form id="r" action={receive}>
          <Card title={u("receiveGoods")}>
            <Grid>
              <Field label={u("supplierDocNo")}><input name="supplierRef" defaultValue={po.supplierRef ?? ""} className={`${inputCls} font-mono`} /></Field>
              <Field label={u("receivedOn")}><input name="movedAt" type="date" defaultValue={today} className={inputCls} /></Field>
            </Grid>
            <Table head={["#", t("description"), u("outstanding"), u("receiveNow"), u("batch")]}>
              {lines.map((l, i) => { const due = l.qty - l.receivedQty; return <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description}{!l.partSku ? <span className="block text-xs text-alert-ink">{u("poLineNeedsSku")}</span> : null}</td><td>{due}</td><td><input name={`r${i}`} type="number" step="0.001" max={due} defaultValue={due > 0 ? due : ""} disabled={!l.partSku || due <= 0} className={inputCls} /></td><td><input name={`b${i}`} className={inputCls} /></td></tr>; })}
            </Table>
            <p className="text-xs text-navy/70">{u("receiveNote")}</p>
            <div className="mt-2 text-right"><button className={btnPrimary}>{u("saveReceipt")}</button></div>
          </Card>
        </form>
      </>)}
    </div>
  );
}
