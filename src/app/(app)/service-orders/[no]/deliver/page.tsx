import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { deliveryPlan, issueDelivery } from "@/server/delivery";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { maskName } from "@/lib/mask";
import { shortDate } from "@/lib/dates";
import { reportsFor } from "@/lib/order-steps";
import { QtyCheck } from "@/components/QtyCheck";
import { Alert, Card, Field, Grid, Table, Tag, btnGhost, inputCls } from "@/components/ui";
import { StepPage, dayNow, loadOrder, str, type Order } from "../_shell";

export const dynamic = "force-dynamic";

/** 送货单 DNTH — wireframe 8a: linked documents, then what goes where, then every line checked against the PO
 *  plus what must go back (ERTH accessories, RPTH old parts). A draft keeps its DNTH number until it is issued. */
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
  const draft = order.deliveries.find((d) => d.status === "DRAFT");
  const saved = new Map(((draft?.lines as { key: string; delivered: number }[] | undefined) ?? []).map((l) => [l.key, l.delivered]));
  const day = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const asDraft = f.get("draft") === "1"; // only the "save draft" button posts draft=1
      const { lines } = await deliveryPlan(no);
      const delivered = Object.fromEntries(lines.map((l) => [l.key, Number(f.get(`q_${l.key}`) || 0)]));
      const dn = await issueDelivery({ serviceOrderNo: no, actorCode: me.code, deliverOn: dayNow(String(f.get("deliverOn")))!, plantId: str(f, "plantId"), address: str(f, "address"), contactId: str(f, "contactId"), driverCode: str(f, "driverCode"), vehicle: str(f, "vehicle"), delivered, partial: f.get("partial") === "on", overrideReason: str(f, "overrideReason"), remark: str(f, "remark"), draft: asDraft });
      return asDraft ? { ok: dn.no, to: `/service-orders/${no}/deliver` } : { ok: dn.no, to: `/service-orders/${no}/deliver/${dn.no}` };
    }, `/service-orders/${no}/deliver`);
  }
  const po = lines.filter((l) => l.kind === "PO");
  const back = lines.filter((l) => l.kind === "RETURN");
  const issued = order.deliveries.filter((d) => d.status !== "DRAFT");
  const check = { ok: u("qtyMatches"), short: u("qtyShort", { n: "{n}" }), over: u("qtyOver", { n: "{n}" }) };
  const row = (l: (typeof lines)[number]) => {
    const due = l.expected - l.deliveredBefore;
    return (
      <tr key={l.key}>
        <td>{l.poLineNo ?? l.source}</td>
        <td>{l.description}</td>
        <td>{l.assetCode ? <span className="font-mono">{l.assetCode}</span> : l.partSku ?? ""}</td>
        <td>{l.isService ? "—" : l.expected}</td>
        <td>{l.isService ? "—" : l.deliveredBefore}</td>
        <td>{l.isService ? <Tag>{u("serviceNoDelivery")}</Tag> : <QtyCheck name={`q_${l.key}`} due={due} defaultValue={saved.get(l.key) ?? Math.max(due, 0)} labels={check} className={`${inputCls} w-20! shrink-0`} />}</td>
      </tr>
    );
  };
  return (
    <StepPage order={order} title={u("step_deliver")} badge={draft ? <Tag><span className="font-mono">{draft.no}</span> · {u("dn_DRAFT")}</Tag> : undefined}
      error={error?.startsWith("DELIVERY_MISMATCH") ? undefined : error} ok={ok} kind="delivery" uploadTitle={u("upDeliverTitle")} uploadHint={u("upDeliverHint")} saveLabel={u("checkAndPrint")}
      extraActions={<button form="f" name="draft" value="1" formNoValidate className={btnGhost}>{u("saveDraft")}</button>}>
      {issued.length > 0 && <Card title={u("deliveriesSoFar")}><div className="flex flex-wrap gap-2">{issued.map((d) => <Link key={d.id} href={`/service-orders/${no}/deliver/${d.no}`} className="rounded-full border border-navy/35 bg-white px-3 py-1 text-sm"><span className="font-mono">{d.no}</span> · {u(`dn_${d.status}`)}</Link>)}</div></Card>}
      <LinkedDocs order={order} />
      <form id="f" action={save} className="space-y-4">
        <Card title={u("deliverWhere")}>
          <Grid>
            <Field label={t("customer")}><div className="min-h-10 rounded-md border bg-white px-2.5 py-2 text-sm">{order.customer.name}</div></Field>
            <Field label={u("deliverToPlant")} required><select name="plantId" defaultValue={draft?.plantId ?? order.plantId ?? ""} className={inputCls}>{plants.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
            <Field label={u("deliverOn")} required><input name="deliverOn" type="date" required defaultValue={day(draft?.deliverOn ?? new Date())} className={inputCls} /></Field>
            <Field label={u("receiverContact")} required><select name="contactId" required defaultValue={draft?.contactId ?? ""} className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)}{c.title ? ` · ${c.title}` : ""}</option>)}</select></Field>
            <Field label={u("driver")} required><select name="driverCode" defaultValue={staff.find((e) => e.id === draft?.driverId)?.code ?? me.code} className={inputCls}>{staff.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            <Field label={u("vehicle")}><input name="vehicle" defaultValue={draft?.vehicle ?? ""} className={inputCls} /></Field>
          </Grid>
          <Field label={u("addressOverride")}><input name="address" defaultValue={draft?.address ?? ""} className={inputCls} /></Field>
        </Card>
        <Card title={u("deliveryVsPo")}>
          {poFromQuote && <p className="text-xs text-navy/70">{u("poFromQuoteNote")}</p>}
          <Table head={[u("poLine"), u("descPo"), u("assetOrPart"), u("poQty"), u("deliveredBefore"), u("deliverNowCheck")]}>{po.map(row)}</Table>
          {back.length > 0 && <>
            <div className="pt-2 text-[13px] font-semibold text-navy">{u("mustReturn")}</div>
            <Table head={[u("source"), u("item"), t("asset"), u("toReturn"), u("deliveredBefore"), u("deliverNowCheck")]}>{back.map(row)}</Table>
          </>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="partial" /> {u("partialDelivery")}</label>
          {error?.startsWith("DELIVERY_MISMATCH") && <Alert>{u("mismatchBlocked", { detail: error.split(":").slice(1).join(":") })}</Alert>}
          <Grid cols={2}>
            <Field label={u("overrideReason")}><input name="overrideReason" placeholder={u("overrideReasonPh")} className={inputCls} /></Field>
            <Field label={u("remark")}><input name="remark" defaultValue={draft?.remark ?? ""} className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </StepPage>
  );
}

