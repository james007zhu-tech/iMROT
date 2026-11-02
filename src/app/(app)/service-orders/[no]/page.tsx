import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { advanceServiceOrder, getServiceOrder } from "@/server/slm";
import { createInspection, createRepairJob, recordAcceptance, setQuoteLines } from "@/server/slm-docs";
import { issueInvoice, issueTaxInvoice, recordPayment } from "@/server/to";
import { currentEmployee } from "@/server/auth";
import { OrderProgress } from "@/components/OrderProgress";
import { OrderStatusBadge } from "@/components/StatusBadge";
import { ORDER_TRANSITIONS, type OrderStatus } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

const input = "w-full rounded border px-2 py-1.5 text-sm";
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-lg border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{title}</h2>{children}</section>;
}

/**
 * One page carries the whole ten-step flow. The action panel shown depends on the order's status,
 * so an engineer always sees exactly the next thing to do.
 */
export default async function OrderDetail({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const order = await getServiceOrder(no);
  if (!order) notFound();
  const t = await getTranslations("common");
  const ts = await getTranslations("orderStatus");
  const locale = await getLocale();
  const fmt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(d) : "—");
  const employees = await prisma.employee.findMany({ where: { active: true, role: { in: ["ENGINEER", "MANAGER", "ADMIN"] } } });
  const next = ORDER_TRANSITIONS[order.status as OrderStatus];
  const primaryAsset = order.assets[0]?.asset;

  // ── server actions (each one is a thin call into the service layer) ──
  async function advance(form: FormData) {
    "use server";
    const me = await currentEmployee();
    await advanceServiceOrder(no, form.get("to") as OrderStatus, me.code, String(form.get("note") || "") || undefined);
    redirect(`/service-orders/${no}`);
  }
  async function inspect(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const tests = ["Visual condition", "Power supply", "Fault history", "Functional check"].map((test) => ({ test, criterion: String(form.get(`c_${test}`) || ""), result: String(form.get(`r_${test}`) || "") })).filter((r) => r.criterion || r.result);
    await createInspection({ serviceOrderNo: no, assetCode: String(form.get("assetCode")), engineerCode: me.code, symptoms: order!.reportedSymptom ?? undefined, conditions: str(form, "conditions"), findings: str(form, "findings"), probableCause: str(form, "probableCause"), recommendation: str(form, "recommendation"), instruments: str(form, "instruments"), openIssues: str(form, "openIssues"), conclusion: str(form, "conclusion"), tests });
    if (order!.status === "ASSIGNED") await advanceServiceOrder(no, "DIAGNOSING", me.code);
    redirect(`/service-orders/${no}`);
  }
  async function quote(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const lines = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ assetCode: str(form, `a${i}`), description: str(form, `d${i}`) ?? "", descriptionLocal: str(form, `l${i}`), qty: Number(form.get(`q${i}`) || 0), unit: "pcs", unitPrice: Number(form.get(`p${i}`) || 0) })).filter((l) => l.description && l.qty > 0);
    await setQuoteLines({ serviceOrderNo: no, actorCode: me.code, lines });
    if (order!.status === "DIAGNOSING") await advanceServiceOrder(no, "QUOTE_PENDING", me.code);
    redirect(`/service-orders/${no}`);
  }
  async function repair(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const tests = ["Visual inspection", "Approved electrical tests", "No load operation", "Load test if agreed"].map((test) => ({ test, criterion: String(form.get(`c_${test}`) || ""), result: String(form.get(`r_${test}`) || ""), pass: form.get(`p_${test}`) === "on" })).filter((r) => r.criterion || r.result);
    await createRepairJob({ serviceOrderNo: no, assetCode: String(form.get("assetCode")), engineerCode: me.code, kind: form.get("kind") as "REPAIR", location: form.get("location") as "SITE", finishedAt: form.get("finished") === "on" ? new Date() : undefined, confirmedFault: str(form, "confirmedFault"), rootCause: str(form, "rootCause"), workPerformed: str(form, "workPerformed"), configBackupRef: str(form, "configBackupRef"), laborHours: form.get("laborHours") ? Number(form.get("laborHours")) : undefined, openIssues: str(form, "openIssues"), conclusion: str(form, "conclusion"), tests });
    if (form.get("finished") === "on" && order!.status === "IN_PROGRESS") await advanceServiceOrder(no, "ACCEPTANCE_PENDING", me.code);
    redirect(`/service-orders/${no}`);
  }
  async function accept(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const deliverables = [0, 1, 2].map((i) => ({ deliverable: str(form, `dv${i}`) ?? "", criterion: str(form, `cr${i}`), result: str(form, `rs${i}`) })).filter((d) => d.deliverable);
    await recordAcceptance({ serviceOrderNo: no, actorCode: me.code, deliverables, status: form.get("status") as "ACCEPTED", punchList: str(form, "punchList"), warrantyTerms: str(form, "warrantyTerms"), warrantyStart: form.get("warrantyStart") ? new Date(String(form.get("warrantyStart"))) : undefined, customerSignatory: str(form, "customerSignatory"), dcitSignatory: me.name });
    redirect(`/service-orders/${no}`);
  }
  async function invoice() {
    "use server";
    const me = await currentEmployee();
    const ti = await issueTaxInvoice({ serviceOrderNo: no, actorCode: me.code });
    await issueInvoice({ serviceOrderNo: no, actorCode: me.code, taxInvoiceNo: ti.no });
    redirect(`/service-orders/${no}`);
  }
  async function pay(form: FormData) {
    "use server";
    const me = await currentEmployee();
    await recordPayment({ invoiceNo: String(form.get("invoiceNo")), actorCode: me.code, paidAt: new Date(String(form.get("paidAt"))), paidAmount: Number(form.get("paidAmount")), whtAmount: Number(form.get("whtAmount") || 0), whtCertRef: str(form, "whtCertRef"), bankRef: str(form, "bankRef") });
    redirect(`/service-orders/${no}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/service-orders" className="text-sm text-blue">← {t("serviceOrders")}</Link>
        <h1 className="font-mono text-2xl font-bold">{order.no}</h1>
        <OrderStatusBadge status={order.status} />
        <span className="text-slate-600">{t(order.kind)} · {order.customer.name}{order.plant ? ` / ${order.plant.name}` : ""}{order.customerRef ? ` · ref ${order.customerRef}` : ""}</span>
      </div>
      <OrderProgress status={order.status as OrderStatus} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title={t("assets")}>
            <ul className="text-sm">{order.assets.map((l) => <li key={l.assetId}><Link href={`/assets/${l.asset.code}`} className="font-mono text-blue underline">{l.asset.code}</Link> · {l.asset.model ? `${l.asset.model.series.brand.name} ${l.asset.model.code}` : ""} · S/N {l.asset.serialNumber} · {l.asset.location ?? ""}</li>)}</ul>
            {order.reportedSymptom && <p className="mt-2 text-sm"><b>Symptom:</b> {order.reportedSymptom}{order.reportedAlarm ? ` (${order.reportedAlarm})` : ""}</p>}
            {order.productionImpact && <p className="text-sm"><b>Impact:</b> {order.productionImpact}</p>}
            <p className="mt-1 text-xs text-slate-500">{t("reportedAt")} {fmt(order.reportedAt)} · {t("assignee")} {order.assignee?.name ?? t("none")} · {t("by")} {order.createdBy.name}</p>
          </Card>

          {order.inspections.length > 0 && <Card title="INTH">
            {order.inspections.map((i) => <div key={i.id} className="mb-2 border-b pb-2 text-sm last:border-0"><span className="font-mono">{i.no}</span> · {fmt(i.inspectedAt)}<br />{i.findings}{i.probableCause ? ` → ${i.probableCause}` : ""}{i.recommendation ? ` · ${i.recommendation}` : ""}</div>)}
          </Card>}

          {order.lines.length > 0 && <Card title="QTTH">
            <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th>#</th><th>{t("asset")}</th><th>Description</th><th className="text-right">Qty</th><th className="text-right">Unit</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{order.lines.map((l) => <tr key={l.id} className="border-t"><td>{l.lineNo}</td><td className="font-mono">{l.assetCode ?? ""}</td><td>{l.description}{l.descriptionLocal ? <span className="block text-xs text-slate-500">{l.descriptionLocal}</span> : null}</td><td className="text-right">{Number(l.qty)}</td><td className="text-right">{Number(l.unitPrice).toFixed(2)}</td><td className="text-right">{Number(l.amount).toFixed(2)}</td></tr>)}</tbody>
              <tfoot className="border-t font-semibold"><tr><td colSpan={5} className="text-right">Subtotal</td><td className="text-right">{Number(order.subtotal).toFixed(2)}</td></tr><tr><td colSpan={5} className="text-right">VAT</td><td className="text-right">{Number(order.vatAmount).toFixed(2)}</td></tr><tr><td colSpan={5} className="text-right">{t("total")} {order.currency}</td><td className="text-right">{Number(order.total).toFixed(2)}</td></tr>{order.totalCny != null && <tr className="text-slate-500"><td colSpan={5} className="text-right">CNY @ {Number(order.fxRateToCny).toFixed(4)}</td><td className="text-right">{Number(order.totalCny).toFixed(2)}</td></tr>}</tfoot>
            </table>
          </Card>}

          {order.repairJobs.length > 0 && <Card title="RPTH / PMTH">
            {order.repairJobs.map((j) => <div key={j.id} className="mb-2 border-b pb-2 text-sm last:border-0"><span className="font-mono">{j.no}</span> · {j.kind} · {j.location} · {fmt(j.startedAt)}{j.finishedAt ? ` → ${fmt(j.finishedAt)}` : ""}<br />{j.confirmedFault}{j.rootCause ? ` → ${j.rootCause}` : ""}<br /><span className="text-slate-600">{j.workPerformed}</span></div>)}
          </Card>}

          {order.acceptance && <Card title="12 / 13">
            <p className="text-sm">{order.acceptance.status} · {fmt(order.acceptance.acceptedAt)} · {order.acceptance.customerSignatory ?? ""}{order.acceptance.punchList ? ` · ${order.acceptance.punchList}` : ""}</p>
          </Card>}

          {(order.taxInvoices.length > 0 || order.invoices.length > 0) && <Card title="TITH / IVTH">
            {order.taxInvoices.map((ti) => <p key={ti.id} className="text-sm"><span className="font-mono">{ti.no}</span> · {fmt(ti.issuedAt)} · {ti.currency} {Number(ti.total).toFixed(2)} (VAT {Number(ti.vatAmount).toFixed(2)}) · CNY {Number(ti.totalCny).toFixed(2)}</p>)}
            {order.invoices.map((iv) => <p key={iv.id} className="text-sm"><span className="font-mono">{iv.no}</span> · due {fmt(iv.dueAt)} · {iv.currency} {Number(iv.amountDue).toFixed(2)} · paid {Number(iv.paidAmount ?? 0).toFixed(2)}{iv.whtAmount ? ` + WHT ${Number(iv.whtAmount).toFixed(2)}` : ""}{iv.paidAt ? ` on ${fmt(iv.paidAt)}` : ""}</p>)}
          </Card>}

          <Card title={t("doc")}>
            <ul className="text-sm">{order.documents.map((d) => <li key={d.id} className="flex gap-2"><span className="font-mono">{d.no}</span><span className="text-slate-500">{d.type}{d.templateCode ? ` · tpl ${d.templateCode}` : ""} · {fmt(d.issuedAt)}</span>{d.pdfUrl && <a className="text-blue underline" href={d.pdfUrl}>PDF</a>}<a className="ml-auto text-blue underline" href={`/api/documents/${d.no}/render`}>DOCX</a></li>)}</ul>
          </Card>
        </div>

        {/* ── action panel: what to do next ── */}
        <div className="space-y-4">
          {(order.status === "RECEIVED" || order.status === "ASSIGNED") && <Card title={ts("ASSIGNED")}>
            <form action={advance} className="space-y-2"><input type="hidden" name="to" value="ASSIGNED" /><select name="note" className={input}>{employees.map((e) => <option key={e.id} value={`派工 → ${e.name} (${e.code})`}>{e.code} {e.name}</option>)}</select><button className="rounded bg-navy px-3 py-1.5 text-sm text-white">OK</button></form>
          </Card>}

          {(order.status === "ASSIGNED" || order.status === "DIAGNOSING") && <Card title="INTH · 08">
            <form action={inspect} className="space-y-2">
              <select name="assetCode" className={input}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code}</option>)}</select>
              <textarea name="conditions" placeholder="Inspection conditions" className={input} rows={2} />
              <textarea name="findings" placeholder="Findings" className={input} rows={3} required />
              <input name="probableCause" placeholder="Probable cause" className={input} />
              <textarea name="recommendation" placeholder="Proposed repair" className={input} rows={2} />
              {["Visual condition", "Power supply", "Fault history", "Functional check"].map((x) => <div key={x} className="grid grid-cols-3 gap-1 text-xs"><span className="self-center">{x}</span><input name={`c_${x}`} placeholder="criterion" className={input} /><input name={`r_${x}`} placeholder="result" className={input} /></div>)}
              <input name="instruments" placeholder="Instrument ID / calibration" className={input} />
              <input name="conclusion" placeholder="Conclusion / limitations" className={input} />
              <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("save")}</button>
            </form>
          </Card>}

          {order.status === "DIAGNOSING" && <Card title="QTTH lines">
            <form action={quote} className="space-y-1">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <div key={i} className="grid grid-cols-6 gap-1 text-xs"><input name={`a${i}`} placeholder="ATH" defaultValue={i === 0 ? primaryAsset?.code : ""} className={input} /><input name={`d${i}`} placeholder="Description (EN)" className={`${input} col-span-2`} /><input name={`l${i}`} placeholder="รายการ (TH)" className={input} /><input name={`q${i}`} type="number" step="0.001" placeholder="qty" className={input} /><input name={`p${i}`} type="number" step="0.01" placeholder="price" className={input} /></div>)}
              <p className="text-xs text-slate-500">VAT 7% added automatically; CNY at today's BoC rate. Thai description is required for the tax invoice.</p>
              <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("save")} → {ts("QUOTE_PENDING")}</button>
            </form>
            {order.kind === "CONTRACT" && <form action={advance} className="mt-2"><input type="hidden" name="to" value="IN_PROGRESS" /><input type="hidden" name="note" value="合同内服务，直接执行" /><button className="rounded border px-3 py-1.5 text-sm">{t("CONTRACT")} → {ts("IN_PROGRESS")}</button></form>}
          </Card>}

          {order.status === "QUOTE_PENDING" && <Card title={ts("QUOTE_PENDING")}>
            <form action={advance} className="space-y-2"><input type="hidden" name="to" value="IN_PROGRESS" /><input name="note" placeholder="Customer confirmation (PO no. / email)" className={input} /><button className="rounded bg-navy px-3 py-1.5 text-sm text-white">Confirmed → {ts("IN_PROGRESS")}</button></form>
          </Card>}

          {order.status === "IN_PROGRESS" && <Card title="RPTH / PMTH · 09 / 10 / 11">
            <form action={repair} className="space-y-2">
              <select name="assetCode" className={input}>{order.assets.map((l) => <option key={l.assetId} value={l.asset.code}>{l.asset.code}</option>)}</select>
              <div className="grid grid-cols-2 gap-1"><select name="kind" className={input}>{["REPAIR", "MAINTENANCE", "OVERHAUL", "FIELD_SERVICE"].map((k) => <option key={k} value={k}>{k}</option>)}</select><select name="location" className={input}><option value="SITE">SITE</option><option value="WORKSHOP">WORKSHOP</option></select></div>
              <input name="confirmedFault" placeholder="Confirmed fault" className={input} />
              <input name="rootCause" placeholder="Root cause" className={input} />
              <textarea name="workPerformed" placeholder="Work performed" className={input} rows={3} required />
              <input name="configBackupRef" placeholder="Parameter backup ref" className={input} />
              <input name="laborHours" type="number" step="0.5" placeholder="Labor hours" className={input} />
              {["Visual inspection", "Approved electrical tests", "No load operation", "Load test if agreed"].map((x) => <div key={x} className="grid grid-cols-4 gap-1 text-xs"><span className="self-center">{x}</span><input name={`c_${x}`} placeholder="criterion" className={input} /><input name={`r_${x}`} placeholder="result" className={input} /><label className="self-center"><input type="checkbox" name={`p_${x}`} defaultChecked /> pass</label></div>)}
              <label className="block text-sm"><input type="checkbox" name="finished" /> Finished → {ts("ACCEPTANCE_PENDING")}</label>
              <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("save")}</button>
            </form>
          </Card>}

          {order.status === "ACCEPTANCE_PENDING" && <Card title="13 Customer Acceptance">
            <form action={accept} className="space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="grid grid-cols-3 gap-1 text-xs"><input name={`dv${i}`} placeholder="Deliverable" className={input} /><input name={`cr${i}`} placeholder="Criterion" className={input} /><input name={`rs${i}`} placeholder="Result" className={input} /></div>)}
              <select name="status" className={input}><option value="ACCEPTED">ACCEPTED</option><option value="CONDITIONAL">CONDITIONAL</option><option value="REJECTED">REJECTED</option></select>
              <input name="punchList" placeholder="Outstanding items and owner" className={input} />
              <div className="grid grid-cols-2 gap-1"><input name="warrantyStart" type="date" className={input} /><input name="warrantyTerms" placeholder="Warranty terms" className={input} /></div>
              <input name="customerSignatory" placeholder="Customer representative" className={input} />
              <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("save")}</button>
            </form>
          </Card>}

          {order.status === "ACCEPTED" && <Card title="TITH + IVTH">
            <form action={invoice}><p className="mb-2 text-xs text-slate-500">Issues the Thai tax invoice from the quote lines (THB, Thai text, VAT separate) and the Invoice with the customer's payment term.</p><button className="rounded bg-navy px-3 py-1.5 text-sm text-white">Issue</button></form>
          </Card>}

          {order.status === "INVOICED" && order.invoices.some((i) => !i.paidAt) && <Card title="Payment">
            <form action={pay} className="space-y-2">
              <select name="invoiceNo" className={input}>{order.invoices.filter((i) => !i.paidAt).map((i) => <option key={i.id} value={i.no}>{i.no} · {Number(i.amountDue).toFixed(2)}</option>)}</select>
              <input name="paidAt" type="date" className={input} required />
              <input name="paidAmount" type="number" step="0.01" placeholder="Cash received" className={input} required />
              <input name="whtAmount" type="number" step="0.01" placeholder="WHT withheld by customer" className={input} />
              <input name="whtCertRef" placeholder="WHT certificate ref" className={input} />
              <input name="bankRef" placeholder="Bank ref" className={input} />
              <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("save")}</button>
            </form>
          </Card>}

          {next.length > 0 && <Card title={t("status")}>
            <form action={advance} className="flex flex-wrap gap-1">
              {next.map((s) => <button key={s} name="to" value={s} className={`rounded border px-2 py-1 text-xs ${s === "CANCELLED" ? "text-rose-700" : ""}`}>{ts(s)}</button>)}
            </form>
          </Card>}
        </div>
      </div>
    </div>
  );
}

function str(form: FormData, k: string): string | undefined {
  const v = form.get(k);
  return v == null || String(v).trim() === "" ? undefined : String(v);
}
