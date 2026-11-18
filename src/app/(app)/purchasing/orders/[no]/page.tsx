import { can, hasRole } from "@/lib/caps";
import { FxDoc } from "@/components/FxDoc";
import { docRateNote } from "@/server/fx";
import { fxMark } from "@/lib/fx-label";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { receivePurchaseOrder, askPoApproval, decidePurchaseOrder, sendPurchaseOrder } from "@/server/purchasing";
import { registerSupplierInvoice } from "@/server/srm";
import { mismatch } from "@/lib/pay-rules";
import { findPart } from "@/server/scm";
import { guessBrand } from "@/lib/part-guess";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { Alert, Card, Field, Grid, PageHeader, Table, Tag, btnGhost, btnPrimary, inputCls, btnBlue } from "@/components/ui";

export const dynamic = "force-dynamic";
const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
type PoLine = { lineNo: number; partSku?: string; vendorPartNo?: string; description: string; qty: number; unit: string; unitPrice: number; amount: number; receivedQty: number };

/** POTH detail — lines, what has arrived, and the receipt form that posts an IBTH against the order. */
export default async function PurchaseOrder({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("poStatus")]);
  const po = await prisma.purchaseOrder.findUnique({ where: { no }, include: { supplier: true, inquiry: { select: { no: true } }, serviceOrder: { select: { no: true, customer: { select: { name: true } } } }, createdBy: { select: { name: true } }, receipts: { orderBy: { movedAt: "asc" }, include: { part: { select: { sku: true } } } }, invoices: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "asc" } } } });
  if (!po) notFound();
  const lines = po.lines as PoLine[];
  const openPo = po.status !== "RECEIVED" && po.status !== "CANCELLED";
  async function markSent() {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await sendPurchaseOrder({ no, actorCode: me.code }); return { ok: no, to: `/purchasing/orders/${no}` }; }, `/purchasing/orders/${no}`);
  }
  async function askApproval() {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await askPoApproval({ no, actorCode: me.code }); return "poAsked"; }, `/purchasing/orders/${no}`);
  }
  async function decide(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await decidePurchaseOrder({ no, actorCode: me.code, approve: f.get("decision") === "yes", note: String(f.get("note") ?? "") }); return f.get("decision") === "yes" ? "poApproved" : "poRefused"; }, `/purchasing/orders/${no}`);
  }
  async function receive(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const received = lines.map((l, i) => ({ lineNo: l.lineNo, qty: Number(str(f, `r${i}`) ?? 0), batch: str(f, `b${i}`) })).filter((r) => r.qty > 0);
      const newParts = lines.map((l, i) => ({ lineNo: l.lineNo, brandCode: str(f, `nb${i}`), vendorPartNo: str(f, `nv${i}`) ?? "", name: str(f, `nn${i}`) ?? "" })).filter((x) => x.vendorPartNo || x.name);
      const confirmedLines = lines.filter((_, i) => f.get(`sk${i}`) === "on").map((l) => l.lineNo);
      const r = await receivePurchaseOrder({ poNo: no, actorCode: me.code, newParts, confirmedLines, supplierRef: str(f, "supplierRef"), movedAt: str(f, "movedAt") ? new Date(str(f, "movedAt")!) : undefined, received, attachments: JSON.parse(String(f.get("attachments") || "[]")) });
      return { ok: r.ibthNo, to: `/purchasing/orders/${no}` };
    }, `/purchasing/orders/${no}`);
  }
  async function invoice(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const inv = await registerSupplierInvoice({ poNo: no, actorCode: me.code, invoiceNo: String(f.get("invoiceNo") ?? ""), invoiceDate: str(f, "invoiceDate") ? new Date(str(f, "invoiceDate")!) : new Date(), subtotal: Number(f.get("subtotal")), vatAmount: str(f, "vatAmount") ? Number(str(f, "vatAmount")) : undefined, attachments: JSON.parse(String(f.get("invoiceFiles") || "[]")) });
      return { ok: inv.invoiceNo, to: `/purchasing/orders/${no}` };
    }, `/purchasing/orders/${no}`);
  }
  const me = await currentEmployee();
  const seeCost = can.cost(me), fin = can.finance(me);
  // 暂估 and 三单匹配: what was received and not yet invoiced, and how each invoice sits against the receipts
  const accrual = po.invoices.find((i) => i.accrued), invoices = po.invoices.filter((i) => !i.accrued);
  const mayInvoice = po.kind === "PARTS" && (po.status === "PARTIAL" || po.status === "RECEIVED") && invoices.reduce((x, i) => x + Number(i.subtotal), 0) < Number(po.subtotal) - 0.01;
  const today = localIso(new Date())!.slice(0, 10);
  // 入库必须有料号: which lines the library does not know yet — those get the 新建料号 fields, filled from the POTH
  const bySku = await Promise.all(lines.map((l) => findPart(l.partSku).catch(() => null)));
  const guessed = await Promise.all(lines.map((l, i) => (bySku[i] ? null : findPart(l.vendorPartNo).catch(() => null)))); // matched by maker's number only: a suggestion to confirm
  const known = lines.map((_, i) => !!(bySku[i] ?? guessed[i]));
  const brands = known.every(Boolean) ? [] : await prisma.brand.findMany({ orderBy: { name: "asc" }, select: { code: true, name: true } });
  const receiptsByNo = new Map<string, typeof po.receipts>();
  for (const r of po.receipts) receiptsByNo.set(r.no, [...(receiptsByNo.get(r.no) ?? []), r]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/purchasing/orders", label: u("purchaseOrders") }} title={<span className="font-mono">{po.no}</span>} badge={<Tag hot={po.status === "SENT" || po.status === "PARTIAL"}>{ts(po.status)}</Tag>}
        actions={po.status !== "DRAFT" || !can.purchase(me) ? null : po.approvedAt ? <form action={markSent}><button className={btnBlue}>{u("markSent")}</button></form>
          : po.approvalAskedAt ? <span className="rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-3 py-2 text-sm text-[#7A4A00]">{u("poWaitingMd")}</span>
          : <form action={askApproval}><button className={btnBlue}>{u("poAsk")}</button></form>} />
      {/* 所有 PO 都要 MD 审批 (2026-11-17): the state, the MD's two buttons, and why nothing can be sent or received yet */}
      {po.status === "DRAFT" && !po.approvedAt && po.approvalNote && <Alert>{u("poRefusedNote", { note: po.approvalNote })}</Alert>}
      {po.status === "DRAFT" && po.approvedAt && <p className="text-sm text-navy">✓ {u("poApprovedBy", { by: po.approvedBy ?? "MD" })}</p>}
      {po.status === "DRAFT" && po.approvalAskedAt && !po.approvedAt && hasRole(me, "MD") && <Card title={u("poDecide")} accent>
        <form action={decide} className="flex flex-wrap items-end gap-3 text-sm">
          <input name="note" placeholder={u("poDecideNotePh")} className={`${inputCls} w-72`} />
          <button name="decision" value="yes" className={btnBlue}>{u("poApprove")}</button><button name="decision" value="no" className={btnGhost}>{u("poRefuse")}</button>
        </form></Card>}
      <Flash ok={ok} error={error?.startsWith("UNKNOWN_SKU") ? undefined : error} />
      {seeCost && po.fxRateToCny != null && <FxDoc kind="po" no={po.no} back={`/purchasing/orders/${po.no}`} canEdit={can.finance(me)} currency={po.currency} current={Number(po.fxRateToCny)} note={await docRateNote(po.no, po)} />}
      {error?.startsWith("UNKNOWN_SKU") && <Alert>{u("unknownSku", { list: error.split(":").slice(1).join(":") })} {error.split(":").slice(1).join(":").split(",").map((s) => <Link key={s} href={`/parts/new?vendor=${encodeURIComponent(s.replace(/^[A-Z]{2,4}-/, ""))}&back=/purchasing/orders/${po.no}`} className="ml-2 underline">＋ {s}</Link>)}</Alert>}
      <Card title={u("poHeader")}>
        <div className="grid gap-2 text-sm md:grid-cols-4">
          <div><span className="text-navy/60">{u("supplier")}</span><br /><b>{po.supplier.name}</b>{po.supplier.contactName ? <span className="block text-xs text-navy/70">{po.supplier.contactName}{po.supplier.phone ? ` · ${po.supplier.phone}` : ""}</span> : null}</div>
          <div><span className="text-navy/60">PRTH / QTTH</span><br />{po.inquiry ? <Link href={`/purchasing/inquiries/${po.inquiry.no}`} className="font-mono text-blue hover:underline">{po.inquiry.no}</Link> : "—"} / {po.serviceOrder ? <Link href={`/service-orders/${po.serviceOrder.no}`} className="font-mono text-blue hover:underline">{po.serviceOrder.no}</Link> : "—"}</div>
          <div><span className="text-navy/60">{u("quoteNo")} · {u("paymentTerms")}</span><br />{po.supplierRef ?? "—"} · {po.paymentTerms ?? "—"}</div>
          <div><span className="text-navy/60">{t("date")} · {u("expectedAt")}</span><br />{localIso(po.orderedAt)!.slice(0, 10)} · {localIso(po.expectedAt)?.slice(0, 10) ?? "—"}</div>
        </div>
      </Card>
      <Card title={u("poLines")}>
        <Table head={["#", u("partSku"), u("vendorPartNo"), t("description"), t("qty"), ...(seeCost ? [u("unitPriceExVat"), t("amount")] : []), u("received")]}>
          {lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td className="font-mono">{l.partSku ? <Link href={`/parts/${l.partSku}`} className="text-blue hover:underline">{l.partSku}</Link> : <span className="text-alert-ink">{u("noSkuYet")}</span>}</td><td className="font-mono">{l.vendorPartNo ?? ""}</td><td>{l.description}</td><td>{l.qty} {l.unit}</td>{seeCost && <><td className="text-right">{l.unitPrice.toFixed(2)}</td><td className="text-right">{l.amount.toFixed(2)}</td></>}<td className={l.receivedQty < l.qty ? "font-semibold text-alert-ink" : ""}>{l.receivedQty} / {l.qty}</td></tr>)}
        </Table>
        {seeCost && <p className="text-right text-[13px]">{t("subtotal")} {Number(po.subtotal).toFixed(2)} · {t("vat")} {(Number(po.vatRate) * 100).toFixed(0)}% {Number(po.vatAmount).toFixed(2)} · <b>{t("total")} {po.currency} {Number(po.total).toFixed(2)}</b>{po.totalCny != null ? ` · CNY ${Number(po.totalCny).toFixed(2)} @${Number(po.fxRateToCny).toFixed(4)}（${fxMark(u, po.fxSource, po.fxRateDate, po.fxBy)}）` : ""}</p>}
      </Card>
      {receiptsByNo.size > 0 && <Card title={u("receiptsIb")}>
        <Table head={["IBTH", t("date"), u("partSku"), t("qty"), ...(seeCost ? [u("unitCost")] : []), u("supplierDocNo")]}>
          {[...receiptsByNo.entries()].flatMap(([ibNo, rs]) => rs.map((r, i) => <tr key={r.id}><td className="font-mono">{i === 0 ? ibNo : ""}</td><td>{localIso(r.movedAt)!.slice(0, 10)}</td><td className="font-mono">{r.part?.sku ?? ""}</td><td>{Number(r.qty)}</td>{seeCost && <td className="text-right">{r.unitCost != null ? Number(r.unitCost).toFixed(2) : ""}</td>}<td>{r.supplierRef ?? ""}</td></tr>))}
        </Table>
      </Card>}
      {fin && po.kind === "PARTS" && (accrual || invoices.length > 0 || mayInvoice) && <Card title={u("supplierInvoices")}>
        {(accrual || invoices.length > 0) && <Table head={[u("supplierInvoiceNo"), t("date"), t("subtotal"), t("vat"), u("payableAmount"), u("dueDate"), t("status")]}>
          {invoices.map((i) => { const off = mismatch(i.matchDiff == null ? null : Number(i.matchDiff), Number(i.subtotal) - Number(i.matchDiff ?? 0)); return (
            <tr key={i.id}><td className="font-mono">{i.invoiceNo}</td><td>{localIso(i.invoiceDate)!.slice(0, 10)}</td><td className="text-right">{Number(i.subtotal).toFixed(2)}</td><td className="text-right">{Number(i.vatAmount).toFixed(2)}</td><td className="text-right font-semibold">{i.currency} {Number(i.payable).toFixed(2)}</td><td>{localIso(i.dueDate)!.slice(0, 10)}</td>
              <td><Tag hot={off && !i.mdApprovedAt}>{off ? (i.mdApprovedAt ? u("matchReleased") : u("matchOff", { diff: Number(i.matchDiff).toFixed(2) })) : u(`payable_${i.status}`)}</Tag>{i.paymentNo ? <span className="ml-1 font-mono text-xs">{i.paymentNo}</span> : null}</td></tr>); })}
          {accrual && <tr><td>{u("accrued")}</td><td>{localIso(accrual.invoiceDate)!.slice(0, 10)}</td><td className="text-right">{Number(accrual.subtotal).toFixed(2)}</td><td className="text-right">{Number(accrual.vatAmount).toFixed(2)}</td><td className="text-right font-semibold">{accrual.currency} {Number(accrual.payable).toFixed(2)}</td><td>{localIso(accrual.dueDate)!.slice(0, 10)}</td><td><Tag hot>{u("accruedWaits")}</Tag></td></tr>}
        </Table>}
        {mayInvoice && <form action={invoice} className="mt-3 space-y-2 rounded-lg border p-3">
          <div className="text-sm font-semibold text-navy">{u("registerSupplierInvoice")}</div>
          <Grid>
            <Field label={u("supplierInvoiceNo")} required><input name="invoiceNo" required className={`${inputCls} font-mono`} /></Field>
            <Field label={t("date")} required><input name="invoiceDate" type="date" required defaultValue={today} className={inputCls} /></Field>
            <Field label={`${t("subtotal")} (${po.currency})`} required><input name="subtotal" type="number" step="0.01" min="0.01" inputMode="decimal" required defaultValue={accrual ? Number(accrual.subtotal).toFixed(2) : ""} className={inputCls} /></Field>
            <Field label={`${t("vat")} ${(Number(po.vatRate) * 100).toFixed(0)}%`}><input name="vatAmount" type="number" step="0.01" min="0" inputMode="decimal" placeholder={u("vatAutoPh")} className={inputCls} /></Field>
          </Grid>
          <p className="text-xs text-navy/70">{u("supplierInvoiceMatchHint")}</p>
          <div className="text-right"><button className={btnPrimary}>{u("registerSupplierInvoice")}</button></div>
        </form>}
      </Card>}
      {openPo && !po.approvedAt && <Alert>{u("poNotApproved")}</Alert>}
      {openPo && po.approvedAt && (<>
        <FormMemory formId="r" />
        <UploadRecognize kind="stock" formId="r" title={u("upReceiptTitle")} hint={u("upReceiptHint")} />
        <form id="r" action={receive}>
          <Card title={u("receiveGoods")}>
            <Grid>
              <Field label={u("supplierDocNo")}><input name="supplierRef" defaultValue={po.supplierRef ?? ""} className={`${inputCls} font-mono`} /></Field>
              <Field label={u("receivedOn")}><input name="movedAt" type="date" defaultValue={today} className={inputCls} /></Field>
            </Grid>
            <Table head={["#", t("description"), u("outstanding"), u("receiveNow"), u("batch")]}>
              {lines.map((l, i) => { const due = l.qty - l.receivedQty; const lacks = !known[i] && due > 0; return <tr key={l.lineNo} className={lacks ? "bg-[#FFF4E5]" : ""}><td>{l.lineNo}</td>
                <td>{l.description}
                  {bySku[i] && <div className="font-mono text-xs text-navy/60">{bySku[i]!.sku}</div>}
                  {guessed[i] && due > 0 && <label className="mt-1 flex items-start gap-2 rounded-lg border border-[#E6A23C] bg-[#FFF4E5] p-2 text-xs text-[#7A4A00]"><input type="checkbox" name={`sk${i}`} className="mt-0.5" /><span>{u("poLineSuggest", { n: l.lineNo, sku: guessed[i]!.sku, name: guessed[i]!.name })} <Link href={`/parts/new?vendor=${encodeURIComponent(l.vendorPartNo ?? "")}&back=/purchasing/orders/${po.no}`} className="underline">{u("poLineSuggestOther")}</Link></span></label>}
                  {lacks && <div className="mt-1 space-y-1 rounded-lg border border-[#E6A23C] bg-white p-2">
                    <div className="text-xs font-semibold text-[#7A4A00]">{u("poLineNewPart", { n: l.lineNo })}</div>
                    <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
                      <label className="text-xs text-navy/70">{u("newPartBrand")}<select name={`nb${i}`} defaultValue={guessBrand(l.description, brands) ?? ""} className={inputCls}><option value="">{u("newPartNoBrand")}</option>{brands.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}</select></label>
                      <label className="text-xs text-navy/70">{u("newPartVendorNo")} *<input name={`nv${i}`} defaultValue={l.vendorPartNo ?? l.partSku ?? ""} className={`${inputCls} font-mono`} /></label>
                      <label className="text-xs text-navy/70">{u("newPartName")} *<input name={`nn${i}`} defaultValue={l.description} className={inputCls} /></label>
                    </div>
                  </div>}
                </td><td>{due}</td><td><input name={`r${i}`} type="number" step="0.001" max={due} defaultValue={due > 0 ? due : ""} disabled={due <= 0} className={inputCls} /></td><td><input name={`b${i}`} className={inputCls} /></td></tr>; })}
            </Table>
            <p className="text-xs text-navy/70">{u("receiveNote")}</p>
            <div className="mt-2 text-right"><button className={btnPrimary}>{u("saveReceipt")}</button></div>
          </Card>
        </form>
      </>)}
    </div>
  );
}
