import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { dictItems, dictLabel } from "@/server/dict";
import { PAID_BY } from "@/server/expense";
import { localToday } from "@/lib/overtime";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Card, Field, Grid, PageHeader, btnPrimary, inputCls } from "@/components/ui";
import { fileAction } from "../actions";

export const dynamic = "force-dynamic";

/** 新建报销: photograph the receipt or say what it was; the form fills itself; the person checks and files it. */
export default async function NewExpense({ searchParams }: { searchParams: Promise<{ error?: string; order?: string }> }) {
  const { error, order } = await searchParams;
  const [t, me, locale] = await Promise.all([getTranslations("ops"), currentEmployee(), getLocale()]);
  const all = ["MD", "FINANCE"].includes(me.role);
  const [cats, staff, orders] = await Promise.all([
    dictItems("expenseCategory"),
    all ? prisma.employee.findMany({ where: { active: true, entityId: me.entityId }, orderBy: { code: "asc" }, select: { code: true, name: true } }) : Promise.resolve([]),
    prisma.serviceOrder.findMany({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 60, select: { no: true, customer: { select: { name: true } } } }),
  ]);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance/expenses", label: t("expTitle") }} title={t("expNew")} />
      <Flash error={error} />
      <UploadRecognize kind="expense" formId="f" title={t("expUpTitle")} hint={t("expUpHint")} />
      <Card>
        <form id="f" action={fileAction} className="space-y-3">
          <Grid cols={3}>
            {all && <Field label={t("expFor")}><select name="employeeCode" defaultValue={me.code} className={inputCls}>{staff.map((s) => <option key={s.code} value={s.code}>{s.code} {s.name}</option>)}</select></Field>}
            <Field label={t("expDate")} required><input name="spentOn" type="date" required defaultValue={localToday().date} className={inputCls} /></Field>
            <Field label={t("expCategory")} required><select name="category" required defaultValue="" className={inputCls}><option value="" disabled>—</option>{cats.map((c) => <option key={c.code} value={c.code}>{dictLabel(c, locale)}</option>)}</select></Field>
            <Field label={t("expAmount")} required><input name="amount" type="number" step="0.01" min="0.01" required inputMode="decimal" className={inputCls} /></Field>
            <Field label={t("expVat")}><input name="vatAmount" type="number" step="0.01" min="0" inputMode="decimal" placeholder={t("expVatPh")} className={inputCls} /></Field>
            <Field label={t("expPaidBy")}><select name="paidBy" defaultValue="SELF" className={inputCls}>{PAID_BY.map((p) => <option key={p} value={p}>{t(`paidBy_${p}`)}</option>)}</select></Field>
          </Grid>
          <Field label={t("expDescription")} required><input name="description" required placeholder={t("expDescriptionPh")} className={inputCls} /></Field>
          <Grid cols={3}>
            <Field label={t("expVendor")}><input name="vendor" className={inputCls} /></Field>
            <Field label={t("expVendorTaxId")}><input name="vendorTaxId" inputMode="numeric" className={inputCls} /></Field>
            <Field label={t("expReceiptNo")}><input name="receiptNo" className={`${inputCls} font-mono`} /></Field>
          </Grid>
          <Field label={t("expOrder")}><select name="serviceOrderNo" defaultValue={order ?? ""} className={inputCls}><option value="">{t("expNoOrder")}</option>{orders.map((o) => <option key={o.no} value={o.no}>{o.no} · {o.customer.name}</option>)}</select></Field>
          <input type="hidden" name="currency" value="THB" />
          <div className="flex justify-end"><button className={btnPrimary}>{t("expFile")}</button></div>
        </form>
      </Card>
    </div>
  );
}
