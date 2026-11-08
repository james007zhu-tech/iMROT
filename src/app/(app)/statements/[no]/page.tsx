import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { Card, Field, Grid, PageHeader, Table, Tag, Value, btnGhost } from "@/components/ui";

export const dynamic = "force-dynamic";
const day = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "—");
const money = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** BLTH detail (decision 2026-11-08: only credit customers have statements): the invoices on it, what is paid, ageing, PDF. */
export default async function Statement({ params }: { params: Promise<{ no: string }> }) {
  const { no } = await params;
  await currentEmployee();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const bl = await prisma.monthlyStatement.findUnique({ where: { no }, include: { invoices: { include: { taxInvoice: true, serviceOrder: true, receipts: true }, orderBy: { issuedAt: "asc" } } } });
  if (!bl) notFound();
  const c = await prisma.customer.findUniqueOrThrow({ where: { id: bl.customerId } });
  const y = 2000 + Number(bl.period.slice(0, 2)), m = Number(bl.period.slice(2, 4));
  const start = new Date(Date.UTC(y, m - 1, 1)), end = new Date(Date.UTC(y, m, 0));
  const paid = (iv: (typeof bl.invoices)[number]) => iv.receipts.reduce((s, r) => s + Number(r.settledAmount), 0);
  const outstanding = (iv: (typeof bl.invoices)[number]) => Number(iv.amountDue) - paid(iv);
  const age = (iv: (typeof bl.invoices)[number]) => Math.floor((bl.issuedAt.getTime() - (iv.dueAt ?? new Date(iv.issuedAt.getTime() + c.paymentTermDays * 86_400_000)).getTime()) / 86_400_000);
  const bucket = (f: (d: number) => boolean) => bl.invoices.filter((iv) => f(age(iv))).reduce((s, iv) => s + outstanding(iv), 0);
  const totalOutstanding = bl.invoices.reduce((s, iv) => s + outstanding(iv), 0);
  const settledSince = bl.invoices.filter((iv) => outstanding(iv) < 0.005).length;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/customers/${c.code}`, label: c.name }} title={<><span className="font-mono">{bl.no}</span> <span className="font-normal">· {u("statementsBl")}</span></>}
        badge={<><Tag>{`20${bl.period.slice(0, 2)}-${bl.period.slice(2, 4)}`}</Tag>{totalOutstanding < 0.005 ? <Tag>{u("settled")}</Tag> : <Tag hot>{u("outstanding")} {bl.currency} {money(totalOutstanding)}</Tag>}</>}
        actions={<a className={btnGhost} href={`/api/documents/${bl.no}/render?format=pdf`}>PDF</a>} />
      <Card title={u("statementHeader")}>
        <Grid cols={4}>
          <Field label={t("customer")}><Value><Link href={`/customers/${c.code}`} className="text-blue hover:underline">{c.code} · {c.name}</Link></Value></Field>
          <Field label={u("period")}><Value>{day(start)} → {day(end)}</Value></Field>
          <Field label={u("issueDate")}><Value>{day(bl.issuedAt)}</Value></Field>
          <Field label={t("termDays")}><Value>{c.paymentTermDays}</Value></Field>
          <Field label={u("totalAtIssue")}><Value>{bl.currency} {money(bl.total)}</Value></Field>
          <Field label={u("outstandingNow")}><Value>{bl.currency} {money(totalOutstanding)}</Value></Field>
          <Field label={u("invoicesOnStatement")}><Value>{bl.invoices.length} · {u("settledSince", { n: settledSince })}</Value></Field>
          <Field label={t("taxId")}><Value>{c.taxId ?? "—"}</Value></Field>
        </Grid>
      </Card>
      <Card title={u("statementLines")}>
        <Table head={["IVTH", "TITH", "QTTH", t("date"), u("dueDate"), t("amount"), u("paidOrWht"), u("outstanding"), u("ageDays")]}>
          {bl.invoices.map((iv) => { const o = outstanding(iv); const a = age(iv); return (
            <tr key={iv.id} className={iv.cancelledAt ? "text-navy/50 line-through" : ""}>
              <td className="font-mono"><a className="text-blue hover:underline" href={`/api/documents/${iv.no}/render?format=pdf`}>{iv.no}</a></td>
              <td className="font-mono">{iv.taxInvoice?.no ?? "—"}</td>
              <td className="font-mono"><Link href={`/service-orders/${iv.serviceOrder.no}`} className="text-blue hover:underline">{iv.serviceOrder.no}</Link></td>
              <td>{day(iv.issuedAt)}</td><td>{day(iv.dueAt)}</td>
              <td className="text-right">{money(iv.amountDue)}</td><td className="text-right">{money(paid(iv))}</td>
              <td className={`text-right ${o > 0.004 ? "font-semibold" : ""}`}>{money(o)}</td>
              <td className="text-right">{o > 0.004 && a > 0 ? <Tag hot>+{a}</Tag> : o > 0.004 ? a : "—"}</td>
            </tr>); })}
        </Table>
      </Card>
      <Card title={u("ageing")}>
        <Table head={[u("ageCurrent"), u("age30"), u("age60"), u("age90"), u("ageOver")]}>
          <tr>{[bucket((d) => d <= 0), bucket((d) => d > 0 && d <= 30), bucket((d) => d > 30 && d <= 60), bucket((d) => d > 60 && d <= 90), bucket((d) => d > 90)].map((v, i) => <td key={i} className={`text-right ${i > 0 && v > 0.004 ? "font-semibold text-alert-ink" : ""}`}>{money(v)}</td>)}</tr>
        </Table>
        <p className="text-xs text-navy/60">{u("statementNote")}</p>
      </Card>
    </div>
  );
}
