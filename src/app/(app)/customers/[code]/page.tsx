import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee, hashPassword } from "@/server/auth";
import { issueMonthlyStatement } from "@/server/to";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

/** Customer page: everything the customer owns, seen from the asset line. */
export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { code } = await params;
  const { ok, error } = await searchParams;
  const c = await prisma.customer.findUnique({ where: { code }, include: { plants: true, contacts: true, assets: { include: { model: true }, orderBy: { code: "asc" } }, serviceOrders: { orderBy: { reportedAt: "desc" }, take: 20 }, entity: true } });
  if (!c) notFound();
  const t = await getTranslations("common");
  const customerId = c.id; // actions close over strings only
  async function addPlant(form: FormData) { "use server"; await prisma.plant.create({ data: { customerId, code: String(form.get("code")), name: String(form.get("name")), address: String(form.get("address") || "") || undefined } }); redirect(`/customers/${code}`); }
  async function addContact(form: FormData) {
    "use server";
    const login = String(form.get("portalLogin") || "") || undefined;
    const pw = String(form.get("password") || "");
    await prisma.contact.create({ data: { customerId, plantId: String(form.get("plantId") || "") || undefined, name: String(form.get("name")), title: String(form.get("title") || "") || undefined, phone: String(form.get("phone") || "") || undefined, email: String(form.get("email") || "") || undefined, portalLogin: login, portalPasswordHash: login && pw ? hashPassword(pw) : undefined } });
    redirect(`/customers/${code}`);
  }
  async function statement() {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); const bl = await issueMonthlyStatement(code, new Date().toISOString().slice(2, 7).replace("-", ""), me.code); return `BLTH ${bl.no} · ${bl.currency} ${Number(bl.total).toFixed(2)}`; }, `/customers/${code}`);
  }
  const input = "rounded border px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <Flash ok={ok} error={error} />
      <div className="flex items-center gap-3"><Link href="/customers" className="text-sm text-blue">← CRM</Link><h1 className="font-mono text-2xl font-bold">{c.code}</h1><span>{c.name}</span>{c.nameLocal && <span className="text-slate-500">{c.nameLocal}</span>}</div>
      <div className="flex items-center gap-3 text-sm text-slate-600">Tax ID {c.taxId ?? "—"} · branch {c.branchCode ?? "—"} · {c.paymentTermDays} days · {c.defaultCurrency}{c.monthlyStatement && <form action={statement}><button className="rounded border px-2 py-0.5 text-xs">BLTH this month</button></form>}</div>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("plant")}</h2>
          <ul className="text-sm">{c.plants.map((p) => <li key={p.id}>{p.code} · {p.name}{p.address ? ` · ${p.address}` : ""}</li>)}</ul>
          <form action={addPlant} className="mt-2 flex gap-1"><input name="code" placeholder="P1" className={`${input} w-16`} required /><input name="name" placeholder="Plant name" className={input} required /><input name="address" placeholder="Address" className={input} /><button className="rounded bg-navy px-2 text-xs text-white">+</button></form>
        </section>
        <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">Contacts</h2>
          <ul className="text-sm">{c.contacts.map((k) => <li key={k.id}>{k.name}{k.title ? ` · ${k.title}` : ""}{k.phone ? ` · ${k.phone}` : ""}{k.portalLogin ? <span className="ml-1 rounded bg-emerald-100 px-1 text-xs">portal: {k.portalLogin}</span> : null}</li>)}</ul>
          <form action={addContact} className="mt-2 grid grid-cols-2 gap-1"><input name="name" placeholder="Name" className={input} required /><input name="title" placeholder="Title" className={input} /><input name="phone" placeholder="Phone" className={input} /><input name="email" placeholder="Email" className={input} /><select name="plantId" className={input}><option value="">{t("plant")}</option>{c.plants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><span /><input name="portalLogin" placeholder="Portal login" className={input} /><input name="password" type="password" placeholder="Portal password" className={input} /><button className="col-span-2 rounded bg-navy px-2 py-1 text-xs text-white">+</button></form>
        </section>
      </div>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("assets")} ({c.assets.length})</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">{c.assets.map((a) => <li key={a.id} className="flex items-center gap-2"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span>{a.model?.code ?? a.type}</span><span className="text-slate-500">{a.location}</span><AssetStatusBadge status={a.status} /></li>)}</ul>
        <Link href="/assets/new" className="mt-2 inline-block text-sm text-blue">+ {t("onboard")}</Link>
      </section>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">{t("serviceOrders")}</h2>
        <ul className="text-sm">{c.serviceOrders.map((o) => <li key={o.id} className="flex items-center gap-2"><Link href={`/service-orders/${o.no}`} className="font-mono text-blue underline">{o.no}</Link><OrderStatusBadge status={o.status} /><span className="text-slate-500">{o.reportedSymptom}</span>{o.total != null && <span className="ml-auto">{o.currency} {Number(o.total).toFixed(2)}</span>}</li>)}</ul>
      </section>
    </div>
  );
}
