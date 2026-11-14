"use client";
/**
 * One save per click (trial finding 2026-11-14: a save that seemed stuck was pressed again, and it had been saved the
 * first time). A save is a server action on its way — seen as its request, not as a form submit, so forms the page
 * handles itself (the assistant's box, searches) are left alone. While it travels the page says so, the save buttons
 * stop answering, and a second submit is refused. The assistant announces its own work on a form the same way.
 * The buttons are not disabled — a disabled button would drop its own name and value from what is sent.
 */
import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

export const ASSIST_BUSY = "dcit:assist-busy"; // window event, detail: boolean

export function SubmitGuard() {
  const t = useTranslations("common");
  const path = usePathname(), query = useSearchParams().toString();
  const [what, setWhat] = useState<"save" | "assist" | null>(null);
  const saves = useRef(0), assisting = useRef(false);

  const show = () => {
    const saving = saves.current > 0;
    if (saving) document.body.dataset.saving = "1"; else { delete document.body.dataset.saving; document.querySelectorAll("form[data-busy]").forEach((f) => f.removeAttribute("data-busy")); }
    setWhat(saving ? "save" : assisting.current ? "assist" : null);
  };
  // the save answered: the address changed (the banner with ?ok= or ?error= is a new address too)
  useEffect(() => { saves.current = 0; show(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [path, query]);

  useEffect(() => {
    const real = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const h = new Headers((args[1]?.headers as HeadersInit | undefined) ?? (args[0] instanceof Request ? args[0].headers : undefined));
      if (!h.has("next-action")) return real(...args);
      saves.current++; show();
      const lost = setTimeout(() => { saves.current = 0; show(); }, 180_000); // a request lost for good must not lock the page
      try { return await real(...args); } finally { clearTimeout(lost); setTimeout(() => { saves.current = Math.max(0, saves.current - 1); show(); }, 800); }
    };
    const submit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (document.body.dataset.saving || form.dataset.busy) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      // the instant between the click and the request: the same form is not taken twice
      form.dataset.busy = "1";
      setTimeout(() => { if (!saves.current) form.removeAttribute("data-busy"); }, 1000);
    };
    const assist = (e: Event) => { assisting.current = !!(e as CustomEvent<boolean>).detail; show(); };
    document.addEventListener("submit", submit, true);
    window.addEventListener(ASSIST_BUSY, assist);
    return () => { window.fetch = real; document.removeEventListener("submit", submit, true); window.removeEventListener(ASSIST_BUSY, assist); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!what) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-[70] mx-auto w-fit max-w-[92vw] rounded-xl bg-navy px-4 py-3 text-sm text-white shadow-2xl">
      <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white align-[-1px]" />
      {t(what === "save" ? "savingNow" : "assistFilling")}
    </div>
  );
}
