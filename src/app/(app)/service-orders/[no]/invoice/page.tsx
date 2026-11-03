import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { issueInvoice, issueTaxInvoice } from "@/server/to";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, Table, Value, inputCls } from "@/components/ui";
import { StepPage, dayNow, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 开票 — wireframe 9 (top half): TITH tax invoice in THB with Thai item names and VAT shown separately, then IVTH. */
export default async function Invoice({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const fx = await prisma.fxRate.findFirst({ where: { currency: order.currency }, orderBy: { rateDate: "desc" } });
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
  return (
    <StepPage order={order} title={u("step_invoice")} error={error} saveLabel={u("issueTiIv")}>
      <form id="f" action={save} className="space-y-4">
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
      </form>
    </StepPage>
  );
}
