import { getTranslations } from "next-intl/server";
import { receiveEquipment } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Card, Field, Grid, inputCls } from "@/components/ui";
import { StepPage, atts, str, type StepSubject } from "../service-orders/[no]/_shell";

/**
 * 设备接收 ERTH (report: equipment receiving). One ERTH takes in one or several machines of a customer — a block per
 * machine, the customer signs once. Opened from a QTTH or from the ATH itself (设备优先, 朱总 2026-11-11); either way
 * the receiver confirms each serial number against the machine, which is what makes the ATH ↔ S/N pairing trustworthy.
 * Accessories are listed one per line so the delivery note can check them back.
 */
export async function ReceiveScreen({ subject, self, home, error }: { subject: StepSubject; self: string; home: string; error?: string }) {
  const order = subject, no = subject.no;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const codes = order.assets.map((l) => l.asset.code);
  const key = (k: string, i: number) => (i === 0 ? k : `${k}__${codes[i]}`);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const key = (k: string, i: number) => (i === 0 ? k : `${k}__${codes[i]}`); // a server action may capture values, never a function
      const picked = f.getAll("assetCode").map(String);
      const items = codes.map((assetCode, i) => ({ assetCode, accessories: str(f, key("accessories", i)), condition: str(f, key("condition", i)), fault: str(f, key("fault", i)), serialChecked: f.get(key("serialChecked", i)) === "on" })).filter((x) => picked.includes(x.assetCode));
      const unchecked = items.find((x) => !x.serialChecked);
      if (unchecked) throw new Error(`SERIAL_NOT_CHECKED:${unchecked.assetCode}`);
      const ev = await receiveEquipment({ serviceOrderNo: no, items, actorCode: me.code, receivedAt: str(f, "receivedAt") ? new Date(str(f, "receivedAt")!) : undefined, sender: str(f, "sender"), photoRefs: str(f, "photoRefs"), handlingRestrictions: str(f, "handlingRestrictions"), attachments: atts(f) });
      return { ok: ev.sourceDocNo ?? "ERTH", to: home };
    }, self);
  }
  return (
    <StepPage order={order} title={u("step_receive")} error={error} kind="receive" brief uploadTitle={u("upReceiveTitle")} uploadHint={u("upReceiveHint")} saveLabel={u("saveAndReport")}>
      <form id="f" action={save} className="space-y-4">
        <Card title={u("receiving")}>
          <Grid>
            <Field label={u("sender")}><input name="sender" className={inputCls} /></Field>
            <Field label={u("receivedAt")}><input name="receivedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
            <Field label={u("photoRefs")}><input name="photoRefs" className={inputCls} /></Field>
            <Field label={u("handling")}><input name="handlingRestrictions" className={inputCls} /></Field>
          </Grid>
        </Card>
        {order.assets.map((l, i) => (
          <Card key={l.assetId} title={<span className="flex flex-wrap items-baseline gap-2"><span className="font-mono">{l.asset.code}</span><span className="text-sm font-normal text-navy/70">{l.asset.model ? `${l.asset.model.series.brand.name} ${l.asset.model.code}` : l.asset.type}</span></span>}>
            <label className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${l.asset.serialVerifiedAt ? "border-navy/20 bg-white" : "border-[#E6A23C] bg-[#FFF4E5]"}`}>
              <input type="checkbox" name={key("serialChecked", i)} required={order.assets.length === 1} className="mt-0.5 h-5 w-5 shrink-0" />
              <span>{u("serialCheck")} <b className="font-mono text-base">{l.asset.serialNumber}</b>{l.asset.serialSource === "INTERNAL" ? <span className="ml-2 text-xs text-[#9A5B00]">{u("serialInternal")}</span> : null}<span className="block text-xs text-navy/70">{u("serialCheckHint")}</span></span>
            </label>
            {order.assets.length > 1 && <label className="mb-3 flex items-center gap-2 text-sm"><input type="checkbox" name="assetCode" value={l.asset.code} defaultChecked className="h-4 w-4" />{u("receiveThis")}</label>}
            {order.assets.length === 1 && <input type="hidden" name="assetCode" value={l.asset.code} />}
            <Grid cols={2}>
              <Field label={`${u("accessoriesList")}${order.assets.length > 1 ? ` · ${l.asset.code}` : ""}`} required><textarea name={key("accessories", i)} required rows={4} placeholder={u("accessoriesPh")} className={inputCls} /></Field>
              <Field label={`${u("conditionArrival")}${order.assets.length > 1 ? ` · ${l.asset.code}` : ""}`}><textarea name={key("condition", i)} rows={4} className={inputCls} /></Field>
              <Field label={`${u("customerFault")}${order.assets.length > 1 ? ` · ${l.asset.code}` : ""}`}><textarea name={key("fault", i)} rows={2} defaultValue={order.reportedSymptom ?? ""} className={`${inputCls} font-semibold text-fault`} /></Field>
            </Grid>
          </Card>
        ))}
        <span hidden>{t("asset")}</span>
      </form>
    </StepPage>
  );
}
