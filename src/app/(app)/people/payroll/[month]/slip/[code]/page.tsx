import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** 工资单: the person's own (approved months), or anyone's for the MD. Prints on one A4 page from the browser. */
export default async function Slip({ params }: { params: Promise<{ month: string; code: string }> }) {
  const { month, code } = await params;
  const [t, me] = await Promise.all([getTranslations("ops"), currentEmployee()]);
  if (me.role !== "MD" && me.code !== code) notFound();
  const line = await prisma.payrollLine.findFirst({ where: { employee: { code }, run: { entityId: me.entityId, month, ...(me.role === "MD" ? {} : { status: { not: "DRAFT" } }) } }, include: { employee: true, run: true } });
  if (!line) notFound();
  const entity = await prisma.legalEntity.findUnique({ where: { id: line.run.entityId } });
  const money = (n: unknown) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const allowances = (line.allowances as { name: string; amount: number }[] | null) ?? [];
  const earn: [string, unknown][] = [[t("payBase"), line.baseSalary], ...allowances.map((a) => [a.name, a.amount] as [string, unknown]), [t("payOvertime"), line.overtime], [`${t("payIncentive")}${line.perfScore != null ? ` · ${Number(line.perfScore)} → ×${Number(line.perfFactor)}` : ""}`, line.incentive], [t("payBonus"), line.bonus]];
  const cut: [string, unknown][] = [[`${t("paySso")} 5%`, line.ssoEmployee], [t("payPvd"), line.pvdEmployee], [t("payWht"), line.wht], [t("payOther"), line.otherDeduction]];
  const tail = (s: string | null) => (s ? `•••• ${s.replace(/\D/g, "").slice(-4)}` : "—");
  return (
    <div className="space-y-4">
      <div className="print:hidden"><PageHeader back={{ href: me.role === "MD" ? `/people/payroll/${month}` : "/people/payroll", label: t("payTitle") }} title={t("paySlip")} /></div>
      <article className="mx-auto max-w-2xl rounded-xl border bg-white p-6 text-sm print:border-0 print:p-0">
        <header className="flex items-start justify-between gap-4 border-b border-navy pb-3">
          <img src="/brand/dcit-logo.png" alt="DCiT" className="h-10 w-auto" />
          <div className="text-right"><div className="text-base font-bold text-navy">{t("paySlipHead")} · PAY SLIP</div><div className="text-xs text-navy/70">{entity?.nameEn}</div><div className="font-mono text-xs">{month}{line.run.status === "DRAFT" ? ` · ${t("pay_DRAFT")}` : ""}</div></div>
        </header>
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
          <div className="flex justify-between gap-2"><dt className="text-navy/70">{t("slipName")}</dt><dd className="font-semibold">{line.employee.name}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-navy/70">{t("slipCode")}</dt><dd className="font-mono">{line.employee.code}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-navy/70">{t("slipPosition")}</dt><dd>{line.employee.position ?? "—"}</dd></div>
          <div className="flex justify-between gap-2"><dt className="text-navy/70">{t("slipBank")}</dt><dd className="font-mono">{line.employee.bankName ?? ""} {tail(line.employee.bankAccount)}</dd></div>
        </dl>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <section><h2 className="mb-1 border-b pb-1 font-semibold text-navy">{t("slipEarnings")}</h2>
            {earn.filter(([, v]) => Number(v) !== 0).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-0.5"><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>)}
            <div className="mt-1 flex justify-between gap-3 border-t pt-1 font-semibold"><span>{t("payGross")}</span><span className="tabular-nums">{money(line.gross)}</span></div>
          </section>
          <section><h2 className="mb-1 border-b pb-1 font-semibold text-navy">{t("slipDeductions")}</h2>
            {cut.filter(([, v]) => Number(v) !== 0).map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-0.5"><span>{k}</span><span className="tabular-nums">{money(v)}</span></div>)}
            <div className="mt-1 flex justify-between gap-3 border-t pt-1 font-semibold"><span>{t("slipDeductTotal")}</span><span className="tabular-nums">{money(Number(line.ssoEmployee) + Number(line.pvdEmployee) + Number(line.wht) + Number(line.otherDeduction))}</span></div>
            {Number(line.reimbursement) > 0 && <div className="mt-2 flex justify-between gap-3 py-0.5"><span>{t("payReimb")}</span><span className="tabular-nums">{money(line.reimbursement)}</span></div>}
          </section>
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-navy px-4 py-3 text-white"><span className="font-semibold">{t("payNet")} · NET PAY</span><span className="text-xl font-bold tabular-nums">THB {money(line.net)}</span></div>
        <p className="mt-3 text-xs text-navy/60">{t("slipEmployer", { sso: money(line.ssoEmployer) })}{line.run.paidAt ? ` · ${t("slipPaidOn", { date: line.run.paidAt.toISOString().slice(0, 10) })}` : ""}</p>
      </article>
    </div>
  );
}
