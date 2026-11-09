import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { addSupplierQuote, createPurchaseOrder, selectSupplierQuote, type InquiryLine } from "@/server/purchasing";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { Card, Field, Grid, PageHeader, Table, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };

/** PRTH detail — the comparison table: one column per supplier quote, the selected one feeds costs into the QTTH. */
export default async function Inquiry({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const [t, u, ts] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("inquiryStatus")]);
  const inq = await prisma.purchaseInquiry.findUnique({ where: { no }, include: { serviceOrder: { select: { no: true, lockedAt: true, warrantyDays: true, customer: { select: { name: true } } } }, requestedBy: { select: { name: true } }, quotes: { orderBy: { createdAt: "asc" }, include: { supplier: true } }, orders: { select: { no: true, status: true } } } });
  if (!inq) notFound();
  const sub = inq.kind === "SUBCONTRACT"; // 合作维修: partners only, warranty + repair plan, warranty back-to-back on the POTH
  const suppliers = await prisma.supplier.findMany({ where: { active: true, ...(sub ? { isPartner: true } : {}) }, orderBy: { name: "asc" } });
  const lines = inq.lines as InquiryLine[];
  const selected = inq.quotes.find((q) => q.selected);
  const open = inq.status === "OPEN" || inq.status === "COMPARED";
  const qp = (q: (typeof inq.quotes)[number], lineNo: number) => (q.lines as { lineNo: number; unitPrice: number; amount: number }[]).find((l) => l.lineNo === lineNo);

  async function addQuote(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const qlines = lines.map((l, i) => ({ lineNo: l.lineNo, vendorPartNo: str(f, `v${i}`), qty: Number(str(f, `q${i}`) ?? l.qty), unit: l.unit, unitPrice: Number(str(f, `p${i}`) ?? -1) })).filter((l) => l.unitPrice >= 0);
      if (!qlines.length) throw new Error("QUOTE_NEEDS_LINE");
      const vat = str(f, "vatRate");
      await addSupplierQuote({ inquiryNo: no, actorCode: me.code, supplierId: String(f.get("supplierId")), quoteNo: str(f, "quoteNo"), quoteDate: str(f, "quoteDate") ? new Date(str(f, "quoteDate")!) : undefined, validUntil: str(f, "validUntil") ? new Date(str(f, "validUntil")!) : undefined, currency: str(f, "currency") ?? "THB", vatRate: vat ? Number(vat) : undefined, leadTimeDays: str(f, "leadTime") ? Number(str(f, "leadTime")) : undefined, paymentTerms: str(f, "paymentTerms"), warrantyDays: str(f, "warrantyDays") ? Number(str(f, "warrantyDays")) : undefined, solution: str(f, "solution"), lines: qlines, attachments: JSON.parse(String(f.get("attachments") || "[]")) });
      return { ok: no, to: `/purchasing/inquiries/${no}` };
    }, `/purchasing/inquiries/${no}`);
  }
  async function select(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await selectSupplierQuote({ inquiryNo: no, quoteId: String(f.get("quoteId")), actorCode: me.code }); return { ok: no, to: `/purchasing/inquiries/${no}` }; }, `/purchasing/inquiries/${no}`);
  }
  async function raisePo() {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const inq2 = await prisma.purchaseInquiry.findUniqueOrThrow({ where: { no }, include: { quotes: { where: { selected: true } }, serviceOrder: { select: { warrantyDays: true } } } });
      const q = inq2.quotes[0];
      if (!q) throw new Error("QUOTE_NOT_SELECTED");
      const il = inq2.lines as InquiryLine[];
      const polines = (q.lines as { lineNo: number; vendorPartNo?: string; qty: number; unitPrice: number }[]).map((l) => { const src = il.find((x) => x.lineNo === l.lineNo); return { partSku: src?.partSku, vendorPartNo: l.vendorPartNo ?? src?.vendorPartNo, description: src?.description ?? "", qty: l.qty, unit: src?.unit ?? "pcs", unitPrice: l.unitPrice }; });
      const isSub = inq2.kind === "SUBCONTRACT";
      const po = await createPurchaseOrder({ actorCode: me.code, supplierId: q.supplierId, inquiryNo: no, kind: inq2.kind, warrantyDays: isSub ? (inq2.serviceOrder?.warrantyDays ?? q.warrantyDays ?? undefined) : undefined, scope: isSub ? (q.solution ?? undefined) : undefined, expectedAt: isSub && q.leadTimeDays ? new Date(Date.now() + q.leadTimeDays * 86_400_000) : undefined, currency: q.currency, vatRate: q.vatRate != null ? Number(q.vatRate) : undefined, paymentTerms: q.paymentTerms ?? undefined, supplierRef: q.quoteNo ?? undefined, lines: polines });
      return { ok: po.no, to: `/purchasing/orders/${po.no}` };
    }, `/purchasing/inquiries/${no}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/purchasing/inquiries", label: u("inquiries") }} title={<span className="font-mono">{inq.no}</span>} badge={<><Tag hot={inq.status === "OPEN"}>{ts(inq.status)}</Tag>{sub && <Tag>{u("partnerRepair")}</Tag>}</>}
        actions={inq.status === "COMPARED" && inq.orders.length === 0 && !inq.serviceOrder?.lockedAt ? <form action={raisePo}><button className={btnBlue}>{u("raisePo")} →</button></form> : null} />
      <Flash ok={ok} error={error} />
      <Card title={u("inquiryHeader")}>
        <div className="grid gap-2 text-sm md:grid-cols-4">
          <div><span className="text-navy/60">QTTH</span><br />{inq.serviceOrder ? <Link href={`/service-orders/${inq.serviceOrder.no}`} className="font-mono text-blue hover:underline">{inq.serviceOrder.no}</Link> : "—"}{inq.serviceOrder ? <span className="block text-xs text-navy/70">{inq.serviceOrder.customer.name}</span> : null}</div>
          <div><span className="text-navy/60">{u("requestedBy")}</span><br />{inq.requestedBy.name} · {inq.createdAt.toISOString().slice(0, 10)}</div>
          <div><span className="text-navy/60">{u("neededBy")}</span><br />{inq.neededBy?.toISOString().slice(0, 10) ?? "—"}</div>
          <div><span className="text-navy/60">POTH</span><br />{inq.orders.length ? inq.orders.map((o) => <Link key={o.no} href={`/purchasing/orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link>) : "—"}</div>
        </div>
        {inq.note && <p className="mt-2 text-sm">{inq.note}</p>}
      </Card>

      <Card title={u("comparison")}>
        <Table head={["#", u("partSku"), t("description"), t("qty"), ...inq.quotes.map((q) => <span key={q.id} className={q.selected ? "text-blue" : ""}>{q.supplier.name}{q.selected ? " ✓" : ""}</span>)]}>
          {lines.map((l) => <tr key={l.lineNo}><td>{l.lineNo}</td><td className="font-mono">{l.partSku ?? l.vendorPartNo ?? ""}</td><td>{l.description}</td><td>{l.qty} {l.unit}</td>{inq.quotes.map((q) => { const p = qp(q, l.lineNo); return <td key={q.id} className={`text-right ${q.selected ? "font-semibold text-blue" : ""}`}>{p ? `${Number(p.unitPrice).toFixed(2)}` : "—"}</td>; })}</tr>)}
          <tr className="font-semibold"><td colSpan={4}>{t("subtotal")}</td>{inq.quotes.map((q) => <td key={q.id} className={`text-right ${q.selected ? "text-blue" : ""}`}>{q.currency} {Number(q.subtotal).toFixed(2)}</td>)}</tr>
          {sub && <tr className="text-xs"><td colSpan={4}>{u("partnerWarranty")}{inq.serviceOrder?.warrantyDays != null ? ` (${u("customerPromise", { days: inq.serviceOrder.warrantyDays })})` : ""}</td>{inq.quotes.map((q) => <td key={q.id} className={`text-right ${inq.serviceOrder?.warrantyDays != null && (q.warrantyDays ?? 0) < inq.serviceOrder.warrantyDays ? "font-semibold text-alert-ink" : ""}`}>{q.warrantyDays != null ? `${q.warrantyDays} d` : "—"}</td>)}</tr>}
          {sub && <tr className="text-xs"><td colSpan={4}>{u("partnerSolution")}</td>{inq.quotes.map((q) => <td key={q.id} className="text-right">{q.solution ?? "—"}</td>)}</tr>}
          <tr className="text-xs text-navy/70"><td colSpan={4}>{u("quoteNo")} · {u("leadTime")} · {u("validUntil")}</td>{inq.quotes.map((q) => <td key={q.id} className="text-right">{q.quoteNo ?? "—"} · {q.leadTimeDays != null ? `${q.leadTimeDays} d` : "—"} · {q.validUntil?.toISOString().slice(0, 10) ?? "—"}</td>)}</tr>
          {open && inq.quotes.length > 0 && <tr><td colSpan={4}></td>{inq.quotes.map((q) => <td key={q.id} className="text-right">{q.selected ? <Tag>{u("selectedQuote")}</Tag> : <form action={select}><input type="hidden" name="quoteId" value={q.id} /><button className={btnGhost}>{u("selectQuote")}</button></form>}</td>)}</tr>}
        </Table>
        {inq.quotes.length === 0 && <p className="py-4 text-center text-sm text-navy/60">{u("noQuotesYet")}</p>}
        {selected && inq.serviceOrder && <p className="text-xs text-navy/70">{u("costFlowedBack", { order: inq.serviceOrder.no })}</p>}
      </Card>

      {open && (<>
        <FormMemory formId="q" />
        <UploadRecognize kind="purchase" formId="q" title={u("upSupplierQuoteTitle")} hint={u("upSupplierQuoteHint")} lineFields={{ vendorPartNo: "v", unitPrice: "p", qty: "q" }} />
        <form id="q" action={addQuote}>
          <Card title={u("addSupplierQuote")}>
            <Grid>
              <Field label={u("supplier")} required><select name="supplierId" required className={inputCls}><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}</select></Field>
              <Field label={u("quoteNo")}><input name="quoteNo" className={`${inputCls} font-mono`} /></Field>
              <Field label={u("quoteDate")}><input name="quoteDate" type="date" className={inputCls} /></Field>
              <Field label={u("validUntil")}><input name="validUntil" type="date" className={inputCls} /></Field>
              <Field label={t("currency")}><select name="currency" className={inputCls}>{["THB", "USD", "CNY", "EUR", "JPY"].map((c) => <option key={c}>{c}</option>)}</select></Field>
              <Field label={u("vatRateDec")}><input name="vatRate" type="number" step="0.0001" defaultValue="0.07" className={inputCls} /></Field>
              <Field label={u("leadTime")}><input name="leadTime" type="number" className={inputCls} /></Field>
              <Field label={u("paymentTerms")}><input name="paymentTerms" className={inputCls} /></Field>
              {sub && <Field label={u("partnerWarranty")} required><input name="warrantyDays" type="number" min="0" required defaultValue={inq.serviceOrder?.warrantyDays ?? ""} className={inputCls} /></Field>}
            </Grid>
            {sub && <Field label={u("partnerSolution")}><textarea name="solution" rows={2} className={inputCls} /></Field>}
            <Table head={["#", t("description"), u("vendorPartNo"), t("qty"), u("unitPriceExVat")]}>
              {lines.map((l, i) => <tr key={l.lineNo}><td>{l.lineNo}</td><td>{l.description}</td><td><input name={`v${i}`} defaultValue={l.vendorPartNo ?? ""} className={`${inputCls} font-mono`} /></td><td><input name={`q${i}`} type="number" step="0.001" defaultValue={l.qty} className={inputCls} /></td><td><input name={`p${i}`} type="number" step="0.01" className={inputCls} /></td></tr>)}
            </Table>
            <p className="text-xs text-navy/70">{u("supplierQuoteNote")}</p>
            <div className="mt-2 text-right"><button className={btnPrimary}>{u("saveSupplierQuote")}</button></div>
          </Card>
        </form>
      </>)}
    </div>
  );
}
