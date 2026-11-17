import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { mayPlan, saveRecurring, stopRecurring, thisMonth } from "@/server/cash-plan";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { PageHeader, Card, Field, Grid, Table, inputCls, btnPrimary } from "@/components/ui";

export const dynamic = "force-dynamic";
const money = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 固定付款: what is paid every month whatever happens. Each one appears in the cash plan on its day. */
export default async function FixedPayments({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; stopped?: string }> }) {
  const sp = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  if (!mayPlan(me)) notFound();
  const showStopped = sp.stopped === "1";
  const stoppedRows = showStopped ? await prisma.recurringPayment.findMany({ where: { entityId: me.entityId, active: false }, orderBy: [{ payee: "asc" }] }) : [];
  const rows = await prisma.recurringPayment.findMany({ where: { entityId: me.entityId, active: true }, orderBy: [{ dayOfMonth: "asc" }, { payee: "asc" }] });
  async function add(f: FormData) {
    "use server";
    await guarded(async () => {
      const who = await currentEmployee();
      const s = (k: string) => String(f.get(k) ?? "").trim();
      await saveRecurring(who.entityId, who, null, { payee: s("payee"), purpose: s("purpose"), amount: Number(s("amount").replace(/,/g, "")), dayOfMonth: Number(s("dayOfMonth")), startMonth: s("startMonth"), endMonth: s("endMonth") || undefined, note: s("note") || undefined });
      return "saved";
    }, "/finance/cash-plan/fixed");
  }
  async function stop(id: string) {
    "use server";
    await guarded(async () => { await stopRecurring(await currentEmployee(), id); return "saved"; }, "/finance/cash-plan/fixed");
  }
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance/cash-plan", label: u("cashPlan") }} title={u("cashFixed")} />
      <Flash ok={sp.ok} error={sp.error} />
      <Card title={u("cashFixedList", { n: rows.length, total: money(rows.filter((r) => r.currency === "THB").reduce((s, r) => s + Number(r.amount), 0)) })}>
        <Table head={[u("cashFixedDay"), u("cashTo"), u("cashWhat"), u("cashAmount"), u("cashFixedSpan"), ""]}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="font-mono">{r.dayOfMonth}</td><td>{r.payee}</td><td>{r.purpose}{r.note ? <span className="ml-1 text-xs text-navy/60">{r.note}</span> : null}</td>
              <td className="text-right font-mono">{r.currency === "THB" ? "" : `${r.currency} `}{money(Number(r.amount))}</td>
              <td className="font-mono text-xs">{r.startMonth} → {r.endMonth ?? "…"}</td>
              <td className="text-right"><form action={stop.bind(null, r.id)}><button className="text-sm text-alert-ink">{u("cashFixedStop")}</button></form></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-navy/60">{u("cashFixedEmpty")}</td></tr>}
          {stoppedRows.map((r) => (
            <tr key={r.id} className="text-navy/50">
              <td className="font-mono">{r.dayOfMonth}</td><td>{r.payee}</td><td>{r.purpose}{r.note ? <span className="ml-1 text-xs">{r.note}</span> : null}</td>
              <td className="text-right font-mono">{r.currency === "THB" ? "" : `${r.currency} `}{money(Number(r.amount))}</td>
              <td className="font-mono text-xs">{r.startMonth} → {r.endMonth ?? "…"}</td><td className="text-right text-xs">{u("cashFixedStopped")}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-sm"><Link href={showStopped ? "/finance/cash-plan/fixed" : "/finance/cash-plan/fixed?stopped=1"} className="text-blue hover:underline">{u(showStopped ? "cashFixedHideStopped" : "cashFixedShowStopped")}</Link></p>
      </Card>
      <Card title={`＋ ${u("cashFixedAdd")}`}>
        <form action={add}>
          <Grid>
            <Field label={u("cashTo")} required><input name="payee" required className={inputCls} /></Field>
            <Field label={u("cashWhat")} required><input name="purpose" required placeholder={u("cashFixedPurposePh")} className={inputCls} /></Field>
            <Field label={`${u("cashAmount")} (THB)`} required><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
            <Field label={u("cashFixedDay")} required><input name="dayOfMonth" required type="number" min={1} max={31} defaultValue={1} className={inputCls} /></Field>
            <Field label={u("cashFixedFrom")} required><input name="startMonth" required type="month" defaultValue={thisMonth()} className={inputCls} /></Field>
            <Field label={u("cashFixedTo")}><input name="endMonth" type="month" className={`${inputCls} ${sp.error === "FIXED_RANGE" ? "field-bad" : ""}`} /></Field>
            <Field label={t("note")} className="md:col-span-3"><input name="note" className={inputCls} /></Field>
          </Grid>
          <div className="mt-3"><button className={btnPrimary}>{t("save")}</button></div>
        </form>
      </Card>
    </div>
  );
}
