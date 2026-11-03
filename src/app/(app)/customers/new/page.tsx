import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { createCustomer } from "@/server/crm";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { DbdLookup } from "@/components/DbdLookup";
import { RevealRows } from "@/components/RevealRows";
import { Alert, Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const PLANTS = 6;
const CONTACTS = 8;

/** 新增客户 — wireframe 3. Only DBD / ภ.พ.20 / billing documents are accepted; the rest comes from DBD by tax ID. */
export default async function NewCustomer({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const entities = await prisma.legalEntity.findMany({ orderBy: { countryCode: "asc" } });

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const s = (k: string) => String(f.get(k) ?? "").trim() || undefined;
      const plants = Array.from({ length: PLANTS }, (_, i) => ({ code: s(`p${i}_code`) ?? "", name: s(`p${i}_name`) ?? "", address: s(`p${i}_address`), accessNotes: s(`p${i}_access`) })).filter((p) => p.code && p.name);
      const contacts = Array.from({ length: CONTACTS }, (_, i) => ({ name: s(`c${i}_name`) ?? "", title: s(`c${i}_title`), plantCode: s(`c${i}_plant`), phone: s(`c${i}_phone`), lineId: s(`c${i}_line`), email: s(`c${i}_email`), portalLogin: s(`c${i}_login`), portalPassword: s(`c${i}_pw`) })).filter((k) => k.name);
      const fetched = s("dbdFetchedAt");
      const c = await createCustomer({
        actorCode: me.code, entityCode: String(f.get("entityCode")), taxId: (s("taxId") ?? "").replace(/\D/g, ""), branchCode: s("branchCode") ?? "00000",
        nameLocal: s("nameLocal") ?? "", name: s("name") ?? "", shortName: s("shortName"), phone: s("phone"), addressLocal: s("addressLocal"), addressEn: s("addressEn"), billingAddress: s("billingAddress"),
        registeredCapital: s("registeredCapital") ? Number(s("registeredCapital")!.replace(/[^\d.]/g, "")) : undefined, foundedAt: s("foundedAt") ? new Date(s("foundedAt")!) : undefined,
        defaultCurrency: s("defaultCurrency") ?? "THB", paymentTermDays: Number(s("paymentTermDays") ?? 30), monthlyStatement: f.get("monthlyStatement") === "on", source: s("source"),
        dbd: fetched ? { status: s("dbdStatus"), fetchedAt: new Date(fetched), data: JSON.parse(s("dbdData") ?? "null"), values: JSON.parse(s("dbdValues") ?? "{}") } : undefined,
        files: JSON.parse(s("attachments") ?? "[]"), plants, contacts,
      });
      return { ok: c.code, to: `/customers/${c.code}` };
    }, "/customers/new");
  }
  const [code, a1, a2] = (error ?? "").split(":");
  const known = ["CUSTOMER_EXISTS", "DBD_CLOSED"].includes(code);
  const dbdTag = <span className="ml-1.5 rounded-full border border-navy/35 bg-blue/8 px-1.5 text-[11px] font-semibold">DBD</span>;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/customers", label: u("backToCustomers") }} title={u("newCustomer")}
        actions={<><Link href="/customers" className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      {error && !known && <Flash error={error} />}
      {code === "CUSTOMER_EXISTS" && <Alert>{u("customerExists", { code: a1, name: a2 })} <Link className="underline" href={`/customers/${a1}`}>{a1}</Link></Alert>}
      {code === "DBD_CLOSED" && <Alert>{u("dbdClosed", { status: a1 })}</Alert>}
      <UploadRecognize kind="customer" formId="f" title={u("upCustomerTitle")} hint={u("upCustomerHint")} />
      <form id="f" action={save} className="space-y-4">
        <Card title={u("company")}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label={t("taxId")} required className="w-64"><input name="taxId" required inputMode="numeric" maxLength={17} className={`${inputCls} font-mono`} /></Field>
            <Field label={t("branch")} className="w-32"><input name="branchCode" defaultValue="00000" maxLength={5} className={`${inputCls} font-mono`} /></Field>
            <DbdLookup formId="f" />
          </div>
          <Grid>
            <Field label={<>{u("nameTh")}{dbdTag}</>} required><input name="nameLocal" required className={inputCls} /></Field>
            <Field label={<>{u("nameEnLabel")}{dbdTag}</>} required><input name="name" required className={inputCls} /></Field>
            <Field label={u("shortName")}><input name="shortName" className={inputCls} /></Field>
            <Field label={<>{u("capitalFounded")}{dbdTag}</>}><div className="flex gap-2"><input name="registeredCapital" placeholder="THB" className={inputCls} /><input name="foundedAt" type="date" className={inputCls} /></div></Field>
            <Field label={<>{t("phone")}{dbdTag}</>}><input name="phone" className={inputCls} /></Field>
            <Field label={u("defaultCurrency")}><select name="defaultCurrency" className={inputCls}><option>THB</option><option>USD</option><option>CNY</option><option>VND</option></select></Field>
            <Field label={<>{u("addressTh")}{dbdTag}</>}><textarea name="addressLocal" rows={2} className={inputCls} /></Field>
            <Field label={<>{u("addressEnLabel")}{dbdTag}</>}><textarea name="addressEn" rows={2} className={inputCls} /></Field>
            <Field label={u("billingAddress")}><textarea name="billingAddress" rows={2} className={inputCls} /></Field>
          </Grid>
          <Grid>
            <Field label={t("termDays")}><input name="paymentTermDays" type="number" defaultValue={30} className={inputCls} /></Field>
            <Field label={u("legalEntity")} required><select name="entityCode" className={inputCls}>{entities.map((e) => <option key={e.id} value={e.code}>{e.code} · {e.countryCode} · {e.localCurrency}</option>)}</select></Field>
            <Field label={u("customerSource")}><select name="source" className={inputCls}><option value="EXISTING">{u("srcExisting")}</option><option value="REFERRAL">{u("srcReferral")}</option><option value="OUTREACH">{u("srcOutreach")}</option><option value="TENDER">{u("srcTender")}</option></select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="monthlyStatement" /> {u("monthlyCustomer")}</label>
          </Grid>
        </Card>
        <Card title={u("plants")}>
          <RevealRows addLabel={u("addPlant")}>
            {Array.from({ length: PLANTS }, (_, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[100px_1fr_2fr_2fr]">
                <input name={`p${i}_code`} defaultValue={i === 0 ? "P1" : ""} placeholder={u("plantCode")} className={inputCls} />
                <input name={`p${i}_name`} placeholder={u("plantName")} className={inputCls} />
                <input name={`p${i}_address`} placeholder={t("address")} className={inputCls} />
                <input name={`p${i}_access`} placeholder={u("accessNotes")} className={inputCls} />
              </div>
            ))}
          </RevealRows>
        </Card>
        <Card title={u("contacts")}>
          <RevealRows addLabel={u("addContact")}>
            {Array.from({ length: CONTACTS }, (_, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-8">
                <input name={`c${i}_name`} placeholder={t("name")} className={inputCls} />
                <input name={`c${i}_title`} placeholder={u("jobTitle")} className={inputCls} />
                <input name={`c${i}_plant`} placeholder={u("plantCode")} className={inputCls} />
                <input name={`c${i}_phone`} placeholder={t("phone")} className={inputCls} />
                <input name={`c${i}_line`} placeholder="LINE" className={inputCls} />
                <input name={`c${i}_email`} placeholder={t("email")} className={inputCls} />
                <input name={`c${i}_login`} placeholder={u("portalLogin")} className={inputCls} />
                <input name={`c${i}_pw`} type="password" placeholder={u("portalPassword")} className={inputCls} />
              </div>
            ))}
          </RevealRows>
        </Card>
      </form>
    </div>
  );
}
