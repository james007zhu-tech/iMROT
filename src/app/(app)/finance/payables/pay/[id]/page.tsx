import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { hasRole } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import { payAccounts } from "@/server/pay";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Alert, Card, Field, PageHeader, btnBlue, inputCls } from "@/components/ui";
import { confirmAction } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * 确认付款 — the last screen (MD 2026-11-17): it says in one sentence what leaves which account for whom; the bank slip
 * and the transfer reference are required; pressing the button is what records the payment. Finance only, and only for
 * a payment the MD has approved.
 */
export default async function ConfirmPayment({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ id }, { error }] = await Promise.all([params, searchParams]);
  const [u, t, me] = await Promise.all([getTranslations("ui"), getTranslations("common"), currentEmployee()]);
  const p = await prisma.supplierPayment.findUnique({ where: { id }, include: { supplierInvoice: { include: { supplier: true, purchaseOrder: { select: { no: true } } } } } });
  if (!p) notFound();
  const inv = p.supplierInvoice;
  const account = (await payAccounts(p.entityId)).find((a) => a.id === p.account)?.label ?? p.account;
  const ready = p.status === "APPROVED" && hasRole(me, "FINANCE");
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader back={{ href: "/finance/payables", label: u("payables") }} title={<span>{u("payConfirmTitle")} <span className="font-mono">{p.no}</span></span>} />
      <Flash error={error} />
      <Card title={u("payConfirmWhat")} accent>
        <p className="text-lg font-semibold text-navy">{u("payConfirmSentence", { account, amount: `${inv.currency} ${Number(p.amount).toFixed(2)}`, supplier: inv.supplier.name })}</p>
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-navy">
          <dt className="text-navy/60">{u("supplierInvoiceNo")}</dt><dd className="font-mono">{inv.invoiceNo}</dd>
          <dt className="text-navy/60">POTH</dt><dd className="font-mono">{inv.purchaseOrder.no}</dd>
          <dt className="text-navy/60">{u("payableAmount")}</dt><dd>{inv.currency} {Number(inv.payable).toFixed(2)} · {u("payPaidOpen", { paid: Number(inv.paidAmount).toFixed(2), open: (Number(inv.payable) - Number(inv.paidAmount)).toFixed(2) })}</dd>
          {Number(p.whtAmount) > 0 && <><dt className="text-navy/60">{u("payGross")}</dt><dd>{inv.currency} {(Number(p.amount) + Number(p.whtAmount)).toFixed(2)}</dd><dt className="text-navy/60">{t("wht")} {p.whtRate != null ? `${(Number(p.whtRate) * 100).toFixed(2).replace(/\.?0+$/, "")}%` : ""}</dt><dd>{inv.currency} {Number(p.whtAmount).toFixed(2)} · 50 ทวิ {p.whtCertNo}</dd></>}
          <dt className="text-navy/60">{u("payApprovedByMd")}</dt><dd>{p.decidedBy} · {p.decidedAt ? localIso(p.decidedAt)!.slice(0, 16).replace("T", " ") : ""}</dd>
        </dl>
      </Card>
      {!ready ? <Alert>{u(p.status === "REQUESTED" ? "payWaitsMd" : p.status === "APPROVED" ? "payWaitsFinance" : `payState_${p.status}`)}</Alert> : (<>
        <UploadRecognize kind="payment" formId="pay" title={u("paySlipTitle")} hint={u("paySlipHint")} dictate={false} />
        <form id="pay" action={confirmAction} className="space-y-3 rounded-xl border bg-white p-4">
          <input type="hidden" name="id" value={p.id} />
          <Field label={`${u("paymentRefPh")} *`}><input name="paymentRef" required className={inputCls} /></Field>
          <Field label={u("payDateLabel")}><input name="paidAt" type="date" defaultValue={localIso(p.payDate)!.slice(0, 10)} className={inputCls} /></Field>
          <button className={`${btnBlue} w-full`}>{u("payConfirmBtn", { amount: `${inv.currency} ${Number(p.amount).toFixed(2)}` })}</button>
        </form></>)}
    </div>
  );
}
