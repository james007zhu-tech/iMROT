import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { buildCashPlan, ensureCashPlan, mayPlan, setOpeningBalance, thisMonth } from "@/server/cash-plan";
import { nextMonth, prevMonth, runningBalance, type CashLine, type CashTotals } from "@/lib/cash-plan";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { PageHeader, Card, Tag, btnGhost, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 现金计划: when, how much, to whom — and what comes in. Day by day, with the balance after each day when finance
 * has typed the bank balance of the 1st. `?v=first` shows the plan as it stood when the month began.
 */
export default async function CashPlanPage({ searchParams }: { searchParams: Promise<{ month?: string; v?: string; ok?: string; error?: string }> }) {
  const sp = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  if (!mayPlan(me)) notFound();
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : thisMonth();
  const current = month === thisMonth();
  if (current) await ensureCashPlan(me.entityId, month);
  const saved = await prisma.cashPlan.findUnique({ where: { entityId_month: { entityId: me.entityId, month } } });
  const asFirst = sp.v === "first" && !!saved;
  const live = await buildCashPlan(me.entityId, month);
  const lines = asFirst ? (saved!.lines as unknown as CashLine[]) : live.lines;
  const totals = asFirst ? (saved!.totals as unknown as CashTotals) : live.totals;
  const opening = saved?.openingBalance == null ? null : Number(saved.openingBalance);
  const days = runningBalance(lines, opening ?? 0);
  const lowest = opening == null || !days.length ? null : days.reduce((a, b) => (b.balance < a.balance ? b : a));
  const byDay = new Map<string, CashLine[]>();
  for (const l of lines) byDay.set(l.date, [...(byDay.get(l.date) ?? []), l]);

  async function setOpening(f: FormData) {
    "use server";
    await guarded(async () => {
      const who = await currentEmployee();
      if (!mayPlan(who)) throw new Error("FORBIDDEN");
      const v = String(f.get("opening") ?? "").replace(/,/g, "").trim();
      await setOpeningBalance(who.entityId, month, v === "" ? null : Number(v), who.id);
      return "saved";
    }, `/finance/cash-plan?month=${month}`);
  }
  const q = (m: string) => `/finance/cash-plan?month=${m}`;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance", label: t("nav_fin") }} title={u("cashPlan")} badge={<Tag>{month}</Tag>}
        actions={<><Link href={q(prevMonth(month))} className={btnGhost}>‹ {prevMonth(month)}</Link><Link href={q(nextMonth(month))} className={btnGhost}>{nextMonth(month)} ›</Link><Link href="/finance/cash-plan/fixed" className={btnGhost}>{u("cashFixed")}</Link><a href={`/api/cash-plan/${month}`} className={btnGhost}>⬇ CSV</a></>} />
      <Flash ok={sp.ok} error={sp.error} />
      {live.warnings.map((w) => <p key={w} className="rounded-lg border border-alert/50 bg-alert/10 px-3 py-2 text-sm text-navy">{u(`cashWarn_${w}`, { month: prevMonth(month) })} <Link href={`/people/payroll?month=${prevMonth(month)}`} className="text-blue">{u("cashGoPayroll")}</Link></p>)}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={u("cashOut")} value={money(totals.out)} hint={u("cashOfWhichFixed", { n: money(totals.fixedOut) })} />
        <Stat label={u("cashIn")} value={money(totals.in)} hint={totals.overdueIn ? u("cashOverdueIn", { n: money(totals.overdueIn) }) : undefined} />
        <Stat label={u("cashNet")} value={money(totals.net)} tone={totals.net < 0 ? "bad" : "good"} />
        <Stat label={u("cashLowest")} value={lowest ? money(lowest.balance) : "—"} hint={lowest ? lowest.date : u("cashNeedsOpening")} tone={lowest && lowest.balance < 0 ? "bad" : undefined} />
      </div>
      {totals.foreign.length > 0 && <p className="text-sm text-navy/70">{u("cashForeign")}: {totals.foreign.map((f) => `${f.currency} ${f.out ? `− ${money(f.out)}` : ""}${f.in ? ` + ${money(f.in)}` : ""}`).join(" · ")}</p>}

      <Card title={u("cashOpening")}>
        <form action={setOpening} className="flex flex-wrap items-end gap-2">
          <label className="text-sm text-navy/70">{u("cashOpeningLabel", { date: `${month}-01` })}<input name="opening" inputMode="decimal" defaultValue={opening ?? ""} placeholder="0.00" className={`${inputCls} mt-1 w-48`} /></label>
          <button className={btnGhost}>{t("save")}</button>
          <span className="text-xs text-navy/60">{u("cashOpeningHint")}</span>
        </form>
      </Card>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link href={q(month)} className={asFirst ? "text-blue" : "font-semibold text-navy"}>{u("cashNow")}</Link>
        {saved && <Link href={`${q(month)}&v=first`} className={asFirst ? "font-semibold text-navy" : "text-blue"}>{u("cashAsFirst", { at: localIso(saved.generatedAt)!.slice(0, 16).replace("T", " ") })}</Link>}
      </div>

      <div className="overflow-x-auto rounded-xl border bg-white">
        <table className="w-full min-w-[640px] text-[13px]">
          <thead className="border-b border-line text-left text-navy/70"><tr><th className="px-3 py-2">{u("cashDay")}</th><th>{u("cashTo")}</th><th>{u("cashWhat")}</th><th className="pr-3 text-right">{u("cashOutCol")}</th><th className="pr-3 text-right">{u("cashInCol")}</th>{opening != null && <th className="pr-3 text-right">{u("cashBalance")}</th>}</tr></thead>
          <tbody>
            {[...byDay.entries()].map(([date, ls]) => {
              const bal = days.find((d) => d.date === date);
              return ls.map((l, i) => (
                <tr key={`${date}-${i}`} className="border-b border-hair align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono">{i === 0 ? date.slice(5) : ""}</td>
                  <td className="py-2">{l.kind === "PAYROLL" ? u("cashStaff", { n: l.party }) : l.kind === "SSO" ? u("cashSsoOffice") : ["PND1", "PND53", "VAT"].includes(l.kind) ? u("cashRevenue") : l.party}</td>
                  <td className="py-2">
                    {l.href ? <Link href={l.href} className="text-blue hover:underline">{u(`cashKind_${l.kind}`)}</Link> : u(`cashKind_${l.kind}`)} <span className="text-navy/70">{l.kind === "FIXED" || l.kind === "EXPENSE" || l.kind === "SUPPLIER" || l.kind === "RECEIVABLE" ? l.what : l.what}</span>
                    {l.ref && l.ref !== l.what ? <span className="ml-1 font-mono text-[11px] text-navy/50">{l.ref}</span> : null}
                    <span className="ml-1.5 inline-flex gap-1">{l.overdue && <Tag hot>{u("cashOverdue")}</Tag>}{l.estimate && <Tag>{u("cashEstimate")}</Tag>}{l.fixed && l.kind === "FIXED" && <Tag>{u("cashFixedTag")}</Tag>}</span>
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-mono">{l.dir === "OUT" ? `${l.currency === "THB" ? "" : `${l.currency} `}${money(l.amount)}` : ""}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right font-mono text-blue">{l.dir === "IN" ? `${l.currency === "THB" ? "" : `${l.currency} `}${money(l.amount)}` : ""}</td>
                  {opening != null && <td className={`whitespace-nowrap py-2 pr-3 text-right font-mono ${bal && bal.balance < 0 ? "font-semibold text-alert-ink" : "text-navy/70"}`}>{i === ls.length - 1 && bal ? money(bal.balance) : ""}</td>}
                </tr>
              ));
            })}
            {lines.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-navy/60">{u("cashEmpty")}</td></tr>}
          </tbody>
          {lines.length > 0 && <tfoot><tr className="font-semibold"><td className="px-3 py-2" colSpan={3}>{u("cashTotal")}</td><td className="pr-3 text-right font-mono">{money(totals.out)}</td><td className="pr-3 text-right font-mono">{money(totals.in)}</td>{opening != null && <td className="pr-3 text-right font-mono">{money(opening + totals.net)}</td>}</tr></tfoot>}
        </table>
      </div>
      <p className="text-xs text-navy/60">{u("cashNote")}</p>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border bg-white p-3">
      <div className="text-xs text-navy/60">{label}</div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone === "bad" ? "text-alert-ink" : "text-navy"}`}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-navy/60">{hint}</div>}
    </div>
  );
}
