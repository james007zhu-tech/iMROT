"use client";
/**
 * 保存失败的提示统一 (朱总 2026-11-15). The browser's own bubble ("Please fill out this field", in the browser's
 * language, one field at a time) is replaced: the top of the page says how many boxes still need attention, every one
 * of them turns red with the reason under it, and the page scrolls to the first. Marks clear as the boxes are filled.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function FormCheck() {
  const t = useTranslations("ui");
  const [state, setState] = useState<{ empty: number; wrong: number } | null>(null);
  useEffect(() => {
    let pending: HTMLFormElement | null = null;
    const why = (el: Field) => {
      const v = el.validity;
      if (v.valueMissing) return t("fcEmpty");
      if (v.rangeOverflow) return t("fcMax", { max: (el as HTMLInputElement).max });
      if (v.rangeUnderflow) return t("fcMin", { min: (el as HTMLInputElement).min });
      if (v.stepMismatch) return t("fcStep");
      if (v.tooShort) return t("fcShort", { n: (el as HTMLInputElement).minLength });
      if (v.typeMismatch && el.type === "email") return t("fcEmail");
      return t("fcFormat");
    };
    const unmark = (el: Element) => { el.classList.remove("field-bad"); el.removeAttribute("aria-invalid"); const m = el.nextElementSibling; if (m?.classList.contains("field-msg")) m.remove(); };
    const report = (form: HTMLFormElement) => {
      form.querySelectorAll(".field-bad").forEach(unmark);
      const bad = (Array.from(form.elements) as Field[]).filter((el) => el.willValidate && !el.validity.valid);
      if (!bad.length) { setState(null); return; }
      for (const el of bad) {
        el.classList.add("field-bad"); el.setAttribute("aria-invalid", "true");
        const m = document.createElement("span"); m.className = "field-msg"; m.textContent = why(el); el.insertAdjacentElement("afterend", m);
      }
      const empty = bad.filter((el) => el.validity.valueMissing).length;
      setState({ empty, wrong: bad.length - empty });
      // a box inside a closed <details> or a hidden row cannot be scrolled to: open what hides it first
      const first = bad[0];
      for (let p = first.parentElement; p; p = p.parentElement) if (p instanceof HTMLDetailsElement) p.open = true;
      first.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => first.focus({ preventScroll: true }), 350);
    };
    const onInvalid = (e: Event) => {
      const el = e.target as Field;
      if (!el.form) return;
      e.preventDefault(); // no browser bubble
      if (pending) return;
      pending = el.form;
      queueMicrotask(() => { const f = pending!; pending = null; report(f); });
    };
    const onInput = (e: Event) => {
      const el = e.target as Field;
      if (!el.classList?.contains("field-bad") || !el.validity.valid) return;
      unmark(el);
      const left = el.form ? el.form.querySelectorAll(".field-bad").length : 0;
      if (!left) setState(null);
      else { const all = Array.from(el.form!.querySelectorAll(".field-bad")) as Field[]; const empty = all.filter((x) => x.validity.valueMissing).length; setState({ empty, wrong: all.length - empty }); }
    };
    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", onInput, true);
    document.addEventListener("change", onInput, true);
    return () => { document.removeEventListener("invalid", onInvalid, true); document.removeEventListener("input", onInput, true); document.removeEventListener("change", onInput, true); };
  }, [t]);
  if (!state) return null;
  const parts = [state.empty ? t("fcTopEmpty", { n: state.empty }) : "", state.wrong ? t("fcTopWrong", { n: state.wrong }) : ""].filter(Boolean).join(t("fcTopJoin"));
  return <div role="alert" className="fixed inset-x-0 top-0 z-[79] bg-[#C0392B] px-4 py-2.5 text-center text-sm font-semibold text-white shadow-lg">{t("fcTop", { what: parts })}</div>;
}
