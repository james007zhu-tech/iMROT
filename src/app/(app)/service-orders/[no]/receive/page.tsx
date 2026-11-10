import { getTranslations } from "next-intl/server";
import { receiveEquipment } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, inputCls } from "@/components/ui";
import { StepPage, atts, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 设备接收 ERTH (report: equipment receiving). Accessories are listed one per line so the delivery note can check them back. */
export default async function Receive({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const ev = await receiveEquipment({ serviceOrderNo: no, assetCode: String(f.get("assetCode")), actorCode: me.code, receivedAt: str(f, "receivedAt") ? new Date(str(f, "receivedAt")!) : undefined, sender: str(f, "sender"), accessories: str(f, "accessories"), condition: str(f, "condition"), fault: str(f, "fault"), photoRefs: str(f, "photoRefs"), handlingRestrictions: str(f, "handlingRestrictions"), attachments: atts(f) });
      return { ok: ev.sourceDocNo ?? "ERTH", to: `/service-orders/${no}` };
    }, `/service-orders/${no}/receive`);
  }
  return (
    <StepPage order={order} title={u("step_receive")} error={error} kind="receive" brief uploadTitle={u("upReceiveTitle")} uploadHint={u("upReceiveHint")} saveLabel={u("saveAndReport")}>
      <form id="f" action={save}>
        <Card title={u("receiving")}>
          <Grid>
            <Field label={t("asset")} required><select name="assetCode" className={inputCls}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code} · S/N {l.asset.serialNumber}</option>)}</select></Field>
            <Field label={u("sender")}><input name="sender" className={inputCls} /></Field>
            <Field label={u("receivedAt")}><input name="receivedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
          </Grid>
          <Grid cols={2}>
            <Field label={u("accessoriesList")} required><textarea name="accessories" required rows={4} placeholder={u("accessoriesPh")} className={inputCls} /></Field>
            <Field label={u("conditionArrival")}><textarea name="condition" rows={4} className={inputCls} /></Field>
            <Field label={u("customerFault")}><textarea name="fault" rows={2} defaultValue={order.reportedSymptom ?? ""} className={`${inputCls} font-semibold text-fault`} /></Field>
            <Field label={u("photoRefs")}><input name="photoRefs" className={inputCls} /></Field>
            <Field label={u("handling")}><input name="handlingRestrictions" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </StepPage>
  );
}
