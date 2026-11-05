import { getTranslations } from "next-intl/server";
import { recordPayment } from "@/server/to";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { businessClosureOn } from "@/lib/closure";
import { Card, Field, Grid, Table, inputCls } from "@/components/ui";
import { StepPage, atts, dayNow, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 回款登记 — wireframe 9 (bottom half). WHT reduces what is received, never the invoice. Partial payments allowed. */
export default async function Payment({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const today = new Date().toISOString().slice(0, 10);
  const unpaid = order.invoices.filter((i) => !i.paidAt);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await recordPayment({ invoiceNo: String(f.get("invoiceNo")), actorCode: me.code, paidAt: dayNow(String(f.get("paidAt")))!, paidAmount: num(f, "paidAmount") ?? 0, whtAmount: num(f, "whtAmount") ?? 0, whtCertRef: str(f, "whtCertRef"), bankRef: str(f, "bankRef"), attachments: atts(f) });
      return { ok: String(f.get("invoiceNo")), to: `/service-orders/${no}` };
    }, `/service-orders/${no}/payment`);
  }
  return (
    <StepPage order={order} title={u("step_payment")} error={error} kind="payment" uploadTitle={u("upPaymentTitle")} uploadHint={u("upPaymentHint")} saveLabel={businessClosureOn() ? t("save") : ""} notice={businessClosureOn() ? undefined : u("closureOffNotice")}>
      <Card title={u("invoiceIv")}>
        <Table head={["IVTH", u("dueDate"), u("receivable"), t("paid"), t("wht")]}>
          {order.invoices.map((i) => <tr key={i.id}><td className="font-mono">{i.no}</td><td>{i.dueAt?.toISOString().slice(0, 10) ?? ""}</td><td>{i.currency} {Number(i.amountDue).toFixed(2)}</td><td>{Number(i.paidAmount ?? 0).toFixed(2)}</td><td>{Number(i.whtAmount ?? 0).toFixed(2)}</td></tr>)}
        </Table>
      </Card>
      <form id="f" action={save}>
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
      </form>
    </StepPage>
  );
}
