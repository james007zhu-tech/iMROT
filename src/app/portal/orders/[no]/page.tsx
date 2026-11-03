import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentContact } from "@/server/auth";
import { OrderProgress } from "@/components/OrderProgress";
import { UploadRecognize } from "@/components/UploadRecognize";
import { AssetTriple, FaultText } from "@/components/ui";
import { recordAcceptance } from "@/server/slm-docs";
import { confirmCustomerPo, poLinesFromQuote } from "@/server/slm";
import { reportsFor } from "@/lib/order-steps";
import type { OrderStatus } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/** Progress, quote confirmation with PO, acceptance signature, and every report of this service (wireframe 13). */
export default async function PortalOrder({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const me = await currentContact();
  const order = await prisma.serviceOrder.findFirst({
    where: { no, customerId: me.customerId },
    include: { assets: { include: { asset: { include: { model: { include: { series: { include: { brand: true } } } } } } } }, lines: { orderBy: { lineNo: "asc" } }, documents: { where: { voidedAt: null, type: { in: ["QT", "IN", "RP", "PM", "ER", "DN"] } }, orderBy: { issuedAt: "asc" } }, acceptance: true, repairJobs: true },
  });
  if (!order) notFound();
  const [t, u, locale] = await Promise.all([getTranslations("common"), getTranslations("ui"), getLocale()]);
  const day = (d: Date) => new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }).format(d);
  const input = "w-full rounded-md border px-3 py-3 text-base";

  async function confirmQuote(form: FormData) {
    "use server";
    const me = await currentContact();
    const o = await prisma.serviceOrder.findFirstOrThrow({ where: { no, customerId: me.customerId } });
    if (o.status !== "QUOTE_PENDING") redirect(`/portal/orders/${no}`);
    const desk = await prisma.employee.findFirstOrThrow({ where: { entityId: o.entityId, active: true, role: { in: ["MD", "ADMIN", "MANAGER"] } }, orderBy: { code: "asc" } });
    let attachments: { name: string; url: string; kind: string }[] = [];
    try { attachments = JSON.parse(String(form.get("attachments") || "[]")); } catch { /* none */ }
    await confirmCustomerPo({ no, actorCode: desk.code, customerRef: String(form.get("customerRef") || "") || undefined, poLines: await poLinesFromQuote(no), attachments: attachments.map((a) => ({ ...a, kind: "PO" })), note: `portal · ${me.name}` });
    redirect(`/portal/orders/${no}`);
  }
  async function sign(form: FormData) {
    "use server";
    const me = await currentContact();
    const o = await prisma.serviceOrder.findFirstOrThrow({ where: { no, customerId: me.customerId }, include: { repairJobs: true } });
    if (o.status !== "ACCEPTANCE_PENDING") redirect(`/portal/orders/${no}`);
    const desk = await prisma.employee.findFirstOrThrow({ where: { entityId: o.entityId, active: true, role: { in: ["MD", "ADMIN", "MANAGER"] } }, orderBy: { code: "asc" } });
    const tests = (o.repairJobs.at(-1)?.tests as { test: string; criterion?: string; result?: string }[] | null) ?? [];
    let attachments: { url: string }[] = [];
    try { attachments = JSON.parse(String(form.get("attachments") || "[]")); } catch { /* none */ }
    await recordAcceptance({ serviceOrderNo: no, actorCode: desk.code, deliverables: tests.length ? tests.map((x) => ({ deliverable: x.test, criterion: x.criterion, result: x.result })) : [{ deliverable: "Service completed", result: "OK" }], status: form.get("status") as "ACCEPTED", punchList: String(form.get("punchList") || "") || undefined, customerContactId: me.id, customerSignatory: me.name, signatureUrl: attachments[0]?.url });
    redirect(`/portal/orders/${no}`);
  }

  const tests = (order.repairJobs.at(-1)?.tests as { test: string; result?: string; pass?: boolean }[] | null) ?? [];
  const rows = order.documents.flatMap((d) => reportsFor(d, !!order.acceptance).map((r) => ({ d, r })));
  const pendingAcceptance = !order.acceptance && order.status !== "CANCELLED";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2"><Link href="/portal" className="inline-flex min-h-11 items-center rounded-lg border border-navy/45 bg-white px-3">←</Link><span className="font-mono text-xl font-bold">{order.no}</span></div>
      <OrderProgress status={order.status as OrderStatus} />
      <section className="space-y-2 rounded-xl border bg-white p-4 text-sm">
        {order.assets.map((a) => <AssetTriple key={a.assetId} asset={a.asset} link={false} />)}
        {order.reportedSymptom && <p><FaultText>{order.reportedSymptom}{order.reportedAlarm ? ` · ${order.reportedAlarm}` : ""}</FaultText> <span className="text-navy/70">· {day(order.reportedAt)}</span></p>}
      </section>

      {order.status === "QUOTE_PENDING" && order.lines.length > 0 && (
        <section className="space-y-3 rounded-xl border border-blue bg-white p-4">
          <h2 className="font-bold text-navy">{u("rpt04")}</h2>
          <ul className="text-sm">{order.lines.map((l) => <li key={l.id} className="flex justify-between border-b border-hair py-1"><span>{l.descriptionLocal ?? l.description} ×{Number(l.qty)}</span><span>{Number(l.amount).toFixed(2)}</span></li>)}</ul>
          <div className="flex justify-between font-bold"><span>{t("total")} ({u("inclVat")})</span><span>{order.currency} {Number(order.total).toFixed(2)}</span></div>
          <UploadRecognize kind="service" formId="po" title={u("upPoTitle")} hint={u("upPoHint")} />
          <form id="po" action={confirmQuote} className="space-y-2">
            <input name="customerRef" placeholder={u("customerRefVerbatim")} className={input} />
            <button className="w-full rounded-lg bg-blue py-3 font-bold text-white">{t("confirmQuote")}</button>
          </form>
        </section>
      )}

      {order.status === "ACCEPTANCE_PENDING" && !order.acceptance && (
        <section className="space-y-2 rounded-xl border border-blue bg-white p-4">
          <h2 className="font-bold text-navy">{u("pleaseAccept")}</h2>
          {tests.length > 0 && <ul className="text-sm">{tests.map((x, i) => <li key={i} className="flex justify-between border-b border-hair py-1"><span>{x.test}{x.result ? ` · ${x.result}` : ""}</span><span>{x.pass === false ? "✗" : "✓"}</span></li>)}</ul>}
          <UploadRecognize kind="acceptance" formId="acc" title={u("portalSignTitle")} hint={u("portalSignHint")} />
          <form id="acc" action={sign} className="space-y-2">
            <select name="status" className={input}><option value="ACCEPTED">{t("accepted")}</option><option value="CONDITIONAL">{t("conditional")}</option><option value="REJECTED">{t("rejected")}</option></select>
            <input name="punchList" placeholder={t("punchListOpt")} className={input} />
            <p className="text-xs text-navy/70">{t("signedAs")} {me.name}, {me.customer.name}</p>
            <button className="w-full rounded-lg bg-blue py-3 font-bold text-white">{t("sign")}</button>
          </form>
        </section>
      )}

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-bold text-navy">{u("allReportsOfService")}</h2>
        <table className="w-full text-sm">
          <tbody>
            {rows.map(({ d, r }) => (
              <tr key={`${d.no}${r.key}`} className="border-b border-hair">
                <td className="py-2 pr-2 align-top text-navy/70">{day(d.issuedAt)}</td>
                <td className="py-2"><span className="font-mono">{d.no}</span><span className="block text-xs text-navy/75">{u(r.key)}</span></td>
                <td className="py-2 text-right"><a className="text-blue underline" href={`/api/documents/${d.no}/render?format=pdf${r.template ? `&template=${r.template}` : ""}`}>PDF</a></td>
              </tr>
            ))}
            {pendingAcceptance && <tr className="text-navy/50"><td className="py-2 pr-2">{u("pending")}</td><td className="py-2">{u("rpt12")} / {u("rpt13")}</td><td className="py-2 text-right">—</td></tr>}
          </tbody>
        </table>
        {rows.length > 0 && <a href={`/api/portal/orders/${order.no}/zip`} className="mt-3 block rounded-lg border border-navy/45 py-3 text-center font-semibold">{u("downloadAllZip")}</a>}
      </section>
    </div>
  );
}
