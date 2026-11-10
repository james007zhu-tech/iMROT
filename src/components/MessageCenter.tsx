import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ASKABLE, type Notice } from "@/lib/notify";

/**
 * 消息中心 (top right, 朱总 2026-11-10): the bell shows how many things want this person's attention; red when
 * something is already late. Each line opens its record; "ask" hands it to the assistant on the home page.
 */
export async function MessageCenter({ notices }: { notices: Notice[] }) {
  const t = await getTranslations("msg");
  const late = notices.filter((n) => n.level === "late").length;
  const when = (n: Notice) => (n.days < 0 ? t("lateN", { n: -n.days }) : n.days === 0 ? t("today") : t("inN", { n: n.days }));
  return (
    <details className="group relative">
      <summary className="relative flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-navy/25 bg-white text-navy hover:bg-tint [&::-webkit-details-marker]:hidden" aria-label={t("title")} title={t("title")}>
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></svg>
        {notices.length > 0 && <span className={`absolute -right-1.5 -top-1.5 min-w-[18px] rounded-full px-1 text-center text-[11px] font-bold leading-[18px] text-white ${late ? "bg-alert" : "bg-blue"}`}>{notices.length}</span>}
      </summary>
      <div className="absolute right-0 top-11 z-50 w-[min(92vw,26rem)] rounded-xl border bg-white shadow-xl">
        <div className="flex items-baseline justify-between border-b px-4 py-2.5"><b className="text-navy">{t("title")}</b><span className="text-xs text-navy/60">{late ? t("lateCount", { n: late }) : t("count", { n: notices.length })}</span></div>
        <div className="max-h-[70vh] overflow-y-auto">
          {notices.length === 0 && <p className="px-4 py-6 text-center text-sm text-navy/60">{t("none")}</p>}
          {notices.map((n) => (
            <div key={n.id} className="flex items-start gap-2 border-b border-hair px-4 py-2.5 last:border-0">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.level === "late" ? "bg-alert" : "bg-blue"}`} />
              <Link href={n.href} className="min-w-0 flex-1 text-[13.5px] leading-snug text-navy hover:text-blue">
                <span className="block">{t(`k_${n.kind}`, { ref: n.ref })}</span>
                <span className="block text-xs text-navy/60">{[n.who, when(n)].filter(Boolean).join("  ·  ")}</span>
              </Link>
              {ASKABLE.has(n.kind) && <Link href={`/home?ask=${encodeURIComponent(t(`ask_${n.kind}`, { ref: n.ref }))}`} className="shrink-0 rounded-full border border-blue/40 px-2 py-0.5 text-xs font-semibold text-blue hover:bg-blue hover:text-white">{t("ask")}</Link>}
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
