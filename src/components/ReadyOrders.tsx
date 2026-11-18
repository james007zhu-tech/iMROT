import { acceptEvidence, invoiceBar } from "@/server/slm-docs";
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
  // 开票候选 — one rule for the bell, this list and the 排除 list (财神爷 2026-11-18): an accepted order worth more than
  // zero, not marked 不开票, with acceptance evidence of its kind (贸易: the delivery note the customer signed; 维修等:
  // the signed acceptance sheet or the customer's confirmation in the portal) — or a refused quote with a fee to bill.
  // Everything else that is accepted stands under 排除 with its reason; one that only lacks the evidence has 上传签字单.
  const taxy = type === "TI" || type === "IV";
  const sel = { id: true, no: true, mode: true, acceptSheet: true, status: true, customer: { select: { name: true } }, reportedSymptom: true, project: true, currency: true, total: true, noInvoiceAt: true, noInvoiceBy: true, noInvoiceReason: true, decline: { select: { fees: true } } } as const;
  const pool = await prisma.serviceOrder.findMany({ where: { AND: [await orderScope(me), taxy ? { OR: [{ status: "ACCEPTED" }, { status: "DECLINED", decline: { isNot: null }, noInvoiceAt: null }] } : {}, { status: { in: step.statuses as never }, ...(step.modes ? { mode: { in: step.modes as never } } : {}) }] }, orderBy: { reportedAt: "desc" }, take: 80, select: sel });
  const evs = new Map<string, Awaited<ReturnType<typeof acceptEvidence>>>();
  const why = new Map<string, string>();
  if (taxy) for (const o of pool) { if (o.status === "DECLINED") { if (!((o.decline?.fees as { amount?: number }[] | null) ?? []).some((f) => Number(f.amount) > 0)) why.set(o.no, "SKIP"); continue; } const ev = await acceptEvidence(o); evs.set(o.no, ev); const w = invoiceBar(o, ev); if (w) why.set(o.no, w); }
  const ready = pool.filter((o) => !why.has(o.no)), out = pool.filter((o) => why.has(o.no) && why.get(o.no) !== "SKIP");
  const back = type === "IV" ? "/tax?doc=iv&new=1" : "/tax?doc=ti&new=1";
  const pick = type === "TI" || type === "IV";
  return (
    <Card title={d("pickOrder", { name: title })} accent>
      {ready.length === 0 ? <p className="text-sm text-navy/70">{d("noReady")}</p> : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ready.map((o) => { const ev = evs.get(o.no), lacks = false; const head = <><span className={`font-mono ${lacks ? "text-navy" : "text-blue"}`}>{o.no}</span> <span className="text-navy">{o.customer.name}</span>
              <span className="block truncate text-xs text-navy/60">{ts(o.status)}{o.reportedSymptom ? ` · ${o.reportedSymptom}` : ""}</span></>; return <div key={o.no} className={`rounded-lg border bg-white px-3 py-2 text-sm ${lacks ? "border-[#C0392B]" : "border-hair hover:border-blue"}`}>
            {lacks ? <div>{head}</div> : <Link href={`/service-orders/${o.no}/${step.path}`} className="block">{head}</Link>}
            {pick && ev && <div className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-navy"><span>{d("evidence")}：</span>{ev.kind === "DN"
              ? <Link href={ev.href} className="text-blue hover:underline">{d("evidenceDn", { no: ev.no, date: ev.at ? ev.at.toISOString().slice(0, 10) : "", who: ev.by ?? "—" })}</Link>
              : ev.kind === "PORTAL" ? <Link href={ev.href} className="text-blue hover:underline">{d("evidencePortal", { date: ev.at.slice(0, 10), who: ev.name })}</Link>
              : <a href={ev.href} target="_blank" className="text-blue hover:underline">{d("evidenceSheet", { date: ev.at.slice(0, 10), n: ev.orders.length })}</a>}<b className="ml-auto tabular-nums">{o.currency} {Number(o.total).toFixed(2)}</b></div>}
            {lacks && <div className="mt-1 text-xs font-semibold text-[#C0392B]">{d("evidenceMissing")} <Link href={`/service-orders/${o.no}/accept`} className="underline">{d("evidenceGo")}</Link></div>}
            {pick && <details className="mt-1"><summary className="cursor-pointer text-xs text-navy/60 hover:text-navy">{d("noInvoice")}</summary>
              <form action={noInvoiceAction.bind(null, back)} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="no" value={o.no} /><select name="why" required defaultValue="" className="rounded-md border px-2 py-1 text-xs"><option value="" disabled>{d("noInvoiceWhy")}</option>{(["test", "elsewhere", "free", "other"] as const).map((k) => <option key={k} value={d(`noInvoice_${k}`)}>{d(`noInvoice_${k}`)}</option>)}</select><input name="more" placeholder={d("noInvoiceMore")} className="min-w-0 flex-1 rounded-md border px-2 py-1 text-xs" /><button className="rounded-md border border-navy/40 px-2 py-1 text-xs">{d("noInvoice")}</button></form></details>}
          </div>; })}
        </div>
      )}
      {out.length > 0 && <div className="mt-3 border-t border-hair pt-2 text-xs text-navy/70"><div className="font-semibold">{d("notCandidates")}</div><ul className="mt-1 space-y-1">{out.map((o) => <li key={o.no}><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link> <span className="text-navy/60">{o.customer.name}</span> — {why.get(o.no) === "NO_INVOICE" ? <>{d("noInvoice")}：{o.noInvoiceReason} · {o.noInvoiceBy} · {o.noInvoiceAt!.toISOString().slice(0, 10)} <form action={noInvoiceAction.bind(null, back)} className="inline"><input type="hidden" name="no" value={o.no} /><input type="hidden" name="undo" value="1" /><button className="text-blue underline">{d("noInvoiceUndo")}</button></form></>
        : why.get(o.no) === "ZERO" ? d("outZero")
        : o.mode === "DOMESTIC_TRADE" || o.mode === "INTERNATIONAL_TRADE" ? <span className="font-semibold text-[#C0392B]">{d("outNoDn")}</span>
        : <><span className="font-semibold text-[#C0392B]">{d("outNoSheet")}</span> <Link href={`/service-orders/${o.no}/accept`} className="ml-1 inline-block rounded-md border border-navy/40 bg-white px-2 py-0.5 font-semibold text-navy">{d("uploadSheet")}</Link></>}</li>)}</ul></div>}
    </Card>
  );
}
