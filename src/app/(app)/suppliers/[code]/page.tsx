import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { averageScore, ratingScore } from "@/lib/srm";
import { Flash } from "@/components/Flash";
import { Card, Field, Grid, PageHeader, Table, Tag, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { savePartnerAction } from "./actions";
import { defaultPaymentMode } from "@/lib/srm";

export const dynamic = "force-dynamic";
const ASSET_TYPES = ["MOTOR", "VFD", "PLC", "PANEL", "DRIVE_TRAIN", "SENSOR", "OTHER"] as const;

/** Supplier file: partner profile (合作维修 — what it repairs, payment terms), ratings, purchase orders, payables. */
export default async function SupplierPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ code }, { ok, error }] = await Promise.all([params, searchParams]);
  const [t, u, tPo, ta] = await Promise.all([getTranslations("common"), getTranslations("ui"), getTranslations("poStatus"), getTranslations("assetType")]);
  const s = await prisma.supplier.findUnique({ where: { code }, include: { ratings: { orderBy: { createdAt: "desc" }, include: { purchaseOrder: { select: { no: true } }, by: { select: { name: true } } } }, orders: { orderBy: { createdAt: "desc" }, take: 30, include: { serviceOrder: { select: { no: true } } } }, invoices: { orderBy: { dueDate: "asc" }, include: { purchaseOrder: { select: { no: true } } } } } });
  if (!s) notFound();
  const avg = averageScore(s.ratings);
  const extra = s.capabilities.filter((c) => !(ASSET_TYPES as readonly string[]).includes(c)).join(", ");
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/suppliers", label: u("suppliers") }} title={<span><span className="font-mono">{s.code}</span> {s.name}</span>} badge={<>{s.isPartner && <Tag>{u("partnerRepair")}</Tag>}{avg != null && <Tag>{u("partnerScore")} {avg}</Tag>}</>}
        actions={<Link href={`/suppliers/new?id=${s.id}`} className={btnGhost}>{t("edit")}</Link>} />
      <Flash ok={ok} error={error} />
      <Card title={u("partnerProfile")}>
        <form action={savePartnerAction.bind(null, code)} className="space-y-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isPartner" defaultChecked={s.isPartner} /> {u("isPartner")}</label>
          <Field label={u("capabilities")}><div className="flex flex-wrap gap-3 text-sm">{ASSET_TYPES.map((x) => <label key={x} className="flex items-center gap-1"><input type="checkbox" name="cap" value={x} defaultChecked={s.capabilities.includes(x)} /> {ta(x)}</label>)}</div></Field>
          <Grid cols={4}>
            <Field label={u("capabilitiesExtra")}><input name="extraCapabilities" defaultValue={extra} placeholder="CNC, SERVO" className={inputCls} /></Field>
            <Field label={u("countryCode")}><input name="countryCode" defaultValue={s.countryCode} maxLength={2} className={`${inputCls} font-mono uppercase`} /></Field>
            <Field label={u("paymentMode")}><select name="paymentMode" defaultValue={s.isPartner ? s.paymentMode : defaultPaymentMode(s.countryCode)} className={inputCls}><option value="MONTHLY">{u("pay_MONTHLY")}</option><option value="PER_ORDER">{u("pay_PER_ORDER")}</option></select></Field>
            <Field label={u("paymentDays")}><input name="paymentDays" type="number" min="0" defaultValue={s.paymentDays ?? (!s.isPartner && defaultPaymentMode(s.countryCode) === "MONTHLY" ? 15 : "")} placeholder="15" className={inputCls} /></Field>
          </Grid>
          <p className="text-xs text-navy/70">{u("partnerTermsHint")}</p>
          <button className={btnPrimary}>{t("save")}</button>
        </form>
      </Card>
      {s.ratings.length > 0 && <Card title={u("partnerRatings")}>
        <Table head={["POTH", u("rate_quality"), u("rate_onTime"), u("rate_price"), u("rate_cooperation"), u("partnerScore"), t("note"), u("executor")]}>
          {s.ratings.map((r) => <tr key={r.id}><td className="font-mono">{r.purchaseOrder?.no ?? ""}</td><td>{r.quality}</td><td>{r.onTime}</td><td>{r.price}</td><td>{r.cooperation}</td><td className="font-semibold">{ratingScore(r)}</td><td>{r.note ?? ""}</td><td>{r.by.name}</td></tr>)}
        </Table>
      </Card>}
      <Card title="POTH">
        <Table head={["POTH", t("type"), t("status"), "QTTH", t("amount"), t("date")]}>
          {s.orders.map((o) => <tr key={o.id}><td><Link href={`/purchasing/orders/${o.no}`} className="font-mono text-blue hover:underline">{o.no}</Link>{o.version > 1 ? ` v${o.version}` : ""}</td><td>{o.kind === "SUBCONTRACT" ? u("partnerRepair") : u("kindParts")}</td><td>{tPo(o.status)}</td><td>{o.serviceOrder ? <Link href={o.kind === "SUBCONTRACT" ? `/service-orders/${o.serviceOrder.no}/partner` : `/service-orders/${o.serviceOrder.no}`} className="font-mono text-blue hover:underline">{o.serviceOrder.no}</Link> : "—"}</td><td className="text-right">{o.currency} {Number(o.total).toFixed(2)}</td><td>{o.orderedAt.toISOString().slice(0, 10)}</td></tr>)}
        </Table>
      </Card>
      {s.invoices.length > 0 && <Card title={u("supplierInvoices")}>
        <Table head={[u("supplierInvoiceNo"), "POTH", t("date"), u("dueDate"), u("payableAmount"), t("status")]}>
          {s.invoices.map((i) => <tr key={i.id}><td className="font-mono">{i.invoiceNo}</td><td className="font-mono">{i.purchaseOrder.no}</td><td>{i.invoiceDate.toISOString().slice(0, 10)}</td><td>{i.dueDate.toISOString().slice(0, 10)}</td><td className="text-right">{i.currency} {Number(i.payable).toFixed(2)}</td><td><Tag hot={i.status === "OPEN"}>{u(`payable_${i.status}`)}</Tag>{i.paymentNo ? <span className="ml-1 font-mono text-xs">{i.paymentNo}</span> : null}</td></tr>)}
        </Table>
      </Card>}
    </div>
  );
}
