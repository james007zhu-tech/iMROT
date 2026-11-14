import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { expensesFor } from "@/server/expense";
import { dictMap } from "@/server/dict";
import { Flash } from "@/components/Flash";
import { PageHeader, Tag, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { cancelAction, decideAction, payAction } from "./actions";

export const dynamic = "force-dynamic";
const STATUSES = ["PENDING", "APPROVED", "PAID", "REJECTED"] as const;

/** 费用报销: one's own claims; a manager also sees and decides their people's; the MD and finance see all and pay. */
export default async function Expenses({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; status?: string }> }) {
  const { ok, error, status } = await searchParams;
  const [t, me, locale] = await Promise.all([getTranslations("ops"), currentEmployee(), getLocale()]);
  const st = STATUSES.includes(status as never) ? status : undefined;
  const [{ rows, seeAll }, cats] = await Promise.all([expensesFor(me.code, { status: st }), dictMap("expenseCategory", locale)]);
  const money = (n: unknown, cur = "THB") => `${cur} ${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const waiting = rows.filter((r) => r.canDecide).length;
  const openSum = rows.filter((r) => r.status === "APPROVED").reduce((s, r) => s + Number(r.amount), 0);
  return (
    <div className="space-y-4">
      <PageHeader title={t("expTitle")} badge={<>{waiting > 0 && <Tag hot>{t("expWaiting", { n: waiting })}</Tag>}{openSum > 0 && <Tag>{t("expToPay", { amount: money(openSum) })}</Tag>}</>} newHref="/finance/expenses/new" newLabel={t("expNew")} />
      <Flash ok={ok} error={error} />
      <div className="flex flex-wrap gap-1.5 text-sm">
        <Link href="/finance/expenses" className={`rounded-full border px-3 py-1 ${!st ? "border-navy bg-navy text-white" : "border-navy/30 bg-white"}`}>{t("all")}</Link>
        {STATUSES.map((s) => <Link key={s} href={`/finance/expenses?status=${s}`} className={`rounded-full border px-3 py-1 ${st === s ? "border-navy bg-navy text-white" : "border-navy/30 bg-white"}`}>{t(`exp_${s}`)}</Link>)}
      </div>
      <ul className="space-y-2">
        {rows.map((r) => {
          const files = (r.receipts as { name: string; url: string }[] | null) ?? [];
          return (
            <li key={r.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {r.no && <span className="font-mono font-semibold text-navy">{r.no}</span>}
                <span className="font-mono text-navy/70">{localIso(r.spentOn)!.slice(0, 10)}</span>
                <span className="font-semibold text-navy">{cats.get(r.category) ?? r.category}</span>
                <span className="min-w-0 flex-1 truncate">{r.description}</span>
                <span className="font-semibold tabular-nums">{money(r.amount, r.currency)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === "PENDING" ? "bg-[#FFF4E5] text-[#9A5B00]" : r.status === "REJECTED" || r.status === "CANCELLED" ? "bg-alert/10 text-alert-ink" : r.status === "PAID" ? "bg-navy text-white" : "bg-blue/12 text-navy"}`}>{t(`exp_${r.status}`)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-navy/70">
                {(seeAll || r.employeeId !== me.id) && <span>{r.employee.code} {r.employee.name}</span>}
                {r.vendor && <span>{r.vendor}</span>}
                {r.receiptNo && <span className="font-mono">{r.receiptNo}</span>}
                {r.vatAmount != null && <span>VAT {Number(r.vatAmount).toFixed(2)}</span>}
                <span>{t(`paidBy_${r.paidBy}`)}</span>
                {r.serviceOrderNo && <Link href={`/service-orders/${r.serviceOrderNo}`} className="font-mono text-blue hover:underline">{r.serviceOrderNo}</Link>}
                {files.map((a) => <a key={a.url} href={a.url} target="_blank" className="text-blue hover:underline">📄 {a.name}</a>)}
                {files.length === 0 && <span className="text-[#9A5B00]">{t("expNoReceipt")}</span>}
                {r.approver && <span>{t(r.status === "REJECTED" ? "expRejectedBy" : "expApprovedBy", { name: r.approver.name })}{r.decisionNote ? ` · ${r.decisionNote}` : ""}</span>}
                {r.paidRef && <span>{r.paidRef}</span>}
                {r.status === "APPROVED" && r.paidBy === "SELF" && <span>{t("expWithPayroll")}</span>}
              </div>
              {(r.canDecide || (r.status === "PENDING" && r.employeeId === me.id) || (r.status === "APPROVED" && seeAll)) && <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.canDecide && <form action={decideAction.bind(null, r.id)} className="flex flex-wrap items-center gap-2"><input name="note" placeholder={t("expNote")} className={`${inputCls} w-48`} /><button name="decision" value="APPROVED" className={btnPrimary}>{t("approve")}</button><button name="decision" value="REJECTED" className={btnGhost}>{t("reject")}</button></form>}
                {r.status === "PENDING" && r.employeeId === me.id && <form action={cancelAction.bind(null, r.id)}><button className={btnGhost}>{t("withdraw")}</button></form>}
                {r.status === "APPROVED" && seeAll && <form action={payAction.bind(null, r.id)} className="flex flex-wrap items-center gap-2"><input name="paidRef" placeholder={t("expPaidRef")} className={`${inputCls} w-48`} /><button className={btnGhost}>{t("expPayNow")}</button></form>}
              </div>}
            </li>
          );
        })}
        {rows.length === 0 && <li className="rounded-xl border bg-white p-6 text-center text-sm text-navy/60">{t("expEmpty")}</li>}
      </ul>
    </div>
  );
}
