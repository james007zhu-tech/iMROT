"use client";
/**
 * Server actions redirect back with ?error= on failure, which would wipe what was typed.
 * This keeps a copy of the form in sessionStorage on submit and puts it back when the same page returns with an error.
 */
import { useEffect } from "react";

export function FormMemory({ formId }: { formId: string }) {
  useEffect(() => {
    const key = `draft:${location.pathname}:${formId}`;
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const failed = new URLSearchParams(location.search).has("error");
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && failed) {
        const values = JSON.parse(saved) as Record<string, string | boolean>;
        for (const el of fields(form)) {
          if (!(el.name in values) || (el as HTMLInputElement).type === "file") continue;
          if ((el as HTMLInputElement).type === "checkbox") (el as HTMLInputElement).checked = values[el.name] === true;
          // a radio group shares one name: tick the one whose value was chosen, never overwrite the values themselves
          else if ((el as HTMLInputElement).type === "radio") (el as HTMLInputElement).checked = el.value === values[el.name];
          else el.value = String(values[el.name]);
        }
        window.dispatchEvent(new CustomEvent("draft-restored", { detail: formId }));
      }
      if (!failed) sessionStorage.removeItem(key);
    } catch { /* storage unavailable: nothing to restore */ }
    const onSubmit = () => {
      const values: Record<string, string | boolean> = {};
      for (const el of fields(form)) {
        if ((el as HTMLInputElement).type === "file" || (el as HTMLInputElement).type === "password") continue;
        if ((el as HTMLInputElement).type === "radio") { if ((el as HTMLInputElement).checked) values[el.name] = el.value; continue; }
        values[el.name] = (el as HTMLInputElement).type === "checkbox" ? (el as HTMLInputElement).checked : el.value;
      }
      try { sessionStorage.setItem(key, JSON.stringify(values)); } catch { /* ignore */ }
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [formId]);
  return null;
}

/** The form's data fields. Buttons are left out: a button's value says which action was clicked (e.g. draft=1) and must never be saved or restored. */
function fields(form: HTMLFormElement) {
  return (Array.from(form.elements) as (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement)[])
    .filter((el): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => !!el.name && !(el instanceof HTMLButtonElement) && !["submit", "button", "reset", "image"].includes((el as HTMLInputElement).type));
}
