import { useTranslations } from "next-intl";

const ASSET_COLORS: Record<string, string> = {
  ONBOARDED: "bg-slate-200 text-slate-800", IN_SERVICE: "bg-emerald-100 text-emerald-800", MAINTENANCE: "bg-sky-100 text-sky-800",
  REPAIR: "bg-amber-100 text-amber-800", OVERHAUL: "bg-orange-100 text-orange-800", ACCEPTANCE: "bg-violet-100 text-violet-800",
  SPARE: "bg-slate-100 text-slate-700", RETIRED: "bg-slate-300 text-slate-700",
};
const ORDER_COLORS: Record<string, string> = {
  RECEIVED: "bg-slate-200 text-slate-800", ASSIGNED: "bg-sky-100 text-sky-800", DIAGNOSING: "bg-sky-100 text-sky-800", QUOTE_PENDING: "bg-amber-100 text-amber-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800", ACCEPTANCE_PENDING: "bg-violet-100 text-violet-800", ACCEPTED: "bg-emerald-100 text-emerald-800",
  INVOICED: "bg-emerald-100 text-emerald-800", CLOSED: "bg-slate-100 text-slate-700", CANCELLED: "bg-rose-100 text-rose-800",
};

export function AssetStatusBadge({ status }: { status: string }) {
  const t = useTranslations("assetStatus");
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ASSET_COLORS[status] ?? ""}`}>{t(status)}</span>;
}
export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations("orderStatus");
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ORDER_COLORS[status] ?? ""}`}>{t(status)}</span>;
}
