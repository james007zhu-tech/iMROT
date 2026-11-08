import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { decideTaxInvoiceVoid, issueInvoice, issueTaxInvoice, requestTaxInvoiceVoid } from "@/server/to";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { businessClosureOn } from "@/lib/closure";
import { Alert, Card, Field, Grid, Table, Tag, Value, btnGhost, inputCls } from "@/components/ui";
import { StepPage, dayNow, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 开票 — wireframe 9 (top half): TITH tax invoice in THB with Thai item names and VAT shown separately, then IVTH. */
export default async function Invoice({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const me = await currentEmployee();
  const fx = await prisma.fxRate.findFirst({ where: { currency: order.currency }, orderBy: { rateDate: "desc" } });
  const taxInvoices = await prisma.taxInvoice.findMany({ where: { serviceOrderId: order.id }, orderBy: { issuedAt: "asc" }, include: { invoices: { select: { no: true, cancelledAt: true, paidAmount: true } } } });
  const active = taxInvoices.find((x) => !x.voidedAt);
  const canIssue = !active; // first issue, or re-issue after every earlier TITH was voided
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + order.customer.paymentTermDays * 86400000).toISOString().slice(0, 10);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { lines: { orderBy: { lineNo: "asc" } } } });
      const lines = o.lines.map((l, i) => ({ descriptionLocal: str(f, `th${i}`) ?? l.descriptionLocal ?? "", descriptionEn: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice) }));
      const missing = lines.findIndex((l) => !l.descriptionLocal);
      if (missing >= 0) throw new Error(`THAI_NAME_REQUIRED:${missing + 1}`);
      const issuedAt = dayNow(str(f, "issuedAt"));
      const ti = await issueTaxInvoice({ serviceOrderNo: no, actorCode: me.code, issuedAt, lines });
      const iv = await issueInvoice({ serviceOrderNo: no, actorCode: me.code, taxInvoiceNo: ti.no, issuedAt });
      return { ok: `${ti.no} · ${iv.no}`, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/invoice`);
  }
  async function requestVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await requestTaxInvoiceVoid({ taxInvoiceNo: String(f.get("ti")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return "voidRequested"; }, `/service-orders/${no}/invoice`);
  }
  async function decideVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await decideTaxInvoiceVoid({ taxInvoiceNo: String(f.get("ti")), actorCode: me.code, decision: f.get("decision") as "APPROVED", note: str(f, "note") }); return f.get("decision") === "APPROVED" ? "voidApproved" : "voidRejected"; }, `/service-orders/${no}/invoice`);
  }
  const voidTag = (x: (typeof taxInvoices)[number]) => x.voidedAt ? <Tag hot>{u("tiVoided")}</Tag> : x.voidStatus === "REQUESTED" ? <Tag hot>{u("tiVoidRequested")}</Tag> : x.voidStatus === "REJECTED" ? <Tag>{u("tiVoidRejected")}</Tag> : <Tag>{u("tiValid")}</Tag>;
  return (
    <StepPage order={order} title={u("step_invoice")} ok={ok === "voidRequested" ? u("tiVoidRequested") : ok === "voidApproved" ? u("tiVoided") : ok === "voidRejected" ? u("tiVoidRejected") : ok} error={error} saveLabel={businessClosureOn() && canIssue ? u("issueTiIv") : ""} notice={businessClosureOn() ? undefined : u("closureOffNotice")}>
      {taxInvoices.length > 0 && (
        <Card title={<>{u("taxInvoicesIssued")} <Tag>{taxInvoices.length}</Tag></>}>
          <Table head={["TITH", u("bookNo"), u("issueDate"), t("total"), "IVTH", t("status"), u("voidReason"), ""]}>
            {taxInvoices.map((x) => (
              <tr key={x.id} className={x.voidedAt ? "text-navy/50 line-through" : ""}>
                <td className="font-mono"><a className="text-blue hover:underline" href={`/api/documents/${x.no}/render?format=pdf`}>{x.no}</a></td>
                <td className="font-mono text-xs">{x.bookNo ? `${x.bookNo} / ${x.bookSeq}` : "—"}</td>
                <td>{x.issuedAt.toISOString().slice(0, 10)}</td><td>{x.currency} {Number(x.total).toFixed(2)}</td>
                <td className="font-mono text-xs">{x.invoices.map((i) => <span key={i.no} className={`block ${i.cancelledAt ? "line-through" : ""}`}>{i.no}</span>)}</td>
                <td className="no-underline">{voidTag(x)}</td>
                <td className="text-xs">{x.voidRequestReason ?? ""}{x.voidDecisionNote ? <span className="block text-navy/60">MD: {x.voidDecisionNote}</span> : null}</td>
                <td className="text-xs">
                  {!x.voidedAt && x.voidStatus !== "REQUESTED" && <form action={requestVoid} className="flex gap-1"><input type="hidden" name="ti" value={x.no} /><input name="reason" required placeholder={u("voidReason")} className={`${inputCls} w-44`} /><button className={btnGhost}>{u("requestVoid")}</button></form>}
                  {x.voidStatus === "REQUESTED" && me.role === "MD" && <form action={decideVoid} className="flex gap-1"><input type="hidden" name="ti" value={x.no} /><input name="note" placeholder={t("note")} className={`${inputCls} w-36`} /><button name="decision" value="APPROVED" className="min-h-10 rounded-lg border border-alert px-3 text-sm font-semibold text-alert-ink">{u("approveVoid")}</button><button name="decision" value="REJECTED" className={btnGhost}>{u("rejectVoid")}</button></form>}
                  {x.voidStatus === "REQUESTED" && me.role !== "MD" && <span className="text-navy/60">{u("awaitingMd")}</span>}
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-navy/70">{u("voidRules")}</p>
        </Card>
      )}
      {!canIssue && <Alert>{u("tiExistsNotice", { no: active!.no })}</Alert>}
      {canIssue && taxInvoices.length > 0 && <Alert>{u("tiReissueNotice")}</Alert>}
      {canIssue && <form id="f" action={save} className="space-y-4">
        <Card title={u("taxInvoiceTi")}>
          <Grid>
            <Field label={u("buyer")}><Value>{order.customer.nameLocal ?? order.customer.name} · {t("taxId")} {order.customer.taxId ?? "—"} · {t("branch")} {order.customer.branchCode ?? "—"}</Value></Field>
            <Field label={u("issueDate")}><input name="issuedAt" type="date" defaultValue={today} className={inputCls} /></Field>
            <Field label={t("currency")}><Value>{order.currency}</Value></Field>
          </Grid>
          <Table head={["#", u("descThRequired"), u("descEn"), t("qty"), t("price"), t("amount")]}>
            {order.lines.map((l, i) => <tr key={l.id}><td>{l.lineNo}</td><td><input name={`th${i}`} required defaultValue={l.descriptionLocal ?? ""} className={inputCls} /></td><td>{l.description}</td><td>{Number(l.qty)}</td><td className="text-right">{Number(l.unitPrice).toFixed(2)}</td><td className="text-right">{Number(l.amount).toFixed(2)}</td></tr>)}
          </Table>
          <p className="text-right text-[13px]">{t("subtotal")} {Number(order.subtotal ?? 0).toFixed(2)} · {t("vat")} {Number(order.vatAmount ?? 0).toFixed(2)} · <b>{t("total")} {Number(order.total ?? 0).toFixed(2)}</b>{fx ? ` · CNY ${(Number(order.total ?? 0) * Number(fx.rateToCny)).toFixed(2)} @${Number(fx.rateToCny).toFixed(4)} (${u("bocOn")} ${fx.rateDate.toISOString().slice(5, 10)})` : ""}</p>
        </Card>
        <Card title={u("invoiceIv")}>
          <Grid>
            <Field label={u("dueDate")}><Value>{due} ({t("termDays")} {order.customer.paymentTermDays})</Value></Field>
            <Field label={u("receivable")}><Value>{order.currency} {Number(order.total ?? 0).toFixed(2)}</Value></Field>
            <Field label={u("monthlyCustomer")}><Value>{order.customer.monthlyStatement ? u("yesIntoBl") : u("no")}</Value></Field>
          </Grid>
        </Card>
      </form>}
    </StepPage>
  );
}
