import { can } from "@/lib/caps";
import { redirect } from "next/navigation";
import { customerScope, orderScope } from "@/server/scope";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { completeCustomer } from "@/server/company-lookup";
import { isThaiTaxId } from "@/server/dbd";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee, grantReveal, revealActive } from "@/server/auth";
import { addContact, addPlant, authorizeReveal } from "@/server/crm";
import { issueMonthlyStatement } from "@/server/to";
import { guarded } from "@/lib/action-result";
import { maskEmail, maskLogin, maskName, maskPhone } from "@/lib/mask";
import { Flash } from "@/components/Flash";
import { businessClosureOn } from "@/lib/closure";
import { AssetStatusBadge, OrderStatusBadge } from "@/components/StatusBadge";
import { Card, Field, Grid, PageHeader, Table, Tag, Value, btnGhost, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Customer page: company, plants, contacts (masked unless re-authorised), files, assets, orders. */
export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { code } = await params;
  const { ok, error } = await searchParams;
  const me0 = await currentEmployee();
  const full = can.customersAll(me0), mayEdit = can.customers(me0); // 工程师、主管: name, plants, site contacts, machines, their own orders — no tax id, terms, receivables
  const oScope = await orderScope(me0);
  const c = await prisma.customer.findUnique({ where: { code }, include: { plants: true, contacts: { include: { plant: true } }, assets: { include: { model: true, plant: true }, orderBy: { code: "asc" } }, serviceOrders: { where: oScope, orderBy: { reportedAt: "desc" }, take: 20 }, entity: true } });
  if (!c) notFound();
  if (!full && !(await prisma.customer.count({ where: { id: c.id, ...(await customerScope(me0)) } }))) redirect("/no-access");
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const open = await revealActive(code);
  const show = <T,>(v: T, mask: (x: T) => string) => (open ? v : mask(v));

  async function reveal(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await authorizeReveal(me.code, String(f.get("password") ?? ""), code);
      await grantReveal(me.code, code);
      return "revealed";
    }, `/customers/${code}`);
  }
  async function plant(f: FormData) {
    "use server";
    await guarded(async () => { await addPlant(code, { code: String(f.get("code")), name: String(f.get("name")), address: String(f.get("address") || "") || undefined, accessNotes: String(f.get("access") || "") || undefined }); }, `/customers/${code}`);
  }
  async function contact(f: FormData) {
    "use server";
    const s = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    await guarded(async () => { await addContact(code, { name: s("name") ?? "", title: s("title"), plantCode: s("plant"), phone: s("phone"), lineId: s("line"), email: s("email"), birthday: s("birthday"), portalLogin: s("login"), portalPassword: s("pw") }); }, `/customers/${code}`);
  }
  async function complete() {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const r = await completeCustomer(code, me.id);
      return r.filled.length ? `completed:${r.filled.length}` : "completedNone";
    }, `/customers/${code}`);
  }
  async function statement() {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); const bl = await issueMonthlyStatement(code, localIso(new Date())!.slice(2, 7).replace("-", ""), me.code); return `${bl.no} · ${bl.currency} ${Number(bl.total).toFixed(2)}`; }, `/customers/${code}`);
  }
  const files = (c.files as { name: string; url: string; kind: string }[] | null) ?? [];
  // Historical inquiry files (decision 2026-11-08): every INQUIRY attachment on this customer's orders, newest first.
  const inquiryFiles = !full ? [] : (await prisma.serviceOrder.findMany({ where: { customerId: c.id }, select: { no: true, reportedAt: true, attachments: true }, orderBy: { reportedAt: "desc" } }))
    .flatMap((o) => (((o.attachments as { name: string; url: string; kind: string }[] | null) ?? []).filter((a) => a.kind === "INQUIRY").map((a) => ({ ...a, orderNo: o.no, at: o.reportedAt }))));
  const statements = c.monthlyStatement && can.invoiceStatus(me0) ? await prisma.monthlyStatement.findMany({ where: { customerId: c.id }, orderBy: { issuedAt: "desc" }, take: 12, include: { _count: { select: { invoices: true } } } }) : [];
  const errorCode = error === "WRONG_PASSWORD" ? u("wrongPassword") : error;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/customers", label: u("backToCustomers") }} title={<><span className="font-mono">{c.code}</span> <span className="text-lg font-semibold">{c.name}</span></>} badge={c.dbdStatus ? <Tag>DBD · {c.dbdStatus}</Tag> : undefined}
        actions={!mayEdit ? undefined : <>{c.taxId && isThaiTaxId(c.taxId) && (!c.addressLocal || !c.addressEn || !c.billingAddress || !c.phone || !c.nameLocal) && <form action={complete}><button className={btnGhost}>🔎 {u("completeByTaxId")}</button></form>}{c.monthlyStatement && businessClosureOn() && <form action={statement}><button className={btnGhost}>{t("blthThisMonth")}</button></form>}<Link href={`/assets/new?customerId=${c.id}`} className={btnGhost}>＋ {u("newAsset")}</Link></>}
        newHref={`/service-orders/new?customer=${c.code}`} newLabel={u("newServiceOrder")} />
      <Flash ok={ok === "revealed" ? u("revealedFor5") : ok?.startsWith("completed:") ? u("completedN", { n: ok.split(":")[1] }) : ok === "completedNone" ? u("completedNone") : ok} error={errorCode} />
      <Card title={u("company")}>
        <Grid>
          <Field label={u("nameTh")}><Value>{c.nameLocal ?? "—"}</Value></Field>
          <Field label={u("nameEnLabel")}><Value>{c.name}</Value></Field>
          {full && <Field label={`${t("taxId")} · ${t("branch")}`}><Value><span className="font-mono">{c.taxId ?? "—"}</span> · {c.branchCode ?? "—"}</Value></Field>}
          <Field label={u("addressTh")}><Value>{c.addressLocal ?? "—"}</Value></Field>
          <Field label={u("addressEnLabel")}><Value>{c.addressEn ?? "—"}</Value></Field>
          {full && <Field label={u("billingAddress")}><Value>{c.billingAddress ?? "—"}</Value></Field>}
          {full && <Field label={t("termDays")}><Value>{c.paymentTermDays} · {c.defaultCurrency}{c.monthlyStatement ? ` · ${u("monthlyCustomer")}` : ""}</Value></Field>}
          <Field label={u("legalEntity")}><Value>{c.entity.code}</Value></Field>
          <Field label={t("phone")}><Value>{c.phone ?? "—"}</Value></Field>
        </Grid>
        {full && files.length > 0 && <div className="flex flex-wrap gap-2 text-xs">{files.map((f) => <a key={f.url} href={f.url} target="_blank" className="rounded-full border border-navy/35 bg-white px-2.5 py-0.5 font-semibold">📄 {f.kind} · {f.name}</a>)}</div>}
      </Card>
      <Card title={u("plants")}>
        <Table head={[u("plantCode"), u("plantName"), t("address"), u("accessNotes")]}>
          {c.plants.map((p) => <tr key={p.id}><td className="font-mono">{p.code}</td><td>{p.name}</td><td>{p.address ?? ""}</td><td>{p.accessNotes ?? ""}</td></tr>)}
        </Table>
        <form action={plant} className="grid grid-cols-2 gap-2 md:grid-cols-[100px_1fr_2fr_2fr_auto]"><input name="code" required placeholder={u("plantCode")} className={inputCls} /><input name="name" required placeholder={u("plantName")} className={inputCls} /><input name="address" placeholder={t("address")} className={inputCls} /><input name="access" placeholder={u("accessNotes")} className={inputCls} /><button className={btnGhost}>＋ {u("addPlant")}</button></form>
      </Card>
      <Card title={u("contacts")}>
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{open ? u("revealed") : `🔒 ${u("masked")}`}</Tag>
          {!open && <form action={reveal} className="flex items-center gap-2"><input name="password" type="password" required placeholder={u("reenterPassword")} className={`${inputCls} w-48`} /><button className={`${btnGhost} whitespace-nowrap`}>{u("showFull")}</button></form>}
        </div>
        <Table head={[u("personName"), u("jobTitle"), t("plant"), u("phoneLine"), t("email"), u("portalLogin")]}>
          {c.contacts.map((k) => <tr key={k.id}><td>{show(k.name, maskName)}</td><td>{k.title ?? ""}</td><td>{k.plant?.code ?? ""}</td><td>{show(k.phone, maskPhone)}{k.lineId ? ` · ${show(k.lineId, maskLogin)}` : ""}</td><td>{show(k.email, maskEmail)}</td><td>{k.portalLogin ? show(k.portalLogin, maskLogin) : "—"}</td></tr>)}
        </Table>
        {/* every box under its own label: the list's header above belongs to the list, not to these boxes */}
        <form action={contact} className="rounded-lg border border-hair bg-[#F8FAFC] p-3">
          <p className="mb-2 text-sm font-semibold text-navy">＋ {u("addContact")}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
            <Field label={u("personName")} required><input name="name" required className={inputCls} /></Field>
            <Field label={u("jobTitle")}><input name="title" className={inputCls} /></Field>
            <Field label={t("plant")}><select name="plant" className={inputCls}><option value="">—</option>{c.plants.map((p) => <option key={p.id} value={p.code}>{p.code} {p.name}</option>)}</select></Field>
            <Field label={t("phone")}><input name="phone" inputMode="tel" className={inputCls} /></Field>
            <Field label="LINE"><input name="line" className={inputCls} /></Field>
            <Field label={t("email")}><input name="email" type="email" className={inputCls} /></Field>
            <Field label={u("birthdayMmDd")}><input name="birthday" placeholder="11-25" className={inputCls} /></Field>
            <Field label={u("portalLogin")}><input name="login" autoComplete="off" className={inputCls} /></Field>
            <Field label={u("portalPassword")}><input name="pw" type="password" autoComplete="new-password" className={inputCls} /></Field>
          </div>
          <div className="mt-3"><button className={btnGhost}>{u("addContact")}</button></div>
        </form>
      </Card>
      <Card title={`${t("assets")} (${c.assets.length})`}>
        <Table head={[t("assetCode"), t("model"), t("serial"), t("plant"), t("location"), t("status")]}>
          {c.assets.map((a) => <tr key={a.id}><td><Link href={`/assets/${a.code}`} className="font-mono text-blue hover:underline">{a.code}</Link></td><td>{a.model?.code ?? t(a.type)}</td><td className="font-mono">{a.serialNumber}</td><td>{a.plant?.code ?? ""}</td><td>{a.location ?? ""}</td><td><AssetStatusBadge status={a.status} /></td></tr>)}
        </Table>
      </Card>
      <Card title={t("serviceOrders")}>
        <Table head={["QTTH", t("status"), t("symptom"), ...(can.price(me0) ? [t("amount")] : [])]}>
          {c.serviceOrders.map((o) => <tr key={o.id}><td><Link href={`/service-orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link></td><td><OrderStatusBadge status={o.status} /></td><td className="text-fault">{o.reportedSymptom ?? ""}</td>{can.price(me0) && <td>{o.total != null ? `${o.currency} ${Number(o.total).toFixed(2)}` : ""}</td>}</tr>)}
        </Table>
      </Card>
      {full && <Card title={<>{u("inquiryHistory")} <Tag>{inquiryFiles.length}</Tag></>}>
        {inquiryFiles.length ? <Table head={[t("date"), "QTTH", u("file")]}>
          {inquiryFiles.map((f) => <tr key={f.url}><td>{localIso(f.at)!.slice(0, 10)}</td><td><Link href={`/service-orders/${f.orderNo}`} className="font-mono text-blue hover:underline">{f.orderNo}</Link></td><td><a href={f.url} target="_blank" className="text-blue hover:underline">📄 {f.name}</a></td></tr>)}
        </Table> : <p className="text-sm text-navy/60">{u("noInquiryFiles")}</p>}
      </Card>}
      {statements.length > 0 && <Card title={u("statementsBl")}>
        <Table head={["BLTH", u("period"), t("date"), u("invoicesOnStatement"), t("amount"), "PDF"]}>
          {statements.map((b) => <tr key={b.id}><td className="font-mono"><Link href={`/statements/${b.no}`} className="text-blue hover:underline">{b.no}</Link></td><td>20{b.period.slice(0, 2)}-{b.period.slice(2, 4)}</td><td>{localIso(b.issuedAt)!.slice(0, 10)}</td><td>{b._count.invoices}</td><td>{b.currency} {Number(b.total).toFixed(2)}</td><td className="text-xs"><a className="text-blue hover:underline" href={`/api/documents/${b.no}/render?format=pdf`}>BLTH</a></td></tr>)}
        </Table>
      </Card>}
      {c.editedFields && <p className="text-xs text-navy/70">{u("dbdEdited", { fields: (c.editedFields as string[]).join(", ") })}</p>}
    </div>
  );
}
