import { localIso } from "@/lib/dates";
import { getTranslations } from "next-intl/server";
import { decideReceiptVoid, recordPayment, requestReceiptVoid } from "@/server/to";
import { liveNumbers } from "@/lib/numbering";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { businessClosureOn } from "@/lib/closure";
import { prisma } from "@/lib/db";
import { Alert, Card, Field, Grid, Table, Tag, btnGhost, inputCls } from "@/components/ui";
import { StepPage, atts, dayNow, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 回款登记 — wireframe 9 (bottom half). WHT reduces what is received, never the invoice. Partial payments allowed. */
export default async function Payment({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const today = localIso(new Date())!.slice(0, 10);
  const outstanding = (i: (typeof order.invoices)[number]) => Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0);
  const unpaid = order.invoices.filter((i) => !i.cancelledAt && outstanding(i) > 0.004);
  const receipts = await prisma.receipt.findMany({ where: { invoiceId: { in: order.invoices.map((i) => i.id) } }, orderBy: { receivedAt: "asc" }, include: { invoice: { select: { no: true } } } });
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await recordPayment({ invoiceNo: String(f.get("invoiceNo")), actorCode: me.code, paidAt: dayNow(String(f.get("paidAt")))!, paidAmount: num(f, "paidAmount") ?? 0, whtAmount: num(f, "whtAmount") ?? 0, whtCertRef: str(f, "whtCertRef"), bankRef: str(f, "bankRef"), attachments: atts(f) });
      return { ok: String(f.get("invoiceNo")), to: `/service-orders/${no}` };
    }, `/service-orders/${no}/payment`);
  }
  const me = await currentEmployee();
  async function askVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await requestReceiptVoid({ receiptNo: String(f.get("rc")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return "voidRequested"; }, `/service-orders/${no}/payment`);
  }
  async function decideVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await decideReceiptVoid({ receiptNo: String(f.get("rc")), actorCode: me.code, decision: f.get("decision") as "APPROVED", note: str(f, "note") }); return f.get("decision") === "APPROVED" ? "voidApproved" : "voidRejected"; }, `/service-orders/${no}/payment`);
  }
  return (
    <StepPage order={order} title={u("step_payment")} ok={ok === "voidRequested" ? u("tiVoidRequested") : ok === "voidApproved" ? u("tiVoided") : ok === "voidRejected" ? u("tiVoidRejected") : ok} error={error} kind={businessClosureOn() ? "payment" : undefined} uploadTitle={u("upPaymentTitle")} uploadHint={u("upPaymentHint")} saveLabel={businessClosureOn() && unpaid.length ? t("save") : ""} notice={businessClosureOn() ? undefined : u("closureOffNotice")}>
      {businessClosureOn() && !liveNumbers() && <Alert>{u("testSeriesNotice")}</Alert>}
      <Card title={u("invoiceIv")}>
        <Table head={["IVTH", u("dueDate"), u("receivable"), t("paid"), t("wht"), u("outstanding"), "PDF"]}>
          {order.invoices.map((i) => <tr key={i.id}><td className="font-mono">{i.no}</td><td>{localIso(i.dueAt)?.slice(0, 10) ?? ""}</td><td>{i.currency} {Number(i.amountDue).toFixed(2)}</td><td>{Number(i.paidAmount ?? 0).toFixed(2)}</td><td>{Number(i.whtAmount ?? 0).toFixed(2)}</td><td className={outstanding(i) > 0.004 ? "font-semibold text-alert-ink" : ""}>{outstanding(i).toFixed(2)}</td><td className="space-x-2 text-xs"><a className="text-blue hover:underline" href={`/api/documents/${i.no}/render?format=pdf`}>IVTH</a>{i.taxInvoice && <a className="text-blue hover:underline" href={`/api/documents/${i.taxInvoice.no}/render?format=pdf`}>TITH</a>}</td></tr>)}
        </Table>
      </Card>
      {receipts.length > 0 && <Card title={u("receiptsRc")}>
        <Table head={["RCTH", "IVTH", u("paidOn"), t("cashReceived"), t("whtWithheld"), u("settled"), t("bankRef"), "PDF", t("status")]}>
          {receipts.map((r) => <tr key={r.id} className={r.voidedAt ? "text-navy/50 line-through" : ""}><td className="font-mono">{r.no}</td><td className="font-mono">{r.invoice.no}</td><td>{localIso(r.receivedAt)!.slice(0, 10)}</td><td>{r.currency} {Number(r.cashAmount).toFixed(2)}</td><td>{Number(r.whtAmount).toFixed(2)}</td><td>{Number(r.settledAmount).toFixed(2)}</td><td>{r.bankRef ?? ""}</td><td className="text-xs"><a className="text-blue hover:underline" href={`/api/documents/${r.no}/render?format=pdf`}>RCTH</a></td>
            <td className="space-y-1 text-xs no-underline">
              {r.voidedAt ? <Tag hot>{u("tiVoided")}</Tag> : r.voidStatus === "REQUESTED" ? <Tag hot>{u("tiVoidRequested")}</Tag> : null}
              {r.voidRequestReason ? <span className="block">{r.voidRequestReason}</span> : null}
              {!r.voidedAt && r.voidStatus !== "REQUESTED" && <details><summary className={`${btnGhost} inline-flex cursor-pointer items-center whitespace-nowrap`}>{u("voidBtn")}</summary>
                <form action={askVoid} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="rc" value={r.no} /><input name="reason" required placeholder={u("voidReason")} className={`${inputCls} w-44`} /><button className={`${btnGhost} whitespace-nowrap`}>{u("requestVoid")}</button></form></details>}
              {r.voidStatus === "REQUESTED" && !r.voidedAt && (me.role === "MD"
                ? <form action={decideVoid} className="flex flex-wrap gap-1"><input type="hidden" name="rc" value={r.no} /><input name="note" placeholder={t("note")} className={`${inputCls} w-36`} /><button name="decision" value="APPROVED" className="min-h-10 whitespace-nowrap rounded-lg border border-alert px-3 text-sm font-semibold text-alert-ink">{u("approveVoid")}</button><button name="decision" value="REJECTED" className={`${btnGhost} whitespace-nowrap`}>{u("rejectVoid")}</button></form>
                : <span className="text-navy/60">{u("awaitingMd")}</span>)}
            </td></tr>)}
        </Table>
      </Card>}
      {unpaid.length === 0 && <p className="rounded-lg border border-navy/20 bg-white px-3 py-2 text-sm">{u("nothingToCollect")}</p>}
      {unpaid.length > 0 && <form id="f" action={save}>
        <Card title={u("paymentRecord")}>
          <Grid>
            <Field label="IVTH" required><select name="invoiceNo" className={inputCls}>{unpaid.map((i) => <option key={i.id} value={i.no}>{i.no} · {Number(i.amountDue).toFixed(2)}</option>)}</select></Field>
            <Field label={u("paidOn")} required><input name="paidAt" type="date" required defaultValue={today} className={inputCls} /></Field>
            <Field label={t("cashReceived")} required><input name="paidAmount" type="number" step="0.01" required className={inputCls} /></Field>
            <Field label={t("whtWithheld")}><input name="whtAmount" type="number" step="0.01" className={inputCls} /></Field>
            <Field label={t("whtCert")}><input name="whtCertRef" className={inputCls} /></Field>
            <Field label={t("bankRef")}><input name="bankRef" className={inputCls} /></Field>
          </Grid>
          <p className="text-xs text-navy/70">{u("whtNote")}</p>
        </Card>
      </form>}
    </StepPage>
  );
}
