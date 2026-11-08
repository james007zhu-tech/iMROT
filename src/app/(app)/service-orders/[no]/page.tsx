import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { advanceServiceOrder } from "@/server/slm";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { maskName } from "@/lib/mask";
import { Flash } from "@/components/Flash";
import { OrderProgress } from "@/components/OrderProgress";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { Alert, AssetTriple, Card, FaultText, Field, Grid, PageHeader, Table, Value, btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { ORDER_TRANSITIONS, type OrderStatus } from "@/lib/lifecycle";
import { nextSteps, reportsFor, stepHref, type StepKey } from "@/lib/order-steps";
import { businessClosureOn } from "@/lib/closure";
import { pdfAvailable } from "@/server/office";
import { MIN_MARGIN_PCT } from "@/lib/margin";
import { approveMargin } from "@/server/slm";
import { loadOrder } from "./_shell";

export const dynamic = "force-dynamic";

/**
 * 服务单详情 — wireframe 5. The page shows the order and what has been done; each step is its own form page,
 * reached from the "next step" panel. Only assigning is done inline (one select).
 */
export default async function OrderDetail({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { no } = await params;
  const { ok, error } = await searchParams;
  const order = await loadOrder(no);
  const [t, u, ts, te, locale, tInq, tPo] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("orderStatus"), getTranslations("eventType"), getLocale(), getTranslations("inquiryStatus"), getTranslations("poStatus")]);
  const engineers = await prisma.employee.findMany({ where: { active: true, role: { in: ["ENGINEER", "MANAGER", "MD", "ADMIN"] } }, orderBy: { name: "asc" } });
  const stamp = (d: Date) => new Intl.DateTimeFormat(locale, { ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}), month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  const jobs = order.repairJobs;
  const shape = {
    status: order.status, kind: order.kind, hasInspection: order.inspections.length > 0, hasQuote: order.lines.length > 0, hasJob: jobs.length > 0, jobFinished: jobs.some((j) => j.finishedAt),
    workshop: jobs.some((j) => j.location === "WORKSHOP") || order.documents.some((d) => d.type === "ER"),
    deliveriesSigned: order.deliveries.filter((d) => d.status === "SIGNED").length, deliveriesOpen: order.deliveries.filter((d) => d.status !== "SIGNED").length,
    invoicesUnpaid: order.invoices.filter((i) => !i.paidAt).length, hasAcceptance: !!order.acceptance,
  };
  // With invoicing and payments switched off (BUSINESS_CLOSURE), the order never points at those steps (trial 2026-11-05).
  const money = (k: StepKey) => k === "invoice" || k === "payment";
  const steps = nextSteps(shape);
  const primary = businessClosureOn() || !steps.primary || !money(steps.primary) ? steps.primary : undefined;
  const also = businessClosureOn() ? steps.also : steps.also.filter((k) => !money(k));
  const stepLabel = (s: StepKey) => u(`step_${s}`);
  const transitions = ORDER_TRANSITIONS[order.status as OrderStatus].filter((s) => s === "CANCELLED" || s === "CLOSED");
  // "项目完成" (flow step 10): the person confirms the close once the money is in; the system no longer closes by itself.
  const outstanding = order.invoices.reduce((s, i) => s + Math.max(0, Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0)), 0);
  const settledAwaitingClose = order.status === "INVOICED" && order.invoices.length > 0 && outstanding < 0.005;

  async function assign(form: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await advanceServiceOrder(no, "ASSIGNED", me.code, String(form.get("note") || "") || undefined, String(form.get("assignee") || "") || undefined);
    }, `/service-orders/${no}`);
  }
  async function contractDirect() {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await advanceServiceOrder(no, "IN_PROGRESS", me.code, "CONTRACT"); }, `/service-orders/${no}`);
  }
  async function move(form: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await advanceServiceOrder(no, form.get("to") as OrderStatus, me.code); }, `/service-orders/${no}`);
  }
  async function decideMargin(form: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await approveMargin({ no, actorCode: me.code, decision: form.get("decision") as "APPROVED" | "REJECTED", note: String(form.get("note") || "") || undefined }); }, `/service-orders/${no}`);
  }
  const me = await currentEmployee();
  const marginLow = order.marginPct != null && Number(order.marginPct) < MIN_MARGIN_PCT;
  const canBuy = !order.lockedAt && ["DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS"].includes(order.status);

  // One line per document: who, when, what it says, which reports it renders to.
  const summaryOf = (docNo: string, type: string): React.ReactNode => {
    if (type === "IN") { const i = order.inspections.find((x) => x.no === docNo); return [i?.findings, i?.probableCause].filter(Boolean).join(" → "); }
    if (type === "QT") return order.total != null ? `${order.currency} ${Number(order.total).toFixed(2)} ${u("inclVat")}${order.quoteConfirmedAt ? ` · ${u("poConfirmed")}` : ""}` : u("draft");
    if (type === "RP") { const j = jobs.find((x) => x.no === docNo); return j?.rootCause ?? j?.workPerformed ?? ""; }
    if (type === "PM") { const j = jobs.find((x) => x.no === docNo); return j?.hazards ? <FaultText>{j.hazards}</FaultText> : j?.handled ?? ""; }
    if (type === "ER") { const e = order.events.find((x) => x.sourceDocNo === docNo); return (e?.payload as { accessories?: string } | null)?.accessories ?? e?.summary ?? ""; }
    if (type === "DN") { const d = order.deliveries.find((x) => x.no === docNo); return d ? (d.status === "SIGNED" ? `${u("signedBy")} ${maskName(d.signedBy)}` : u("awaitingSignature")) : ""; }
    if (type === "TI") { const x = order.taxInvoices.find((y) => y.no === docNo); return x ? `${x.currency} ${Number(x.total).toFixed(2)}` : ""; }
    if (type === "IV") { const x = order.invoices.find((y) => y.no === docNo); return x ? `${x.currency} ${Number(x.amountDue).toFixed(2)}${x.paidAt ? ` · ${t("paid")}` : ""}` : ""; }
    if (type === "PR") { const x = order.inquiries.find((y) => y.no === docNo); return x ? <Link href={`/purchasing/inquiries/${x.no}`} className="text-blue hover:underline">{tInq(x.status)} · {(x.lines as unknown[]).length} {u("lines")}</Link> : ""; }
    if (type === "PO") { const x = order.purchaseOrders.find((y) => y.no === docNo); return x ? <Link href={`/purchasing/orders/${x.no}`} className="text-blue hover:underline">{tPo(x.status)} · {x.currency} {Number(x.total).toFixed(2)}</Link> : ""; }
    if (type === "RC") { const e = order.events.find((x) => x.sourceDocNo === docNo); return e?.summary ?? ""; }
    return "";
  };
  const reportLink = (docNo: string, r: { template?: string; key: string }) => <a key={r.key} className="text-blue hover:underline" href={`/api/documents/${docNo}/render?format=pdf${r.template ? `&template=${r.template}` : ""}`}>{u(r.key)}</a>;
  const docs = order.documents.filter((d) => !d.voidedAt);
  const allReports = docs.flatMap((d) => reportsFor(d, shape.hasAcceptance, shape.hasQuote).map((r) => ({ no: d.no, ...r })));

  // Timeline: the order's events, one line per document/step even when several assets carry the same event.
  const seen = new Set<string>();
  const timeline = order.events.filter((e) => { const k = `${e.type}|${e.sourceDocNo}|${e.occurredAt.toISOString().slice(0, 16)}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const atts = (order.attachments as { name: string; url: string; kind: string }[] | null) ?? [];

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/service-orders", label: u("backToOrders") }} title={<span className="font-mono">{order.no}</span>} badge={<OrderStatusBadge status={order.status} />}
        actions={<>
          {allReports.length > 0 && <details className="relative"><summary className={`${btnGhost} cursor-pointer list-none`}>{u((await pdfAvailable()) ? "exportPdf" : "exportWord")} ▾</summary><div className="absolute right-0 z-10 mt-1 flex w-64 flex-col gap-1 rounded-lg border bg-white p-2 text-sm shadow">{allReports.map((r) => <a key={`${r.no}${r.key}`} className="rounded px-2 py-1 hover:bg-tint" href={`/api/documents/${r.no}/render?format=pdf${r.template ? `&template=${r.template}` : ""}`}>{u(r.key)} <span className="font-mono text-xs text-navy/60">{r.no}</span></a>)}</div></details>}
          {primary && primary !== "assign" && primary !== "contractDirect" && <Link href={stepHref(order.no, primary)} className={btnBlue}>{u("nextStep")}: {stepLabel(primary)}</Link>}
        </>} />
      <OrderProgress status={order.status as OrderStatus} />
      <Flash ok={ok} error={error} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={u("assetAndReport")}>
            <Grid>
              <Field label={t("asset")}><div className="space-y-2 rounded-md border bg-white px-2.5 py-2 text-sm">{order.assets.map((l) => <AssetTriple key={l.assetId} asset={l.asset} />)}</div></Field>
              <Field label={u("customerPlantLocation")}><Value>{order.customer.name}{order.plant ? ` · ${order.plant.code}` : ""}{order.assets[0]?.asset.location ? ` · ${order.assets[0].asset.location}` : ""}</Value></Field>
              <Field label={t("customerRef")}><Value className="font-mono">{order.customerRef ?? "—"}</Value></Field>
            </Grid>
            <Field label={t("symptom")}><Value><FaultText>{order.reportedSymptom ?? "—"}{order.reportedAlarm ? ` · ${order.reportedAlarm}` : ""}</FaultText>{order.productionImpact ? <span className="ml-2 text-navy/80">· {["STOPPED", "DEGRADED", "NONE"].includes(order.productionImpact) ? u(`impact${order.productionImpact[0]}${order.productionImpact.slice(1).toLowerCase()}`) : order.productionImpact}</span> : null}</Value></Field>
            {atts.length > 0 && <div className="flex flex-wrap gap-2 text-xs">{atts.map((a) => <a key={a.url} href={a.url} target="_blank" className="rounded-full border border-navy/35 bg-white px-2.5 py-0.5 font-semibold">📄 {["INQUIRY", "PO", "MESSAGE", "PAYMENT", "CUSTOMER_DN"].includes(a.kind) ? `${u(`kind_${a.kind}`)} · ` : ""}{a.name}</a>)}</div>}
          </Card>

          <Card title={u("documentsDone")}>
            <Table head={[u("document"), t("type"), u("time"), u("executor"), u("summary"), u("reports")]}>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td className="font-mono">{d.no}</td>
                  <td>{u(`docType_${d.type}`)}</td>
                  <td className="whitespace-nowrap">{stamp(d.issuedAt)}</td>
                  <td>{d.createdBy.name}</td>
                  <td>{summaryOf(d.no, d.type)}</td>
                  <td className="space-x-2">{reportsFor(d, shape.hasAcceptance, shape.hasQuote).map((r) => reportLink(d.no, r))}</td>
                </tr>
              ))}
            </Table>
          </Card>

          {order.lines.length > 0 && <Card title={u("quote")}>
            <Table head={["#", t("asset"), u("descEnTh"), t("qty"), t("price"), t("amount")]}>
              {order.lines.map((l) => <tr key={l.id}><td>{l.lineNo}</td><td className="font-mono">{l.assetCode ?? ""}</td><td>{l.description}{l.descriptionLocal ? <span className="block text-xs text-navy/70">{l.descriptionLocal}</span> : null}</td><td>{Number(l.qty)} {l.unit}</td><td className="text-right">{Number(l.unitPrice).toFixed(2)}</td><td className="text-right">{Number(l.amount).toFixed(2)}</td></tr>)}
            </Table>
            <p className="text-right text-[13px]">{t("subtotal")} {Number(order.subtotal).toFixed(2)} · {t("vat")} {Number(order.vatAmount).toFixed(2)} · <b>{t("total")} {order.currency} {Number(order.total).toFixed(2)}</b>{order.totalCny != null ? ` · CNY ${Number(order.totalCny).toFixed(2)} @${Number(order.fxRateToCny).toFixed(4)}` : ""}</p>
            {order.marginPct != null && <p className={`text-right text-[13px] ${marginLow ? "font-semibold text-alert-ink" : "text-navy/70"}`}>{u("marginLine", { cost: Number(order.costTotal ?? 0).toFixed(2), pct: (Number(order.marginPct) * 100).toFixed(1) })} · {u(`margin_${order.marginApproval}`)}{order.lockedAt ? ` · ${u("lockedAt", { date: order.lockedAt.toISOString().slice(0, 10) })}` : ""}</p>}
            {order.marginApproval === "PENDING" && me.role === "MD" && (
              <form action={decideMargin} className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-alert bg-alert/10 p-2">
                <span className="text-sm font-semibold text-alert-ink">{u("marginDecision")}</span>
                <input name="note" placeholder={u("marginNotePh")} className={`${inputCls} max-w-xs`} />
                <button name="decision" value="APPROVED" className={btnBlue}>{u("marginApprove")}</button>
                <button name="decision" value="REJECTED" className={btnGhost}>{u("marginReject")}</button>
              </form>)}
            {order.marginApproval === "PENDING" && me.role !== "MD" && <p className="mt-2 rounded-lg border border-alert bg-alert/10 p-2 text-sm text-alert-ink">{u("marginWaitingMd")}</p>}
          </Card>}
        </div>

        <div className="space-y-4">
          {primary && <Card title={`${u("nextStep")}: ${stepLabel(primary)}`} accent>
            {primary === "assign" ? (
              <form action={assign} id="assign" className="space-y-2">
                <select name="assignee" className={inputCls}>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select>
                <input name="note" placeholder={u("plannedVisitNote")} className={inputCls} />
                <button className={btnPrimary}>{stepLabel("assign")}</button>
              </form>
            ) : primary === "contractDirect" ? (
              <form action={contractDirect}><button className={btnBlue}>{stepLabel("contractDirect")} →</button></form>
            ) : <Link href={stepHref(order.no, primary)} className={btnBlue}>{stepLabel(primary)} →</Link>}
          </Card>}
          {(also.length > 0 || canBuy) && <Card title={u("alsoPossible")}>
            <div className="flex flex-col gap-2">{also.map((s) => <Link key={s} href={stepHref(order.no, s)} className={btnGhost}>{stepLabel(s)}</Link>)}{canBuy && <Link href={`/purchasing/inquiries/new?order=${order.no}`} className={btnGhost}>{u("newInquiry")} (PRTH)</Link>}</div>
          </Card>}
          {transitions.length > 0 && <Card title={t("status")}>
            {settledAwaitingClose && <Alert>{u("settledAwaitingClose")}</Alert>}
            {order.status === "INVOICED" && outstanding >= 0.005 && <p className="text-xs text-alert-ink">{u("closeWithOutstanding", { amount: `${order.currency} ${outstanding.toFixed(2)}` })}</p>}
            <form action={move} className="flex flex-wrap gap-2">{transitions.map((s) => <button key={s} name="to" value={s} className={`min-h-10 rounded-lg border px-3 text-sm font-semibold ${s === "CANCELLED" ? "border-alert text-alert-ink" : settledAwaitingClose ? "border-navy bg-navy text-white" : "border-navy/45"}`}>{u(s === "CANCELLED" ? "actionCancelOrder" : order.status === "INVOICED" ? "actionProjectComplete" : "actionCloseOrder")}</button>)}</form>
          </Card>}
          <Card title={u("timeline")}>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs text-navy/85">
              {timeline.map((e) => <div key={e.id} className="contents"><span className="whitespace-nowrap tabular-nums">{stamp(e.occurredAt)}</span><span>{te(e.type)}{e.sourceDocNo && e.sourceDocNo !== order.no ? ` ${e.sourceDocNo}` : ""}{e.actor?.name ? ` · ${e.actor.name}` : e.actorName ? ` · ${maskName(e.actorName)}` : ""}</span></div>)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
