import { useTranslations } from "next-intl";
import { ORDER_STATUSES, portalStep, type OrderStatus } from "@/lib/lifecycle";

/** The nine words the customer sees. Same component in the internal page and the portal. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  const t = useTranslations("orderStatus");
  const step = portalStep(status);
  const visible = ORDER_STATUSES.filter((s) => s !== "CANCELLED");
  if (step < 0) return <div className="rounded bg-rose-100 px-3 py-2 text-sm text-rose-800">{t("CANCELLED")}</div>;
  return (
    <ol className="flex flex-wrap gap-1 text-xs">
      {visible.map((s, i) => (
        <li key={s} className={`flex items-center gap-1 rounded-full px-2 py-1 ${i < step ? "bg-emerald-100 text-emerald-800" : i === step ? "bg-blue text-white" : "bg-slate-100 text-slate-500"}`}>
          <span className="font-mono">{i + 1}</span>{t(s)}
        </li>
      ))}
    </ol>
  );
}
