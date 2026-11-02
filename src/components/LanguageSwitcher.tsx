"use client";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { setLocale } from "@/i18n/actions";
import type { Locale } from "@/i18n/request";

const LABELS: Record<Locale, string> = { th: "ไทย", zh: "中文", en: "EN" };

/** Top-right language switch; sets the cookie and refreshes server components. */
export function LanguageSwitcher() {
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-1 text-sm">
      {(Object.keys(LABELS) as Locale[]).map((l) => (
        <button
          key={l}
          disabled={pending}
          onClick={() => start(async () => { await setLocale(l); router.refresh(); })}
          className={`rounded px-2 py-1 ${l === locale ? "bg-white/20 font-bold" : "hover:bg-white/10"}`}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}
