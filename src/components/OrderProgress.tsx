import { useTranslations } from "next-intl";
import { OFF_TRACK, ORDER_STATUSES, portalStep, type OrderStatus } from "@/lib/lifecycle";

/** The nine words the customer sees. Same component in the internal page and the portal.
 *  A declined order (客户拒绝报价) never walks the nine words: it shows "客户拒绝报价", then "· 已完成" once closed. */
export function OrderProgress({ status, declined = false }: { status: OrderStatus; declined?: boolean }) {
  const t = useTranslations("orderStatus");
  const step = portalStep(status);
  const visible = ORDER_STATUSES.filter((s) => !OFF_TRACK.includes(s));
  if (declined) return <div className="rounded border border-alert bg-alert/10 px-3 py-2 text-sm text-alert-ink">{t("DECLINED")}{status === "CLOSED" ? ` · ${t("CLOSED")}` : ""}</div>;
  if (step < 0) return <div className="rounded border border-alert bg-alert/10 px-3 py-2 text-sm text-alert-ink">{t(status)}</div>;
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
