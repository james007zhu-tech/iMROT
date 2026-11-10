import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { addExportDocs, confirmShipment, issueShipment, shipmentFor } from "@/server/export";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { saveUpload } from "@/lib/uploads";
import { SHIP_MODES, incotermLine, shipTotals, transportDoc, type ShipMode } from "@/lib/export";
import { Card, Field, Grid, Table, Tag, btnPrimary, inputCls } from "@/components/ui";
import { UploadRecognize } from "@/components/UploadRecognize";
import { StepPage, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";

/**
 * 出运 (国际贸易, flow 2026-11-09; PFI 2026-11-10). Form 1: packing per line + ports and dates → packing list (DNTH, 34);
 * the PFTH from the PO then also prints as a commercial invoice (33) for customs. Form 2, once the goods are on board:
 * B/L or AWB, departure date, export entry → the order is accepted and locked.
 */
export default async function Ship({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string; ok?: string }> }) {
  const [{ no }, { error, ok }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  if (order.mode !== "INTERNATIONAL_TRADE") notFound();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const { dn, invoiceNo, shipping: s, terms } = await shipmentFor(no);
  const shipped = dn?.status === "SIGNED";
  const tot = shipTotals(s.lines);

  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const n = Number(f.get("rows") ?? 0);
      const lines = Array.from({ length: n }, (_, i) => ({ key: String(f.get(`k${i}`)), hsCode: str(f, `hs${i}`) ?? "", origin: str(f, `or${i}`) ?? "", packages: num(f, `pk${i}`) ?? 0, netKg: num(f, `nw${i}`) ?? 0, grossKg: num(f, `gw${i}`) ?? 0 }));
      const r = await issueShipment({ no, actorCode: me.code, shipMode: (str(f, "shipMode") ?? "SEA") as ShipMode, portLoading: str(f, "portLoading") ?? "", portDischarge: str(f, "portDischarge") ?? "",
        packageKind: str(f, "packageKind"), marks: str(f, "marks"), cbm: num(f, "cbm"), forwarder: str(f, "forwarder"), vessel: str(f, "vessel"), etd: str(f, "etd") ?? "", eta: str(f, "eta"), lines });
      return { ok: [r.invoiceNo, r.dnNo].filter(Boolean).join(" · "), to: `/service-orders/${no}/ship` };
    }, `/service-orders/${no}/ship`);
  }
  async function confirm(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const files = [];
      for (const x of f.getAll("shipFiles")) if (x instanceof File && x.size > 0) files.push({ ...(await saveUpload(x, "ship")), name: x.name, kind: "SHIPPING" });
      const r = await confirmShipment({ no, actorCode: me.code, blNo: str(f, "blNo") ?? "", shippedAt: str(f, "shippedAt") ?? "", vessel: str(f, "vessel2"), exportEntryNo: str(f, "exportEntryNo"), eta: str(f, "eta2"), attachments: files });
      if (files.length) await addExportDocs({ no, actorCode: me.code, kind: "EXPORT_BL", files }); // the B/L copy counts towards the order's export documents
      return { ok: `${r.dnNo} · ${r.blNo}`, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/ship`);
  }

  const doc = (docNo: string, tpl: string, key: string) => <a href={`/api/documents/${docNo}/render?format=pdf&template=${tpl}`} className="text-blue hover:underline">{u(key)} <span className="font-mono">{docNo}</span></a>;
  return (
    <StepPage order={order} title={u("step_ship")} error={error} ok={ok} kind={shipped ? undefined : "shipment"} uploadTitle={u("upShipmentTitle")} uploadHint={u("upShipmentHint")}
      saveLabel={shipped ? "" : dn ? u("shipSaveUpdate") : u("shipIssue")} badge={shipped ? <Tag>{u("shipShipped")}</Tag> : dn ? <Tag hot>{u("shipAwaitingBl")}</Tag> : undefined}>
      <Card title={u("tradeTerms")}>
        <Grid cols={4}>
          <Field label={u("incoterms")}><span className="font-semibold">{incotermLine(terms)}</span></Field>
          <Field label={u("destination")}><span>{[terms.destPort, terms.destCountry].filter(Boolean).join(", ")}</span></Field>
          <Field label={t("currency")}><span className="font-mono">{order.currency}</span></Field>
          <Field label={u("paymentTerms")}><span>{terms.paymentTerms}</span></Field>
        </Grid>
        {(invoiceNo || dn) && <div className="mt-2 flex flex-wrap gap-4 text-sm">{invoiceNo && doc(invoiceNo, "35", "rpt35")}{invoiceNo && dn && doc(invoiceNo, "33", "rpt33")}{dn && doc(dn.no, "34", "rpt34")}</div>}
        <p className="mt-2 text-xs text-navy/70">{u("exportVatNote")}</p>
      </Card>

      <form id="f" action={save} className="space-y-4">
        <input type="hidden" name="rows" value={s.lines.length} />
        <Card title={u("shipmentDetails")}>
          <Grid cols={4}>
            <Field label={u("shipMode")} required><select name="shipMode" defaultValue={s.shipMode} disabled={shipped} className={inputCls}>{SHIP_MODES.map((m) => <option key={m} value={m}>{u(`shipMode_${m}`)}</option>)}</select></Field>
            <Field label={u("portLoading")} required><input name="portLoading" defaultValue={s.portLoading} required disabled={shipped} placeholder="Laem Chabang" className={inputCls} /></Field>
            <Field label={u("portDischarge")} required><input name="portDischarge" defaultValue={s.portDischarge} required disabled={shipped} className={inputCls} /></Field>
            <Field label={u("forwarder")}><input name="forwarder" defaultValue={s.forwarder ?? ""} disabled={shipped} className={inputCls} /></Field>
            <Field label={u("etd")} required><input name="etd" type="date" defaultValue={s.etd} required disabled={shipped} className={inputCls} /></Field>
            <Field label={u("eta")}><input name="eta" type="date" defaultValue={s.eta ?? ""} disabled={shipped} className={inputCls} /></Field>
            <Field label={u("vesselFlight")}><input name="vessel" defaultValue={s.vessel ?? ""} disabled={shipped} className={inputCls} /></Field>
            <Field label={u("packageKind")}><input name="packageKind" defaultValue={s.packageKind} disabled={shipped} placeholder="carton / pallet / wooden case" className={inputCls} /></Field>
            <Field label={u("cbm")}><input name="cbm" type="number" step="0.001" min="0" defaultValue={s.cbm ?? ""} disabled={shipped} className={inputCls} /></Field>
          </Grid>
          <Field label={u("shippingMarks")}><textarea name="marks" rows={2} defaultValue={s.marks ?? ""} disabled={shipped} className={inputCls} /></Field>
        </Card>
        <Card title={u("packingLines")}>
          <Table head={["#", u("partSku"), t("description"), t("qty"), u("hsCode"), u("origin"), u("packages"), u("netKg"), u("grossKg"), t("amount")]}>
            {s.lines.map((l, i) => (
              <tr key={l.key}>
                <td>{l.lineNo}<input type="hidden" name={`k${i}`} value={l.key} /></td>
                <td className="font-mono">{l.sku ?? "—"}</td>
                <td>{l.description}</td>
                <td className="whitespace-nowrap text-right">{l.qty} {l.unit}</td>
                <td className="w-32"><input name={`hs${i}`} defaultValue={l.hsCode} required disabled={shipped} placeholder="8504.40" className={`${inputCls} font-mono`} /></td>
                <td className="w-20"><input name={`or${i}`} defaultValue={l.origin} required disabled={shipped} maxLength={40} placeholder="DE" className={`${inputCls} uppercase`} /></td>
                <td className="w-20"><input name={`pk${i}`} type="number" min="1" step="1" defaultValue={l.packages || ""} required disabled={shipped} className={inputCls} /></td>
                <td className="w-24"><input name={`nw${i}`} type="number" min="0" step="0.001" defaultValue={l.netKg || ""} required disabled={shipped} className={inputCls} /></td>
                <td className="w-24"><input name={`gw${i}`} type="number" min="0" step="0.001" defaultValue={l.grossKg || ""} required disabled={shipped} className={inputCls} /></td>
                <td className="whitespace-nowrap text-right">{l.amount.toFixed(2)}</td>
              </tr>
            ))}
            <tr className="bg-tint font-semibold"><td colSpan={6}>{t("total")}</td><td>{tot.packages}</td><td>{tot.netKg}</td><td>{tot.grossKg}</td><td className="text-right">{order.currency} {Number(order.total ?? 0).toFixed(2)}</td></tr>
          </Table>
          <p className="mt-2 text-xs text-navy/70">{u("packingHint")}</p>
        </Card>
      </form>

      {dn && !shipped && <>
        <UploadRecognize kind="shipment" formId="g" title={u("upBlTitle")} hint={u("upShipmentHint")} />
        <form id="g" action={confirm}>
          <Card title={u("shipConfirmTitle", { doc: transportDoc(s.shipMode) })} accent>
            <Grid cols={4}>
              <Field label={u("blNo", { doc: transportDoc(s.shipMode) })} required><input name="blNo" required className={`${inputCls} font-mono`} /></Field>
              <Field label={u("shippedAt")} required><input name="shippedAt" type="date" required defaultValue={s.etd} className={inputCls} /></Field>
              <Field label={u("vesselFlight")}><input name="vessel2" defaultValue={s.vessel ?? ""} className={inputCls} /></Field>
              <Field label={u("exportEntryNo")}><input name="exportEntryNo" className={`${inputCls} font-mono`} /></Field>
              <Field label={u("eta")}><input name="eta2" type="date" defaultValue={s.eta ?? ""} className={inputCls} /></Field>
            </Grid>
            <Field label={u("shippingFiles")}><input name="shipFiles" type="file" multiple accept="image/*,application/pdf" className={inputCls} /></Field>
            <p className="mb-2 text-xs text-navy/70">{u("shipConfirmHint")}</p>
            <button className={btnPrimary}>{u("shipConfirm")}</button>
          </Card>
        </form>
      </>}
      {shipped && <Card title={u("shipShipped")}>
        <Grid cols={4}>
          <Field label={u("blNo", { doc: transportDoc(s.shipMode) })}><span className="font-mono">{s.blNo}</span></Field>
          <Field label={u("shippedAt")}><span>{s.shippedAt}</span></Field>
          <Field label={u("vesselFlight")}><span>{s.vessel ?? "—"}</span></Field>
          <Field label={u("exportEntryNo")}><span className="font-mono">{s.exportEntryNo ?? "—"}</span></Field>
        </Grid>
      </Card>}
    </StepPage>
  );
}
