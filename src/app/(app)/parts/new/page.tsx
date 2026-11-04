import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { createPart } from "@/server/scm";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function NewPart({ searchParams }: { searchParams: Promise<{ error?: string; vendor?: string; back?: string }> }) {
  const { error, vendor, back } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const brands = await prisma.brand.findMany({ orderBy: { name: "asc" } });
  const backTo = back && back.startsWith("/") ? back : "/parts";
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const p = await createPart({ brandCode: String(f.get("brandCode") || "") || undefined, vendorPartNo: String(f.get("vendorPartNo") || ""), name: String(f.get("name") || ""), nameLocal: String(f.get("nameLocal") || "") || undefined, unit: String(f.get("unit") || "pcs"), safetyStock: f.get("safetyStock") ? Number(f.get("safetyStock")) : undefined });
      return { ok: p.sku, to: backTo };
    }, "/parts/new");
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: backTo, label: u("backToParts") }} title={u("newPart")} actions={<><Link href={backTo} className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      <Flash error={error} />
      <FormMemory formId="f" />
      <UploadRecognize kind="stock" formId="f" title={u("upPartTitle")} hint={u("upPartHint")} />
      <form id="f" action={save}>
        <Card title={u("part")}>
          <Grid>
            <Field label={t("brand")}><select name="brandCode" className={inputCls}><option value="">—</option>{brands.map((b) => <option key={b.id} value={b.code}>{b.name}</option>)}</select></Field>
            <Field label={u("vendorPartNo")} required><input name="vendorPartNo" required defaultValue={vendor ?? ""} className={`${inputCls} font-mono`} /></Field>
            <Field label={t("name")} required><input name="name" required className={inputCls} /></Field>
            <Field label={u("nameLocal")}><input name="nameLocal" className={inputCls} /></Field>
            <Field label={t("unit")}><input name="unit" defaultValue="pcs" className={inputCls} /></Field>
            <Field label={u("safetyStock")}><input name="safetyStock" type="number" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </div>
  );
}
