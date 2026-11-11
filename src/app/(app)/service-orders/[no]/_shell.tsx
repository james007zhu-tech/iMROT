/**
 * Shared frame for every step form under a service order (INTH, quote, PO, ERTH, RPTH, PMTH, DNTH, acceptance, invoice …):
 * back to the order top-left (rule ③), the order in brief, the upload/paste box (rule ④), then the form.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServiceOrder } from "@/server/slm";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { AssetTriple, FaultText, PageHeader, Tag, btnGhost, btnPrimary } from "@/components/ui";
import { OrderStatusBadge } from "@/components/StatusBadge";
import type { RecognizeKind } from "@/lib/recognize";
import { assetBriefing, orderContext } from "@/server/briefing";
import { AssetBrief } from "@/components/AssetBrief";

export type Order = NonNullable<Awaited<ReturnType<typeof getServiceOrder>>>;

export async function loadOrder(no: string): Promise<Order> {
  const o = await getServiceOrder(no);
  if (!o) notFound();
  return o;
}

/**
 * What a step form stands on. Usually a QTTH; for ERTH and INTH it may be the machines alone (设备优先, 朱总 2026-11-11):
 * then there is no order number or status, and `back` says where the form came from.
 */
export interface StepSubject {
  no?: string; id?: string; status?: Order["status"];
  assets: Order["assets"]; customer: { name: string }; plant?: { code: string } | null;
  customerRef?: string | null; reportedSymptom?: string | null; reportedAlarm?: string | null;
  back?: { href: string; label: string };
}

/** The machines themselves as the subject of a form: ERTH or INTH opened from the ATH. */
export async function assetSubject(codes: string[], back: { href: string; label: string }): Promise<StepSubject | null> {
  const found = await prisma.asset.findMany({ where: { code: { in: codes } }, include: { model: { include: { series: { include: { brand: true } } } }, customer: true, plant: true } });
  const assets = codes.map((c) => found.find((a) => a.code === c)).filter((a): a is (typeof found)[number] => !!a);
  if (!assets.length || !assets[0].customer) return null;
  return { assets: assets.map((asset, i) => ({ serviceOrderId: "", assetId: asset.id, isPrimary: i === 0, asset })), customer: assets[0].customer, plant: assets[0].plant, back };
}

export async function OrderBrief({ order }: { order: StepSubject }) {
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

export async function StepPage({ order, title, badge, formId = "f", kind, uploadTitle, uploadHint, lineFields, context, dictate, brief, saveLabel, extraActions, ok, error, notice, children }: {
  order: StepSubject; title: React.ReactNode; badge?: React.ReactNode; formId?: string; kind?: RecognizeKind; uploadTitle?: string; uploadHint?: string; lineFields?: Record<string, string>; context?: string; dictate?: boolean; /** show 这台设备的底细 for the first machine (field forms) */ brief?: boolean;
  saveLabel: string; extraActions?: React.ReactNode; ok?: string; error?: string; notice?: string; children: React.ReactNode;
}) {
  const t = await getTranslations("common"); // error codes and field names are translated by Flash
  // every step knows what the order already holds: the upload box and the i assistant both get it (no retyping)
  const ctx = context ?? (order.no ? await orderContext(order as Order).catch(() => undefined) : undefined);
  const back = order.back ?? { href: `/service-orders/${order.no}`, label: order.no ?? "" };
  const card = brief && order.assets[0] ? await assetBriefing(order.assets[0].asset.code, { symptom: order.reportedSymptom, alarm: order.reportedAlarm, orderId: order.id }).catch(() => null) : null;
  return (
    <div className="space-y-4">
      <PageHeader back={back} title={title} badge={badge ?? (order.status ? <OrderStatusBadge status={order.status} /> : undefined)}
        actions={<><Link href={back.href} className={btnGhost}>{t("cancel")}</Link>{extraActions}{saveLabel && <button form={formId} className={btnPrimary}>{saveLabel}</button>}</>} />
      <Flash ok={ok} error={error} />
      {notice && <div className="rounded-lg border border-alert bg-alert/10 px-4 py-2 text-sm text-alert-ink">{notice}</div>}
      <OrderBrief order={order} />
      <FormMemory formId={formId} />
      {kind && uploadTitle && <UploadRecognize kind={kind} formId={formId} title={uploadTitle} hint={uploadHint ?? ""} lineFields={lineFields} context={ctx} dictate={dictate} />}
      {!(kind && uploadTitle) && ctx && <div data-ai-context hidden>{ctx}</div>}
      {card && <AssetBrief brief={card} open={false} />}
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
