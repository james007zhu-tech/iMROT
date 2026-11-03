import { useTranslations } from "next-intl";
import { ORDER_STATUSES, portalStep, type OrderStatus } from "@/lib/lifecycle";

/** The nine words the customer sees. Same component in the internal page and the portal. */
export function OrderProgress({ status }: { status: OrderStatus }) {
  const t = useTranslations("orderStatus");
  const step = portalStep(status);
  const visible = ORDER_STATUSES.filter((s) => s !== "CANCELLED");
  if (step < 0) return <div className="rounded border border-alert bg-alert/10 px-3 py-2 text-sm text-alert-ink">{t("CANCELLED")}</div>;
  return (
    <ol className="flex flex-wrap gap-1 text-xs">
      {visible.map((s, i) => (
        <li key={s} className={`flex items-center gap-1 rounded-full px-2 py-1 ${i < step ? "border border-navy/30 bg-blue/12 text-navy" : i === step ? "border border-blue bg-blue text-white" : "border border-navy/30 bg-white text-navy/70"}`}>
          <span className="font-mono">{i + 1}</span>{t(s)}
        </li>
      ))}
    </ol>
  );
}
