import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { createSupplier } from "@/server/purchasing";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/** New supplier (or edit: ?id=). The upload box reads the supplier's company certificate / billing details. */
export default async function NewSupplier({ searchParams }: { searchParams: Promise<{ error?: string; id?: string; back?: string }> }) {
  const { error, id, back } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const s = id ? await prisma.supplier.findUnique({ where: { id } }) : null;
  const backTo = back && back.startsWith("/") ? back : "/suppliers";
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
      const data = { name: v("nameEn") ?? "", nameLocal: v("nameLocal"), taxId: v("taxId"), branchCode: v("branchCode"), contactName: v("contactName"), phone: v("phone"), email: v("email"), address: v("addressEn"), currency: v("currency") ?? "THB", paymentTerms: v("paymentTerms"), leadTimeDays: v("leadTimeDays") ? Number(v("leadTimeDays")) : undefined };
      if (id) { await prisma.supplier.update({ where: { id }, data }); return { ok: data.name, to: backTo }; }
      const me = await currentEmployee();
      const r = await createSupplier({ ...data, actorCode: me.code });
      return { ok: r.code, to: backTo };
    }, `/suppliers/new${id ? `?id=${id}` : ""}`);
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: backTo, label: u("suppliers") }} title={s ? <><span className="font-mono">{s.code}</span> · {s.name}</> : u("newSupplier")} actions={<><Link href={backTo} className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      <Flash error={error} />
      <FormMemory formId="f" />
      <UploadRecognize kind="entity" formId="f" title={u("upSupplierTitle")} hint={u("upSupplierHint")} />
      <form id="f" action={save}>
        <Card title={u("supplier")}>
          <Grid>
            <Field label={t("name")} required><input name="nameEn" required defaultValue={s?.name ?? ""} className={inputCls} /></Field>
            <Field label={u("nameLocal")}><input name="nameLocal" defaultValue={s?.nameLocal ?? ""} className={inputCls} /></Field>
            <Field label={t("taxId")}><input name="taxId" defaultValue={s?.taxId ?? ""} className={`${inputCls} font-mono`} /></Field>
            <Field label={u("branchCode")}><input name="branchCode" defaultValue={s?.branchCode ?? "00000"} className={`${inputCls} font-mono`} /></Field>
            <Field label={u("contactName")}><input name="contactName" defaultValue={s?.contactName ?? ""} className={inputCls} /></Field>
            <Field label={t("phone")}><input name="phone" defaultValue={s?.phone ?? ""} className={inputCls} /></Field>
            <Field label={t("email")}><input name="email" defaultValue={s?.email ?? ""} className={inputCls} /></Field>
            <Field label={t("address")} className="md:col-span-2"><input name="addressEn" defaultValue={s?.address ?? ""} className={inputCls} /></Field>
            <Field label={t("currency")}><select name="currency" defaultValue={s?.currency ?? "THB"} className={inputCls}>{["THB", "USD", "CNY", "EUR", "JPY"].map((c) => <option key={c}>{c}</option>)}</select></Field>
            <Field label={u("paymentTerms")}><input name="paymentTerms" defaultValue={s?.paymentTerms ?? ""} placeholder="30 days" className={inputCls} /></Field>
            <Field label={u("leadTime")}><input name="leadTimeDays" type="number" defaultValue={s?.leadTimeDays ?? ""} className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </div>
  );
}
