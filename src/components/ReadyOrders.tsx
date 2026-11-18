import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { DOC_PLACES } from "@/lib/doc-center";
import { Card } from "@/components/ui";
import { currentEmployee } from "@/server/auth";
import { docTypeAllowed, orderScope } from "@/server/scope";
import { can } from "@/lib/caps";
import { noInvoiceAction } from "@/app/actions/no-invoice";

/** The step on an order that creates a document of this type (验收 has no number of its own). */
export function newStep(type: string) {
  return type === "AC" ? { path: "accept", statuses: ["ACCEPTANCE_PENDING", "IN_PROGRESS"], modes: undefined as string[] | undefined } : DOC_PLACES[type]?.step;
}

/**
 * "+ 新建" on every list page creates that document (朱总 2026-11-10). A document with a form of its own opens it;
 * one that belongs to an order (ERTH, DNTH, INTH, IVTH …) cannot exist without the order, so the button opens this
 * panel on the same page: the orders that have reached the step — one tap opens the form.
 */
export async function ReadyOrders({ type, title }: { type: string; title: string }) {
  const step = newStep(type);
  if (!step) return null;
  const [d, ts] = await Promise.all([getTranslations("docs"), getTranslations("orderStatus")]);
  const me = await currentEmployee();
  const money = ["TI", "IV", "RC"].includes(type);
  if ((money && !can.invoice(me)) || !docTypeAllowed(me, type)) return null; // 开票、收款的候选只给 FIN 和 MD
  // 开票候选 (需求清单 v4 V4-P0-06): accepted, not yet invoiced, worth more than zero — or a refused quote with a fee to bill
  const billable: Prisma.ServiceOrderWhereInput = type === "TI" || type === "IV" ? { noInvoiceAt: null, OR: [{ status: "ACCEPTED", total: { gt: 0 }, acceptance: { is: { status: "ACCEPTED" } } }, { status: "DECLINED", decline: { isNot: null } }] } : {}; // a real acceptance record (派修单 v3 第 2 条)
  const ready = (await prisma.serviceOrder.findMany({ where: { AND: [await orderScope(me), billable, { status: { in: step.statuses as never }, ...(step.modes ? { mode: { in: step.modes as never } } : {}) }] }, orderBy: { reportedAt: "desc" }, take: 40, select: { no: true, status: true, customer: { select: { name: true } }, reportedSymptom: true, project: true, currency: true, total: true, acceptance: { select: { acceptedAt: true, customerSignatory: true, signatureUrl: true } }, decline: { select: { fees: true } } } }))
    .filter((o) => o.status !== "DECLINED" || ((o.decline?.fees as { amount?: number }[] | null) ?? []).some((f) => Number(f.amount) > 0)); // a refused quote with nothing to bill is not a candidate
  // 被排除的单子要写明原因: accepted by status, but not a candidate
  const out = type === "TI" || type === "IV" ? await prisma.serviceOrder.findMany({ where: { AND: [await orderScope(me), { status: "ACCEPTED", OR: [{ noInvoiceAt: { not: null } }, { total: { lte: 0 } }, { total: null }, { acceptance: { is: null } }, { acceptance: { isNot: { status: "ACCEPTED" } } }] }] }, orderBy: { reportedAt: "desc" }, take: 40, select: { no: true, total: true, noInvoiceAt: true, noInvoiceBy: true, noInvoiceReason: true, acceptance: { select: { status: true } } } }) : [];
  const back = type === "IV" ? "/tax?doc=iv&new=1" : "/tax?doc=ti&new=1";
  const pick = type === "TI" || type === "IV";
  return (
    <Card title={d("pickOrder", { name: title })} accent>
      {ready.length === 0 ? <p className="text-sm text-navy/70">{d("noReady")}</p> : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ready.map((o) => { const ev = o.acceptance, has = !!ev?.signatureUrl; return <div key={o.no} className="rounded-lg border border-hair bg-white px-3 py-2 text-sm hover:border-blue">
            <Link href={`/service-orders/${o.no}/${step.path}`} className="block"><span className="font-mono text-blue">{o.no}</span> <span className="text-navy">{o.customer.name}</span>
              <span className="block truncate text-xs text-navy/60">{ts(o.status)}{o.reportedSymptom ? ` · ${o.reportedSymptom}` : ""}</span></Link>
            {pick && ev?.acceptedAt && <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-navy"><span>{d("evidence")}：</span><Link href={`/service-orders/${o.no}/accept`} className="text-blue hover:underline">{d("acceptedBy", { date: ev.acceptedAt.toISOString().slice(0, 10), who: ev.customerSignatory ?? "—" })}</Link><span className={has ? "" : "text-alert-ink"}>{has ? d("evidenceFile") : d("evidenceNoFile")}</span><b className="ml-auto tabular-nums">{o.currency} {Number(o.total).toFixed(2)}</b></div>}
            {pick && <details className="mt-1"><summary className="cursor-pointer text-xs text-navy/60 hover:text-navy">{d("noInvoice")}</summary>
              <form action={noInvoiceAction.bind(null, back)} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="no" value={o.no} /><select name="why" required defaultValue="" className="rounded-md border px-2 py-1 text-xs"><option value="" disabled>{d("noInvoiceWhy")}</option>{(["test", "elsewhere", "free", "other"] as const).map((k) => <option key={k} value={d(`noInvoice_${k}`)}>{d(`noInvoice_${k}`)}</option>)}</select><input name="more" placeholder={d("noInvoiceMore")} className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs" /><button className="rounded-md border border-navy/40 px-2 py-1 text-xs">{d("noInvoice")}</button></form></details>}
          </div>; })}
        </div>
      )}
      {out.length > 0 && <div className="mt-3 border-t border-hair pt-2 text-xs text-navy/70"><div className="font-semibold">{d("notCandidates")}</div><ul className="mt-1 space-y-0.5">{out.map((o) => <li key={o.no}><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link> — {o.noInvoiceAt ? <>{d("noInvoice")}：{o.noInvoiceReason} · {o.noInvoiceBy} · {o.noInvoiceAt.toISOString().slice(0, 10)} <form action={noInvoiceAction.bind(null, back)} className="inline"><input type="hidden" name="no" value={o.no} /><input type="hidden" name="undo" value="1" /><button className="text-blue hover:underline">{d("noInvoiceUndo")}</button></form></> : o.acceptance?.status !== "ACCEPTED" ? <span className="text-alert-ink">{d("outNoAcceptance")}</span> : d("outZero")}</li>)}</ul></div>}
    </Card>
  );
}
