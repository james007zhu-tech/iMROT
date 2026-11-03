import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { deliveryPlan, issueDelivery } from "@/server/delivery";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { maskName } from "@/lib/mask";
import { Alert, Card, Field, Grid, Table, Tag, inputCls } from "@/components/ui";
import { StepPage, dayNow, loadOrder, str } from "../_shell";

export const dynamic = "force-dynamic";

/** 送货单 DNTH — wireframe 8a: checked line by line against the PO, plus what must go back (ERTH accessories, RPTH old parts). */
export default async function Deliver({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const me = await currentEmployee();
  const [{ lines, poFromQuote }, staff, contacts] = await Promise.all([
    deliveryPlan(no),
    prisma.employee.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.contact.findMany({ where: { customerId: order.customerId }, orderBy: { name: "asc" } }),
  ]);
  const plants = await prisma.plant.findMany({ where: { customerId: order.customerId } });
  const today = new Date().toISOString().slice(0, 10);

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const { lines } = await deliveryPlan(no);
      const delivered = Object.fromEntries(lines.map((l) => [l.key, Number(f.get(`q_${l.key}`) || 0)]));
      const dn = await issueDelivery({ serviceOrderNo: no, actorCode: me.code, deliverOn: dayNow(String(f.get("deliverOn")))!, plantId: str(f, "plantId"), address: str(f, "address"), contactId: str(f, "contactId"), driverCode: str(f, "driverCode"), vehicle: str(f, "vehicle"), delivered, partial: f.get("partial") === "on", overrideReason: str(f, "overrideReason"), remark: str(f, "remark") });
      return { ok: dn.no, to: `/service-orders/${no}/deliver/${dn.no}` };
    }, `/service-orders/${no}/deliver`);
  }
  const po = lines.filter((l) => l.kind === "PO");
  const back = lines.filter((l) => l.kind === "RETURN");
  const open = order.deliveries;
  const row = (l: (typeof lines)[number]) => {
    const due = l.expected - l.deliveredBefore;
    return (
      <tr key={l.key}>
        <td>{l.poLineNo ?? l.source}</td>
        <td>{l.description}</td>
        <td>{l.assetCode ? <span className="font-mono">{l.assetCode}</span> : l.partSku ?? ""}</td>
        <td>{l.isService ? "—" : l.expected}</td>
        <td>{l.isService ? "—" : l.deliveredBefore}</td>
        <td>{l.isService ? <Tag>{u("serviceNoDelivery")}</Tag> : <input name={`q_${l.key}`} type="number" min={0} step="1" defaultValue={due > 0 ? due : 0} className={`${inputCls} w-20`} />}</td>
      </tr>
    );
  };
  return (
    <StepPage order={order} title={u("step_deliver")} error={error?.startsWith("DELIVERY_MISMATCH") ? undefined : error} ok={ok} kind="delivery" uploadTitle={u("upDeliverTitle")} uploadHint={u("upDeliverHint")} saveLabel={u("checkAndPrint")}>
      {open.length > 0 && <Card title={u("deliveriesSoFar")}><div className="flex flex-wrap gap-2">{open.map((d) => <Link key={d.id} href={`/service-orders/${no}/deliver/${d.no}`} className="rounded-full border border-navy/35 bg-white px-3 py-1 text-sm"><span className="font-mono">{d.no}</span> · {u(`dn_${d.status}`)}</Link>)}</div></Card>}
      <form id="f" action={save} className="space-y-4">
        <Card title={u("deliverWhere")}>
          <Grid>
            <Field label={t("customer")}><div className="min-h-10 rounded-md border bg-white px-2.5 py-2 text-sm">{order.customer.name}</div></Field>
            <Field label={u("deliverToPlant")} required><select name="plantId" defaultValue={order.plantId ?? ""} className={inputCls}>{plants.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={u("deliverOn")} required><input name="deliverOn" type="date" required defaultValue={today} className={inputCls} /></Field>
            <Field label={u("receiverContact")} required><select name="contactId" required className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)}{c.title ? ` · ${c.title}` : ""}</option>)}</select></Field>
            <Field label={u("driver")} required><select name="driverCode" defaultValue={me.code} className={inputCls}>{staff.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("vehicle")}><input name="vehicle" className={inputCls} /></Field>
          </Grid>
          <Field label={u("addressOverride")}><input name="address" className={inputCls} /></Field>
        </Card>
        <Card title={u("deliveryVsPo")}>
          {poFromQuote && <p className="text-xs text-navy/70">{u("poFromQuoteNote")}</p>}
          <Table head={[u("poLine"), u("descPo"), u("assetOrPart"), u("poQty"), u("deliveredBefore"), u("deliverNow")]}>{po.map(row)}</Table>
          {back.length > 0 && <>
            <div className="pt-2 text-[13px] font-semibold text-navy">{u("mustReturn")}</div>
            <Table head={[u("source"), u("item"), t("asset"), u("toReturn"), u("deliveredBefore"), u("deliverNow")]}>{back.map(row)}</Table>
          </>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="partial" /> {u("partialDelivery")}</label>
          {error?.startsWith("DELIVERY_MISMATCH") && <Alert>{u("mismatchBlocked", { detail: error.split(":").slice(1).join(":") })}</Alert>}
          <Grid cols={2}>
            <Field label={u("overrideReason")}><input name="overrideReason" placeholder={u("overrideReasonPh")} className={inputCls} /></Field>
            <Field label={u("remark")}><input name="remark" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </StepPage>
  );
}
