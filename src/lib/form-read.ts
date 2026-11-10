/**
 * A form on the page as the AI sees it (朱总 2026-11-10: every form is filled by speaking, photographing or
 * handing over a document). One reader for the upload box and for the i assistant: every named field with its
 * label, kind, options and present value. Browser only.
 */
export type FormField = { name: string; label?: string; value?: string; options?: string[]; type?: string };
export type FormInfo = { title: string; context?: string; fields: FormField[] };

export function describeForm(form: HTMLFormElement): FormField[] {
  const fields: FormField[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(form.elements) as (HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement)[]) {
    if (el instanceof HTMLButtonElement || !el.name || seen.has(el.name) || el.name.startsWith("$")) continue;
    if (el instanceof HTMLInputElement && ["hidden", "file", "submit", "button", "password"].includes(el.type)) continue;
    seen.add(el.name);
    const label = el.closest("label")?.querySelector("span")?.textContent?.replace(/\*/g, "").trim() || (el as HTMLInputElement).placeholder || el.getAttribute("aria-label") || undefined;
    const value = el instanceof HTMLInputElement && el.type === "checkbox" ? (el.checked ? "yes" : "") : el.value;
    const idx = /(\d+)$/.exec(el.name)?.[1];
    if (idx && Number(idx) > 5 && !value.trim()) continue; // far-down empty rows of a repeating table
    fields.push({ name: el.name, label, value: value || undefined, type: el instanceof HTMLSelectElement ? undefined : el instanceof HTMLTextAreaElement ? "long text" : (el as HTMLInputElement).type, // a choice is sent as "value = what the person sees", so the model can match a name to an id — or see that it cannot
      options: el instanceof HTMLSelectElement ? Array.from(el.options).filter((o) => o.value).slice(0, 40).map((o) => (o.text.trim() && o.text.trim() !== o.value ? `${o.value} = ${o.text.trim().slice(0, 40)}` : o.value)) : undefined });
    if (fields.length >= 140) break;
  }
  return fields;
}

/** The main form of the page: the one with the most fields. */
export function readForm(): FormInfo | null {
  const forms = Array.from(document.querySelectorAll<HTMLFormElement>("main form")).filter((f) => f.querySelectorAll("input:not([type=hidden]),textarea,select").length >= 3);
  const form = forms.sort((a, b) => b.elements.length - a.elements.length)[0];
  if (!form) return null;
  return { title: document.querySelector("main h1")?.textContent?.trim() ?? document.title, context: document.querySelector("[data-ai-context]")?.textContent ?? undefined, fields: describeForm(form) };
}
