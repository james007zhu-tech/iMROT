/**
 * Shared frame for every step form under a service order (INTH, quote, PO, ERTH, RPTH, PMTH, DNTH, acceptance, invoice …):
 * back to the order top-left (rule ③), the order in brief, the upload/paste box (rule ④), then the form.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServiceOrder } from "@/server/slm";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { AssetTriple, FaultText, PageHeader, Tag, btnGhost, btnPrimary } from "@/components/ui";
import { OrderStatusBadge } from "@/components/StatusBadge";
import type { RecognizeKind } from "@/lib/recognize";

export type Order = NonNullable<Awaited<ReturnType<typeof getServiceOrder>>>;

export async function loadOrder(no: string): Promise<Order> {
  const o = await getServiceOrder(no);
  if (!o) notFound();
  return o;
}

export async function OrderBrief({ order }: { order: Order }) {
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-2 rounded-xl border bg-white px-4 py-3 text-sm">
      {order.assets.map((l) => <AssetTriple key={l.assetId} asset={l.asset} />)}
      <div className="flex flex-col"><span className="text-xs text-navy/70">{u("customerPlantLocation")}</span><span>{order.customer.name}{order.plant ? ` · ${order.plant.code}` : ""}{order.assets[0]?.asset.location ? ` · ${order.assets[0].asset.location}` : ""}</span></div>
      {order.customerRef && <div className="flex flex-col"><span className="text-xs text-navy/70">{t("customerRef")}</span><span className="font-mono">{order.customerRef}</span></div>}
      {order.reportedSymptom && <div className="flex max-w-md flex-col"><span className="text-xs text-navy/70">{t("symptom")}</span><FaultText>{order.reportedSymptom}{order.reportedAlarm ? ` · ${order.reportedAlarm}` : ""}</FaultText></div>}
    </div>
  );
}

export async function StepPage({ order, title, badge, formId = "f", kind, uploadTitle, uploadHint, saveLabel, extraActions, ok, error, notice, children }: {
  order: Order; title: React.ReactNode; badge?: React.ReactNode; formId?: string; kind?: RecognizeKind; uploadTitle?: string; uploadHint?: string;
  saveLabel: string; extraActions?: React.ReactNode; ok?: string; error?: string; notice?: string; children: React.ReactNode;
}) {
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  // Services throw stable codes ("DELIVERY_MISMATCH:…"); show them in the viewer's language when we have a text for them.
  const [code, ...rest] = (error ?? "").split(":");
  const shown = error && /^[A-Z_]+$/.test(code) && u.has(`err_${code}`) ? u(`err_${code}`, { detail: rest.join(":") }) : error;
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/service-orders/${order.no}`, label: order.no }} title={title} badge={badge ?? <OrderStatusBadge status={order.status} />}
        actions={<><Link href={`/service-orders/${order.no}`} className={btnGhost}>{t("cancel")}</Link>{extraActions}{saveLabel && <button form={formId} className={btnPrimary}>{saveLabel}</button>}</>} />
      <Flash ok={ok} error={shown} />
      {notice && <div className="rounded-lg border border-alert bg-alert/10 px-4 py-2 text-sm text-alert-ink">{notice}</div>}
      <OrderBrief order={order} />
      <FormMemory formId={formId} />
      {kind && uploadTitle && <UploadRecognize kind={kind} formId={formId} title={uploadTitle} hint={uploadHint ?? ""} />}
      {children}
    </div>
  );
}

export function NumTag({ children }: { children: React.ReactNode }) {
  return <Tag><span className="font-mono">{children}</span></Tag>;
}

/** Attachments JSON posted by the upload box. */
export function atts(f: FormData): { name: string; url: string; kind: string }[] {
  try { return JSON.parse(String(f.get("attachments") || "[]")); } catch { return []; }
}
export const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
export const num = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v ? Number(v) : undefined; };
export { dayNow } from "@/lib/dates";
