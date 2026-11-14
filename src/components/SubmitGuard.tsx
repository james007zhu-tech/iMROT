"use client";
/**
 * One save per click (trial finding 2026-11-14: a save that seemed stuck was pressed again, and it had been saved the
 * first time). While a form is on its way the page says so, its buttons stop answering, and a second submit of the
 * same form is refused. After 15 s it adds that the network is slow and where to look before trying again.
 * The buttons are not disabled — a disabled button would drop its own name and value from what is sent.
 */
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export function SubmitGuard() {
  const t = useTranslations("common");
  const path = usePathname(), query = useSearchParams().toString();
  const [since, setSince] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);

  const clear = () => { setSince(null); setSlow(false); delete document.body.dataset.saving; document.querySelectorAll("form[data-busy]").forEach((f) => f.removeAttribute("data-busy")); };
  // the save answered: the address changed (the banner with ?ok= or ?error= is a new address too)
  useEffect(clear, [path, query]);
  // … or the request itself came back (a second save can land on the very same address)
  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const h = new Headers((args[1]?.headers as HeadersInit | undefined) ?? (args[0] instanceof Request ? args[0].headers : undefined));
      const isAction = h.has("next-action");
      try { return await real(...args); } finally { if (isAction) setTimeout(clear, 1200); }
    };
    return () => { window.fetch = real; };
  }, []);

  useEffect(() => {
    const on = (e: Event) => {
      const form = e.target as HTMLFormElement;
      const action = form.getAttribute("action") ?? "";
      if (action && !action.startsWith("javascript:")) return; // a plain link-like form (search) is not a save
      if (form.dataset.busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.defaultPrevented) return;
      form.dataset.busy = "1"; document.body.dataset.saving = "1";
      setSince(Date.now()); setSlow(false);
    };
    document.addEventListener("submit", on, true);
    return () => document.removeEventListener("submit", on, true);
  }, []);

  useEffect(() => {
    if (since == null) return;
    const a = setTimeout(() => setSlow(true), 15_000);
    // after three minutes the request is lost for good: let the form be used again
    const b = setTimeout(clear, 180_000);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [since]);

  if (since == null) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-[70] mx-auto w-fit max-w-[92vw] rounded-xl bg-navy px-4 py-3 text-sm text-white shadow-2xl">
      <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white align-[-1px]" />
      {t("savingNow")}{slow && <span className="mt-1 block text-xs text-white/85">{t("savingSlow")}</span>}
    </div>
  );
}
