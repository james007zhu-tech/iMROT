import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { recommendPartners } from "@/server/srm";
import { custodyOf, MANUAL_STAGES, type PartnerStageKind } from "@/lib/srm";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { Card, Field, Grid, PageHeader, Table, Tag, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { OrderBrief, loadOrder } from "../_shell";
import { dispatchAction, inquiryAction, milestoneAction, rateAction, retestAction, returnAction, reviseAction, supplierInvoiceAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 合作维修 — flow v4 (2026-11-08): partner PRTH and comparison, POTH, 外送 OBTH, milestones (internal only),
 * changes with customer consent, 我方取回 IBTH, our retest, supplier invoice and rating. The partner never meets
 * the customer, so nothing here is ever shown on the portal or printed for the partner with customer data.
 */
export default async function PartnerRepair({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u, tInq, tPo] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("inquiryStatus"), getTranslations("poStatus")]);
  const [partners, inquiries, pos] = await Promise.all([
    recommendPartners(no),
    prisma.purchaseInquiry.findMany({ where: { serviceOrderId: order.id, kind: "SUBCONTRACT" }, orderBy: { createdAt: "desc" }, include: { quotes: { include: { supplier: { select: { name: true } } } } } }),
    prisma.purchaseOrder.findMany({ where: { serviceOrderId: order.id, kind: "SUBCONTRACT" }, orderBy: { createdAt: "asc" }, include: { supplier: true, milestones: { orderBy: { at: "asc" }, include: { by: { select: { name: true } } } }, invoices: { orderBy: { createdAt: "asc" } }, ratings: true, receipts: { where: { kind: { in: ["SUBCONTRACT_OUT", "SUBCONTRACT_RETURN"] } }, orderBy: [{ movedAt: "asc" }, { direction: "desc" }] } } }),
  ]);
  const locked = !!order.lockedAt;
  const openInquiry = inquiries.find((i) => i.status === "OPEN" || i.status === "COMPARED");
  const day = (d?: Date | null) => (d ? localIso(d)!.slice(0, 10) : "—");
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  // what came in on the ERTH travels on to the partner by default
  const erAccessories = (assetId: string) => (order.events.find((e) => e.type === "RECEIVED_WORKSHOP" && e.assetId === assetId)?.payload as { accessories?: string } | null)?.accessories ?? "";
  const accText = (a: unknown) => ((a as { item: string; qty: number }[] | null) ?? []).map((x) => `${x.item} × ${x.qty}`).join("\n");
  const stageLabel = (s: string) => u(`stage_${s}`);
  const report = (docNo: string, key: string) => <a key={docNo} className="text-blue hover:underline" href={`/api/documents/${docNo}/render?format=pdf`}>{u(key)} <span className="font-mono">{docNo}</span></a>;

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/service-orders/${order.no}`, label: order.no }} title={u("step_partner")} badge={<><Tag>{u(`mode_${order.mode}`)}</Tag><OrderStatusBadge status={order.status} /></>} />
      <Flash ok={ok} error={error} />
      <OrderBrief order={order} />
      <div className="rounded-lg border border-blue/40 bg-tint px-4 py-2 text-sm">{u("partnerPrinciple")}{order.partnerReason ? <span className="block text-xs text-navy/70">{u("partnerReason")}: {order.partnerReason}</span> : null}</div>

      {order.mode !== "PARTNER_REPAIR" ? <Card title={u("partnerRepair")}><p className="text-sm">{u("notPartnerOrder")}</p></Card> : (<>
        <Card title={u("recommendedPartners")}>
          <details open={!pos.length}><summary className="cursor-pointer text-xs text-navy/70">{u("topPartners", { n: Math.min(partners.length, 8) })}</summary>
          <Table head={[u("supplier"), u("capabilities"), u("partnerScore"), u("partnerJobs"), u("paymentTerms")]}>
            {partners.slice(0, 8).map((p) => <tr key={p.id} className={p.match ? "" : "text-navy/50"}><td><Link href={`/suppliers/${p.code}`} className="text-blue hover:underline">{p.code}</Link> {p.name} <span className="text-xs text-navy/60">{p.countryCode}</span></td><td className="text-xs">{p.capabilities.join(" · ") || "—"}</td><td>{p.score ?? "—"}</td><td>{p.jobs}</td><td className="text-xs">{u(`pay_${p.paymentMode}`)}</td></tr>)}
          </Table>
          </details>
          {!partners.length && <p className="py-3 text-center text-sm text-navy/60">{u("noPartnersYet")}</p>}
        </Card>

        <Card title={u("partnerInquiry")}>
          {inquiries.length > 0 && <Table head={["PRTH", t("status"), u("quotesIn"), u("selectedQuote")]}>
            {inquiries.map((i) => <tr key={i.id}><td><Link href={`/purchasing/inquiries/${i.no}`} className="font-mono text-blue hover:underline">{i.no}</Link></td><td>{tInq(i.status)}</td><td>{i.quotes.length}</td><td>{i.quotes.find((q) => q.selected) ? `${i.quotes.find((q) => q.selected)!.supplier.name} · ${Number(i.quotes.find((q) => q.selected)!.subtotal).toFixed(2)} · ${i.quotes.find((q) => q.selected)!.warrantyDays ?? "—"} d` : "—"}</td></tr>)}
          </Table>}
          {!openInquiry && !locked && !pos.length && <form action={inquiryAction.bind(null, order.no)} className="mt-2 space-y-2">
            <Grid>
              <Field label={u("neededBy")}><input name="neededBy" type="date" className={inputCls} /></Field>
              <Field label={t("note")}><input name="note" className={inputCls} /></Field>
            </Grid>
            <p className="text-xs text-navy/70">{u("partnerInquiryHint")}</p>
            <button className={btnBlue}>{u("sendPartnerInquiry")}</button>
          </form>}
          {openInquiry && <p className="mt-2 text-sm"><Link href={`/purchasing/inquiries/${openInquiry.no}`} className={btnGhost}>{u("comparePartnerQuotes")} → {openInquiry.no}</Link></p>}
          <p className="mt-2 text-xs text-navy/70">{u("partnerFlowHint", { floor: 33 })}{order.warrantyDays != null ? ` · ${u("customerPromise", { days: order.warrantyDays })}` : ""}</p>
        </Card>

        {pos.map((po) => {
          const stagesOf = (assetId: string) => po.milestones.filter((m) => m.assetId === assetId).map((m) => m.stage as PartnerStageKind);
          const passedAny = po.milestones.some((m) => m.stage === "RETEST_PASSED");
          const revs = (po.revisions as { version: number; at: string; reason: string; subtotalFrom: number; subtotalTo: number; customerConsent?: string | null }[] | null) ?? [];
          const firstLine = (po.lines as { description: string; qty: number; unit: string; unitPrice: number }[])[0];
          return (
            <Card key={po.id} title={<span><Link href={`/purchasing/orders/${po.no}`} className="font-mono text-blue hover:underline">{po.no}</Link>{po.version > 1 ? ` · v${po.version}` : ""} · {po.supplier.name}</span>}>
              <div className="grid gap-2 text-sm md:grid-cols-5">
                <div><span className="text-navy/60">{t("status")}</span><br />{tPo(po.status)}</div>
                <div><span className="text-navy/60">{u("partnerWarranty")}</span><br />{po.warrantyDays != null ? `${po.warrantyDays} d` : "—"}</div>
                <div><span className="text-navy/60">{u("dueBack")}</span><br />{day(po.expectedAt)}</div>
                <div><span className="text-navy/60">{t("subtotal")}</span><br />{po.currency} {Number(po.subtotal).toFixed(2)}</div>
                <div><span className="text-navy/60">{u("paymentTerms")}</span><br /><span className="text-xs">{u(`pay_${po.supplier.paymentMode}`)}</span></div>
              </div>
              {po.scope && <p className="mt-1 text-sm"><span className="text-navy/60">{u("partnerSolution")}:</span> {po.scope}</p>}
              <div className="mt-1 flex flex-wrap gap-3 text-sm">{report(po.no, "rpt25")}{po.receipts.map((m) => report(m.no, m.kind === "SUBCONTRACT_OUT" ? "rpt28" : "rpt29"))}</div>

              {order.assets.map((l) => {
                const state = custodyOf(stagesOf(l.assetId));
                const lastOut = [...po.receipts].reverse().find((m) => m.assetId === l.assetId && m.kind === "SUBCONTRACT_OUT");
                const f = (s: string) => `${s}-${po.id}-${l.assetId}`;
                return (
                  <div key={l.assetId} className="mt-3 rounded-lg border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-sm"><span className="font-mono font-semibold">{l.asset.code}</span><span>S/N {l.asset.serialNumber}</span><Tag hot={state === "AT_PARTNER" || state === "FAILED"}>{u(`custody_${state}`)}</Tag></div>
                    {!locked && po.status !== "CANCELLED" && (state === "NONE" || state === "FAILED") && (<>
                      <UploadRecognize kind="receive" formId={f("d")} title={u("upDispatchTitle")} hint={u("upDispatchHint")} />
                      <form id={f("d")} action={dispatchAction.bind(null, order.no)} className="space-y-2">
                        <input type="hidden" name="poNo" value={po.no} /><input type="hidden" name="assetCode" value={l.asset.code} />
                        <Grid>
                          <Field label={u("dispatchedAt")}><input name="movedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
                          <Field label={u("carriedBy")}><input name="carriedBy" className={inputCls} /></Field>
                          <Field label={u("partnerSigned")}><input name="partnerSigned" className={inputCls} /></Field>
                        </Grid>
                        <Grid cols={2}>
                          <Field label={u("accessoriesList")}><textarea name="accessories" rows={3} defaultValue={state === "FAILED" ? accText(lastOut?.accessories) : erAccessories(l.assetId)} placeholder={u("accessoriesPh")} className={inputCls} /></Field>
                          <Field label={u("conditionOut")}><textarea name="condition" rows={3} className={inputCls} /></Field>
                        </Grid>
                        <button className={btnPrimary}>{state === "FAILED" ? u("dispatchRework") : u("dispatchToPartner")}</button>
                      </form>
                    </>)}
                    {!locked && state === "AT_PARTNER" && (<div className="grid gap-3 lg:grid-cols-2">
                      <div>
                        <UploadRecognize kind="repair" formId={f("m")} title={u("upMilestoneTitle")} hint={u("upMilestoneHint")} />
                        <form id={f("m")} action={milestoneAction.bind(null, order.no)} className="space-y-2">
                          <input type="hidden" name="poNo" value={po.no} /><input type="hidden" name="assetCode" value={l.asset.code} />
                          <Field label={u("milestone")}><select name="stage" className={inputCls}>{MANUAL_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}</select></Field>
                          <Field label={u("time")}><input name="at" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
                          <Field label={t("note")}><textarea name="note" rows={2} className={inputCls} /></Field>
                          <button className={btnGhost}>{u("addMilestone")}</button>
                        </form>
                      </div>
                      <div>
                        <UploadRecognize kind="receive" formId={f("r")} title={u("upReturnTitle")} hint={u("upReturnHint")} />
                        <form id={f("r")} action={returnAction.bind(null, order.no)} className="space-y-2">
                          <input type="hidden" name="poNo" value={po.no} /><input type="hidden" name="assetCode" value={l.asset.code} />
                          <Field label={u("returnedAccessories")}><textarea name="returned" rows={3} defaultValue={accText(lastOut?.accessories)} className={inputCls} /></Field>
                          <Grid cols={2}>
                            <Field label={u("returnedAt")}><input name="movedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
                            <Field label={u("partnerSigned")}><input name="partnerSigned" className={inputCls} /></Field>
                          </Grid>
                          <Field label={u("shortAccepted")}><input name="shortAccepted" placeholder={u("shortAcceptedPh")} className={inputCls} /></Field>
                          <button className={btnPrimary}>{u("takeBack")}</button>
                        </form>
                      </div>
                    </div>)}
                    {!locked && state === "RETURNED" && (<>
                      <UploadRecognize kind="repair" formId={f("t")} title={u("upRetestTitle")} hint={u("upRetestHint")} />
                      <form id={f("t")} action={retestAction.bind(null, order.no)} className="space-y-2">
                        <input type="hidden" name="poNo" value={po.no} /><input type="hidden" name="assetCode" value={l.asset.code} />
                        <Field label={u("retestResult")}><textarea name="note" rows={2} placeholder={u("retestPh")} className={inputCls} /></Field>
                        <div className="flex gap-2"><button name="passed" value="1" className={btnBlue}>{u("retestPass")}</button><button name="passed" value="0" className={btnGhost}>{u("retestFail")}</button></div>
                      </form>
                    </>)}
                  </div>
                );
              })}

              {po.milestones.length > 0 && <div className="mt-3"><Table head={[u("time"), t("asset"), u("milestone"), t("note"), u("executor")]}>
                {po.milestones.map((m) => <tr key={m.id}><td className="whitespace-nowrap">{localIso(m.at)!.slice(0, 16).replace("T", " ")}</td><td className="font-mono">{order.assets.find((a) => a.assetId === m.assetId)?.asset.code ?? ""}</td><td>{stageLabel(m.stage)}{m.sourceDocNo ? <span className="ml-1 font-mono text-xs">{m.sourceDocNo}</span> : null}</td><td>{m.note ?? ""}{((m.attachments as { name: string; url: string }[] | null) ?? []).map((a) => <a key={a.url} href={a.url} target="_blank" className="ml-1 text-blue">📎</a>)}</td><td>{m.by.name}</td></tr>)}
              </Table><p className="text-xs text-navy/60">{u("milestonesInternal")}</p></div>}

              {revs.length > 0 && <div className="mt-3"><Table head={[u("version"), u("time"), u("reason"), t("subtotal"), u("customerConsent")]}>
                {revs.map((r) => <tr key={r.version}><td>v{r.version}</td><td>{r.at.slice(0, 10)}</td><td>{r.reason}</td><td>{r.subtotalFrom.toFixed(2)} → {r.subtotalTo.toFixed(2)}</td><td>{r.customerConsent ?? "—"}</td></tr>)}
              </Table></div>}

              {!locked && po.status !== "CANCELLED" && !passedAny && <details className="mt-3 rounded-lg border p-3"><summary className="cursor-pointer text-sm font-semibold">{u("revisePo")}</summary>
                <form action={reviseAction.bind(null, order.no)} className="mt-2 space-y-2">
                  <input type="hidden" name="poNo" value={po.no} />
                  <Grid>
                    <Field label={t("description")}><input name="description" defaultValue={firstLine?.description ?? ""} className={inputCls} /></Field>
                    <Field label={t("qty")}><input name="qty" type="number" step="0.001" defaultValue={firstLine?.qty ?? 1} className={inputCls} /></Field>
                    <Field label={u("unitPriceExVat")}><input name="unitPrice" type="number" step="0.01" defaultValue={firstLine?.unitPrice ?? ""} className={inputCls} /></Field>
                    <Field label={u("dueBack")}><input name="expectedAt" type="date" defaultValue={localIso(po.expectedAt)?.slice(0, 10) ?? ""} className={inputCls} /></Field>
                  </Grid>
                  <Field label={u("reason")} required><input name="reason" required className={inputCls} /></Field>
                  <Field label={u("customerConsent")}><input name="customerConsent" placeholder={u("customerConsentPh")} className={inputCls} /></Field>
                  <p className="text-xs text-navy/70">{u("reviseHint")}</p>
                  <button className={btnGhost}>{u("saveRevision")}</button>
                </form>
              </details>}

              {passedAny && <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-semibold">{u("supplierInvoices")}</p>
                  {po.invoices.map((i) => <p key={i.id} className="text-sm"><span className="font-mono">{i.invoiceNo}</span> · {i.currency} {Number(i.payable).toFixed(2)} · {u("dueOn", { date: day(i.dueDate) })} · <Tag hot={i.status === "OPEN"}>{u(`payable_${i.status}`)}</Tag>{i.paymentNo ? <span className="ml-1 font-mono text-xs">{i.paymentNo}</span> : null}</p>)}
                  {Number(po.subtotal) - po.invoices.filter((i) => i.status !== "CANCELLED").reduce((s, i) => s + Number(i.subtotal), 0) > 0.005 && (<>
                    <UploadRecognize kind="purchase" formId={f2(po.id)} title={u("upSupplierInvoiceTitle")} hint={u("upSupplierInvoiceHint")} />
                    <form id={f2(po.id)} action={supplierInvoiceAction.bind(null, order.no)} className="space-y-2">
                      <input type="hidden" name="poNo" value={po.no} />
                      <Grid>
                        <Field label={u("supplierInvoiceNo")} required><input name="invoiceNo" required className={`${inputCls} font-mono`} /></Field>
                        <Field label={t("date")} required><input name="invoiceDate" type="date" required defaultValue={now.slice(0, 10)} className={inputCls} /></Field>
                        <Field label={t("subtotal")} required><input name="subtotal" type="number" step="0.01" required defaultValue={Number(po.subtotal).toFixed(2)} className={inputCls} /></Field>
                      </Grid>
                      <p className="text-xs text-navy/70">{u("supplierInvoiceHint")}</p>
                      <button className={btnGhost}>{u("registerSupplierInvoice")}</button>
                    </form>
                  </>)}
                </div>
                <div className="rounded-lg border p-3">
                  <p className="mb-2 text-sm font-semibold">{u("ratePartner")}</p>
                  <form action={rateAction.bind(null, order.no)} className="space-y-2">
                    <input type="hidden" name="poNo" value={po.no} />
                    <Grid cols={2}>{(["quality", "onTime", "price", "cooperation"] as const).map((k) => <Field key={k} label={u(`rate_${k}`)}><select name={k} defaultValue={String(po.ratings[0]?.[k] ?? 4)} className={inputCls}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n}</option>)}</select></Field>)}</Grid>
                    <Field label={t("note")}><input name="note" defaultValue={po.ratings[0]?.note ?? ""} className={inputCls} /></Field>
                    <button className={btnGhost}>{po.ratings.length ? u("updateRating") : u("saveRating")}</button>
                  </form>
                </div>
              </div>}
            </Card>
          );
        })}
        {!pos.length && <p className="text-sm text-navy/70">{u("partnerPoAfterConfirm")}</p>}
      </>)}
    </div>
  );
}

const f2 = (id: string) => `inv-${id}`;
