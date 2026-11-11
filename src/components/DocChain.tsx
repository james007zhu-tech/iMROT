import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ChainSlot } from "@/lib/doc-chain";
import { DOC_PLACES } from "@/lib/doc-center";

/**
 * 单据链: one strip across the order page — every document this kind of order walks through, which exist (with
 * their numbers, each a link), which one is next, and which are optional. Scrolls sideways on a phone.
 */
export function DocChain({ order, slots }: { order: string; slots: ChainSlot[] }) {
  const t = useTranslations("chain");
  const href = (type: string, no: string) => type === "CPO" ? `/service-orders/${order}/confirm` : type === "AC" ? `/service-orders/${order}/accept` : DOC_PLACES[type]?.open(no, order) ?? `/search?q=${no}`;
  return (
    <section aria-label={t("title")} className="rounded-xl border bg-white px-3 py-2.5">
      <div className="mb-1.5 flex items-baseline gap-2 text-xs"><span className="font-semibold text-navy">{t("title")}</span><span className="text-navy/60">{t("hint")}</span></div>
      <ol className="flex items-stretch gap-1 overflow-x-auto pb-1 text-xs">
        {slots.map((s, i) => (
          <li key={s.key} className="flex shrink-0 items-stretch gap-1">
            {i > 0 && <span aria-hidden className={`self-center ${s.done ? "text-navy" : "text-navy/30"}`}>→</span>}
            <div className={`min-w-[5.5rem] rounded-lg border px-2 py-1 ${s.done ? "border-navy/30 bg-blue/10" : s.next ? "border-blue bg-white ring-1 ring-blue" : s.optional ? "border-dashed border-navy/25 bg-white text-navy/50" : "border-navy/25 bg-white text-navy/60"}`}>
              <div className={`font-semibold ${s.next ? "text-blue" : s.done ? "text-navy" : ""}`}>{t(s.key)}{s.next ? ` · ${t("next")}` : ""}</div>
              {s.docs.length === 0 ? <div className="text-[11px]">{s.optional ? t("optional") : "—"}</div>
                : s.docs.map((d) => <Link key={d.no} href={href(d.type, d.no)} className="block font-mono text-[11px] text-blue hover:underline">{d.no}{d.date ? <span className="ml-1 font-sans text-navy/60">{d.date.slice(5)}</span> : null}</Link>)}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
