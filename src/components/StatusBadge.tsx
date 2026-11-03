import { useTranslations } from "next-intl";

// Navy/blue family; orange only for states that need someone's attention (rule ②).
const CALM = "border border-navy/35 bg-blue/8 text-navy";
const ACTIVE = "border border-blue bg-blue/15 text-navy";
const HOT = "border border-alert bg-alert/15 text-alert-ink";
const MUTED = "border border-navy/25 bg-white text-navy/60";
const ASSET_COLORS: Record<string, string> = {
  ONBOARDED: CALM, IN_SERVICE: CALM, MAINTENANCE: ACTIVE, REPAIR: HOT, OVERHAUL: ACTIVE, ACCEPTANCE: HOT, SPARE: MUTED, RETIRED: MUTED,
};
const ORDER_COLORS: Record<string, string> = {
  RECEIVED: HOT, ASSIGNED: ACTIVE, DIAGNOSING: ACTIVE, QUOTE_PENDING: HOT, IN_PROGRESS: ACTIVE, ACCEPTANCE_PENDING: HOT,
  ACCEPTED: CALM, INVOICED: CALM, CLOSED: MUTED, CANCELLED: MUTED,
};

export function AssetStatusBadge({ status }: { status: string }) {
  const t = useTranslations("assetStatus");
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ASSET_COLORS[status] ?? ""}`}>{t(status)}</span>;
}
export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations("orderStatus");
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_COLORS[status] ?? ""}`}>{t(status)}</span>;
}
