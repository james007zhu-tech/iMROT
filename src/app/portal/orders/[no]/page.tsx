import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentContact } from "@/server/auth";
import { OrderProgress } from "@/components/OrderProgress";
import { recordAcceptance } from "@/server/slm-docs";
import type { OrderStatus } from "@/lib/lifecycle";

export const dynamic = "force-dynamic";

/** Progress, documents, and — when the work is done — the acceptance signature. Nothing internal is shown. */
export default async function PortalOrder({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  const me = await currentContact();
  const order = await prisma.serviceOrder.findFirst({ where: { no, customerId: me.customerId }, include: { assets: { include: { asset: true } }, lines: true, documents: { where: { type: { in: ["QT", "IN", "RP", "PM", "TI", "IV"] } } }, acceptance: true, repairJobs: true } });
  if (!order) notFound();
  const t = await getTranslations("common");
  const locale = await getLocale();
  const fmt = (d: Date | null | undefined) => (d ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d) : "—");
  const input = "w-full rounded border px-3 py-3 text-base";

  async function confirmQuote() {
    "use server";
    const me = await currentContact();
    const o = await prisma.serviceOrder.findFirstOrThrow({ where: { no, customerId: me.customerId } });
    if (o.status !== "QUOTE_PENDING") return;
    const desk = await prisma.employee.findFirstOrThrow({ where: { entityId: o.entityId, active: true }, orderBy: { code: "asc" } });
    const { advanceServiceOrder } = await import("@/server/slm");
    await advanceServiceOrder(no, "IN_PROGRESS", desk.code, `客户 ${me.name} 在门户确认报价`);
    redirect(`/portal/orders/${no}`);
  }
  async function sign(form: FormData) {
    "use server";
    const me = await currentContact();
    const o = await prisma.serviceOrder.findFirstOrThrow({ where: { no, customerId: me.customerId }, include: { repairJobs: true } });
    if (o.status !== "ACCEPTANCE_PENDING") return;
    const desk = await prisma.employee.findFirstOrThrow({ where: { entityId: o.entityId, active: true }, orderBy: { code: "asc" } });
    const tests = (o.repairJobs.at(-1)?.tests as { test: string; criterion?: string; result?: string }[] | null) ?? [];
    await recordAcceptance({ serviceOrderNo: no, actorCode: desk.code, deliverables: tests.length ? tests.map((x) => ({ deliverable: x.test, criterion: x.criterion, result: x.result })) : [{ deliverable: "Service completed", result: "OK" }], status: form.get("status") as "ACCEPTED", punchList: String(form.get("punchList") || "") || undefined, customerContactId: me.id, customerSignatory: me.name });
    redirect(`/portal/orders/${no}`);
  }

  return (
    <div className="space-y-4">
      <div><div className="font-mono text-xl font-bold">{order.no}</div><div className="text-sm text-slate-600">{order.assets.map((a) => `${a.asset.code} · ${a.asset.location ?? ""}`).join(" / ")} · {fmt(order.reportedAt)}</div></div>
      <OrderProgress status={order.status as OrderStatus} />
      {order.reportedSymptom && <p className="rounded-lg border bg-white p-3 text-sm">{order.reportedSymptom}</p>}

      {order.status === "QUOTE_PENDING" && order.lines.length > 0 && (
        <section className="rounded-lg border bg-white p-3">
          <h2 className="mb-2 font-bold text-navy">QTTH</h2>
          <ul className="text-sm">{order.lines.map((l) => <li key={l.id} className="flex justify-between border-b py-1"><span>{l.descriptionLocal ?? l.description} ×{Number(l.qty)}</span><span>{Number(l.amount).toFixed(2)}</span></li>)}</ul>
          <div className="mt-2 flex justify-between font-bold"><span>{t("total")} (incl. VAT)</span><span>{order.currency} {Number(order.total).toFixed(2)}</span></div>
          <form action={confirmQuote} className="mt-3"><button className="w-full rounded bg-blue py-3 font-bold text-white">Confirm quotation</button></form>
        </section>
      )}

      {order.status === "ACCEPTANCE_PENDING" && !order.acceptance && (
        <form action={sign} className="space-y-2 rounded-lg border bg-white p-3">
          <h2 className="font-bold text-navy">13 Customer Acceptance</h2>
          <select name="status" className={input}><option value="ACCEPTED">Accepted</option><option value="CONDITIONAL">Accepted with conditions</option><option value="REJECTED">Not accepted</option></select>
          <input name="punchList" placeholder="Outstanding items (if any)" className={input} />
          <p className="text-xs text-slate-500">Signed as {me.name}, {me.customer.name}</p>
          <button className="w-full rounded bg-blue py-3 font-bold text-white">Sign</button>
        </form>
      )}

      <section className="rounded-lg border bg-white p-3">
        <h2 className="mb-2 font-bold text-navy">{t("doc")}</h2>
        <ul className="text-sm">{order.documents.map((d) => <li key={d.id} className="flex justify-between border-b py-2"><span><span className="font-mono">{d.no}</span> · {fmt(d.issuedAt)}</span>{d.pdfUrl ? <a className="text-blue underline" href={d.pdfUrl}>PDF</a> : <a className="text-blue underline" href={`/api/documents/${d.no}/render`}>DOCX</a>}</li>)}{order.documents.length === 0 && <li className="text-slate-500">{t("none")}</li>}</ul>
      </section>
    </div>
  );
}