/** Every document this delivery is checked against: the customer's PO, the quote it answers, and what came in and was done. */
async function LinkedDocs({ order }: { order: Order }) {
  const u = await getTranslations("ui");
  const hasAcc = !!order.acceptance;
  const hasQuote = order.lines.length > 0;
  const pdf = (no: string, r: { template?: string; key: string }) => (
    <a key={r.key} className="text-blue hover:underline" href={`/api/documents/${no}/render?format=pdf${r.template ? `&template=${r.template}` : ""}`}>{u(r.key)}</a>
  );
  const poFiles = ((order.attachments as { name: string; url: string; kind: string }[] | null) ?? []).filter((a) => a.kind === "PO");
  const confirmed = order.events.find((e) => e.type === "ORDER_CONFIRMED")?.occurredAt;
  type Row = { key: string; label: string; nos: React.ReactNode; date: string; purpose: string };
  const rows: Row[] = [];
  rows.push({
    key: "po", label: u("customerPo"), date: shortDate(confirmed), purpose: u("linkPurposePo"),
    nos: <span className="flex flex-wrap items-center gap-2">{order.customerRef ? <span className="font-mono">{order.customerRef}</span> : <span className="text-alert-ink">{u("poMissing")}</span>}{poFiles.map((a) => <a key={a.url} href={a.url} target="_blank" className="rounded-full border border-navy/35 px-2 py-0.5 text-xs text-blue hover:underline">{u("poOriginal")}</a>)}</span>,
  });
  const groups: [string, string, string][] = [["QT", "linkQuote", "linkPurposeQuote"], ["IN", "linkInspection", "linkPurposeInspection"], ["ER", "linkReceiving", "linkPurposeReceiving"], ["RP", "linkRepair", "linkPurposeRepair"], ["PM", "linkMaintenance", "linkPurposeMaintenance"]];
  for (const [type, label, purpose] of groups) {
    const docs = order.documents.filter((d) => d.type === type && !d.voidedAt);
    if (!docs.length) continue;
    rows.push({
      key: type, label: u(label), date: shortDate(docs[0].issuedAt), purpose: u(purpose),
      nos: <span className="flex flex-col gap-0.5">{docs.map((d) => <span key={d.no}><span className="font-mono">{d.no}</span>{reportsFor(d, hasAcc, hasQuote).length > 0 && <> · <span className="space-x-2">{reportsFor(d, hasAcc, hasQuote).filter((r) => type !== "QT" || r.template === "04" || r.template === "06").map((r) => pdf(d.no, r))}</span></>}</span>)}</span>,
    });
  }
  const outs = [...new Map(order.stockMovements.filter((m) => m.direction === "OUT").map((m) => [m.no, m])).values()];
  if (outs.length) rows.push({ key: "OB", label: u("linkStockOut"), date: shortDate(outs[0].movedAt), purpose: u("linkPurposeStockOut"), nos: <span className="font-mono">{outs.map((m) => m.no).join(" · ")}</span> });
  return (
    <Card title={u("linkedDocs")}>
      <Table head={[u("docKind"), u("docNo"), u("date"), u("checkedFor")]}>
        {rows.map((r) => <tr key={r.key}><td className="whitespace-nowrap">{r.label}</td><td>{r.nos}</td><td className="whitespace-nowrap">{r.date}</td><td className="text-navy/80">{r.purpose}</td></tr>)}
      </Table>
    </Card>
  );
}
