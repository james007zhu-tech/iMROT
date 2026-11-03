import { useTranslations } from "next-intl";

type Payload = Record<string, unknown> | null | undefined;
const REL: Record<string, string> = { DRIVES: "relationDrives", INSTALLED_IN: "relationInstalledIn", CONTROLLED_BY: "relationControlledBy", COUPLED_TO: "relationCoupledTo" };

/** Renders an asset event's one-liner in the viewer's language, using the structured payload where it exists. */
export function EventSummary({ type, summary, payload }: { type: string; summary: string; payload: Payload }) {
  const t = useTranslations("common");
  const ts = useTranslations("orderStatus");
  const tst = useTranslations("assetStatus");
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (type) {
    case "STATUS_CHANGED":
      if (p.orderStatusFrom && p.orderStatusTo) return <>{summary.split(" ")[0]} · {ts(String(p.orderStatusFrom))} → {ts(String(p.orderStatusTo))}</>;
      if (p.statusFrom && p.statusTo) return <>{tst(String(p.statusFrom))} → {tst(String(p.statusTo))}</>;
      return <>{summary}</>;
    case "ONBOARDED":
      return <>{p.origin ? t(String(p.origin)) : ""}{p.initialStatus ? ` · ${tst(String(p.initialStatus))}` : ""} · S/N {summary.split("S/N ").pop()}</>;
    case "ACCEPTED": {
      const st = String(p.status ?? "");
      const label = st === "ACCEPTED" ? t("accepted") : st === "CONDITIONAL" ? t("conditional") : st === "REJECTED" ? t("rejected") : st;
      const rest = summary.split(" · ").slice(1).join(" · ");
      return <>{label}{rest ? ` · ${rest}` : ""}</>;
    }
    case "QUOTED": {
      const n = /· (\d+) lines/.exec(summary)?.[1];
      return <>{summary.replace(/ · \d+ lines$/, "")}{n ? ` · ${n} ${t("quoteLines")}` : ""}</>;
    }
    case "INVOICED": return <>{summary.replace("incl. VAT", t("vat"))}</>;
    case "PAID": return <>{summary.replace("+ WHT", `+ ${t("wht")}`)}</>;
    case "TESTED": return <>{summary.replace(/pass$/, t("pass"))}</>;
    case "RELATION_CHANGED": {
      const m = /^(\S+) (DRIVES|INSTALLED_IN|CONTROLLED_BY|COUPLED_TO) (\S+)$/.exec(summary);
      return m ? <>{m[1]} {t(REL[m[2]])} {m[3]}</> : <>{summary}</>;
    }
    default: return <>{summary}</>;
  }
}
