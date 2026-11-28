import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { can } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { billableWhere, issueMonthlyStatement } from "@/server/to";
import { Alert, Card, Field, PageHeader, Table, Tag, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const day = (v: Date | null | undefined) => (v ? localIso(v)!.slice(0, 10) : "—");
const money = (n: unknown) => Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 新建 BLTH (朱总 2026-11-28): finance picks the customer; every tax invoice of that customer that is issued and not
 * yet paid is listed; the ticked ones make the BLTH of the chosen month.
 */
export default async function NewStatement({ searchParams }: { searchParams: Promise<{ customer?: string; error?: string }> }) {
  const { customer, error } = await searchParams;
  const me = await currentEmployee();
  if (!can.invoice(me)) redirect("/no-access?roles=MD,FINANCE");
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const open = (i: { amountDue: unknown; paidAmount: unknown; whtAmount: unknown }) => Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0);

  // customers who have something to bill, with how much
  const all = await prisma.invoice.findMany({ where: billableWhere(), select: { amountDue: true, paidAmount: true, whtAmount: true, currency: true, serviceOrder: { select: { customer: { select: { code: true, name: true } } } } } });
  const byCustomer = new Map<string, { code: string; name: string; n: number; sums: Map<string, number> }>();
  for (const i of all) {
    const c = i.serviceOrder.customer, e = byCustomer.get(c.code) ?? { code: c.code, name: c.name, n: 0, sums: new Map<string, number>() };
    e.n += 1; e.sums.set(i.currency, (e.sums.get(i.currency) ?? 0) + open(i)); byCustomer.set(c.code, e);
  }
  const customers = [...byCustomer.values()].sort((a, b) => a.name.localeCompare(b.name));
  const chosen = customer ? await prisma.customer.findUnique({ where: { code: customer }, select: { id: true, code: true, name: true, paymentTermDays: true } }) : null;
  const invoices = chosen ? await prisma.invoice.findMany({ where: billableWhere(chosen.id), orderBy: { issuedAt: "asc" }, include: { taxInvoice: { select: { no: true } }, serviceOrder: { select: { no: true, customerRef: true } } } }) : [];
  // already on a statement and still unpaid: shown, not offered again
  const billed = chosen ? await prisma.invoice.findMany({ where: { serviceOrder: { customerId: chosen.id }, paidAt: null, cancelledAt: null, statementId: { not: null } }, orderBy: { issuedAt: "asc" }, include: { taxInvoice: { select: { no: true } }, statement: { select: { no: true } } } }) : [];
  const currencies = [...new Set(invoices.map((i) => i.currency))];
  const thisMonth = localIso(new Date())!.slice(0, 7);

  async function create(f: FormData) {
    "use server";
    const code = String(f.get("customer") ?? "");
    await guarded(async () => {
      const me = await currentEmployee();
      const ids = f.getAll("iv").map(String);
      if (!ids.length) throw new Error("BL_NOTHING");
      const m = /^(\d{4})-(\d{2})$/.exec(String(f.get("month") ?? ""));
      if (!m) throw new Error("BL_PERIOD");
      const bl = await issueMonthlyStatement(code, `${m[1].slice(2)}${m[2]}`, me.code, ids);
      return { ok: bl.no, to: `/statements/${bl.no}` };
    }, `/statements/new?customer=${encodeURIComponent(code)}`);
  }

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/documents?type=BL", label: u("statementsBl") }} title={u("blNew")} />
      {error && <Alert>{u.has(`err_${error.split(":")[0]}`) ? u(`err_${error.split(":")[0]}`, { detail: error.split(":").slice(1).join(":") }) : error}</Alert>}
      <Card title={`1 · ${u("blPickCustomer")}`}>
        {customers.length === 0 ? <p className="text-sm text-navy/70">{u("blNoCustomers")}</p> : <form className="flex flex-wrap items-end gap-2">
          <Field label={t("customer")}><select name="customer" defaultValue={chosen?.code ?? ""} className={`${inputCls} min-w-72`} required>
            <option value="">—</option>
            {customers.map((c) => <option key={c.code} value={c.code}>{c.name} · {u("blOpenCount", { n: c.n })} · {[...c.sums.entries()].map(([cur, v]) => `${cur} ${money(v)}`).join(" + ")}</option>)}
          </select></Field>
          <button className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold">{u("blShow")}</button>
        </form>}
      </Card>
      {chosen && <form action={create} data-nodraft className="space-y-4">
        <input type="hidden" name="customer" value={chosen.code} />
        <Card title={`2 · ${u("blPickInvoices", { name: chosen.name })}`} accent>
          {invoices.length === 0 ? <p className="text-sm text-navy/70">{u("blNoneOpen")}</p> : <>
            {currencies.length > 1 && <Alert>{u("blTwoCurrencies", { list: currencies.join(" / ") })}</Alert>}
            <Table head={["", "TITH", "IVTH", "QTTH", t("date"), u("dueDate"), t("currency"), t("amount"), u("paidOrWht"), u("outstanding")]}>
              {invoices.map((iv) => { const o = open(iv); const late = (iv.dueAt ?? new Date(iv.issuedAt.getTime() + chosen.paymentTermDays * 86_400_000)) < new Date(); return (
                <tr key={iv.id}>
                  <td><input type="checkbox" name="iv" value={iv.id} defaultChecked={currencies.length === 1 || iv.currency === currencies[0]} aria-label={iv.taxInvoice?.no ?? iv.no} className="h-4 w-4" /></td>
                  <td className="whitespace-nowrap font-mono">{iv.taxInvoice?.no ?? "—"}</td><td className="whitespace-nowrap font-mono">{iv.no}</td>
                  <td className="whitespace-nowrap font-mono"><Link href={`/service-orders/${iv.serviceOrder.no}`} className="text-blue hover:underline">{iv.serviceOrder.no}</Link>{iv.serviceOrder.customerRef ? <span className="block text-xs text-navy/60">PO {iv.serviceOrder.customerRef}</span> : null}</td>
                  <td className="whitespace-nowrap">{day(iv.issuedAt)}</td><td className="whitespace-nowrap">{day(iv.dueAt)}{late ? <> <Tag hot>{u("overdue")}</Tag></> : null}</td>
                  <td>{iv.currency}</td><td className="text-right tabular-nums">{money(iv.amountDue)}</td><td className="text-right tabular-nums">{money(Number(iv.paidAmount ?? 0) + Number(iv.whtAmount ?? 0))}</td>
                  <td className="text-right font-semibold tabular-nums">{money(o)}</td>
                </tr>); })}
            </Table>
            <p className="mt-2 text-right text-sm"><b>{u("blAllOpen")} {currencies.map((cur) => `${cur} ${money(invoices.filter((i) => i.currency === cur).reduce((s, i) => s + open(i), 0))}`).join(" + ")}</b> · {u("blOpenCount", { n: invoices.length })}</p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <Field label={u("blMonth")} required><input type="month" name="month" defaultValue={thisMonth} required className={inputCls} /></Field>
              <button className={btnPrimary}>{u("blCreate")}</button>
            </div>
            <p className="mt-2 text-xs text-navy/70">{u("blHint")}</p>
          </>}
        </Card>
        {billed.length > 0 && <Card title={u("blAlreadyBilled")}>
          <Table head={["TITH", "IVTH", t("date"), t("currency"), u("outstanding"), "BLTH"]}>
            {billed.map((iv) => <tr key={iv.id}><td className="whitespace-nowrap font-mono">{iv.taxInvoice?.no ?? "—"}</td><td className="whitespace-nowrap font-mono">{iv.no}</td><td className="whitespace-nowrap">{day(iv.issuedAt)}</td><td>{iv.currency}</td><td className="text-right tabular-nums">{money(open(iv))}</td>
              <td className="whitespace-nowrap font-mono">{iv.statement ? <Link href={`/statements/${iv.statement.no}`} className="text-blue hover:underline">{iv.statement.no}</Link> : "—"}</td></tr>)}
          </Table>
        </Card>}
      </form>}
    </div>
  );
}
