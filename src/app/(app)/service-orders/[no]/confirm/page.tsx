import { getTranslations } from "next-intl/server";
import { confirmCustomerPo, poLinesFromQuote } from "@/server/slm";
import { currentEmployee } from "@/server/auth";
import { saveUpload } from "@/lib/uploads";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, Table, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 客户确认报价 (PO): PO number verbatim, PO scan kept, PO lines (what the delivery note will be checked against). */
export default async function Confirm({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const lines = await poLinesFromQuote(no);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const po = lines.map((l, i) => ({ ...l, description: str(f, `d${i}`) ?? l.description, qty: num(f, `q${i}`) ?? l.qty, isService: f.get(`s${i}`) === "on" })).filter((l) => l.qty > 0);
      const files = [...atts(f)];
      for (const x of f.getAll("poFiles")) if (x instanceof File && x.size > 0) files.push({ ...(await saveUpload(x, "po")), name: x.name, kind: "PO" });
      await confirmCustomerPo({ no, actorCode: me.code, customerRef: str(f, "customerRef"), poLines: po, attachments: files.map((a) => ({ ...a, kind: "PO" })), note: str(f, "note") });
      return { ok: no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/confirm`);
  }
  return (
    <StepPage order={order} title={u("step_confirm")} error={error} kind="service" uploadTitle={u("upPoTitle")} uploadHint={u("upPoHint")} lineFields={{ description: "d", qty: "q" }} saveLabel={u("confirmStart")}>
      <form id="f" action={save} encType="multipart/form-data" className="space-y-4">
        <Card title={u("customerPo")}>
          <Grid>
            <Field label={u("customerRefVerbatim")} required><input name="customerRef" required defaultValue={order.customerRef ?? ""} className={`${inputCls} font-mono`} /></Field>
            <Field label={u("poAttachments")}><input name="poFiles" type="file" multiple accept="image/*,application/pdf" className={inputCls} /></Field>
            <Field label={t("note")}><input name="note" className={inputCls} /></Field>
          </Grid>
        </Card>
        <Card title={u("poLines")}>
          <Table head={[u("poLine"), u("descPo"), t("qty"), u("uom"), u("serviceNoDelivery")]}>
            {lines.map((l, i) => <tr key={l.lineNo}><td>{l.lineNo}</td><td><input name={`d${i}`} defaultValue={l.description} className={inputCls} /></td><td><input name={`q${i}`} type="number" step="0.001" defaultValue={l.qty} className={inputCls} /></td><td>{l.unit}</td><td><input type="checkbox" name={`s${i}`} defaultChecked={l.isService} /></td></tr>)}
          </Table>
          <p className="text-xs text-navy/70">{u("poLinesNote")}</p>
        </Card>
      </form>
    </StepPage>
  );
}
