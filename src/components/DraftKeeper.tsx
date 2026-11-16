"use client";
/**
 * 保存失败不得丢单 (需求清单 v3 P0-05). Every form a person is filling in is copied to this browser — ten seconds after
 * the last keystroke at the latest, and at the moment of saving. When a save does not arrive (the network dropped, the
 * server did not answer, a release was going on), nothing typed is lost:
 *   · the failure screen (app/(app)/error.tsx) sends the person back to the form with everything in it;
 *   · opening the same page again — even after closing the browser — offers the draft: 恢复 / 丢掉.
 * A draft is dropped once its form has been saved (the app moved on, or came back with ✓). Passwords and files are never
 * kept. Drafts stay on this device only.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

type Values = Record<string, string | boolean>;
type Draft = { at: number; values: Values };
const PREFIX = "dcit-draft:", PENDING = "dcit-draft-pending", RESTORE = "dcit-draft-restore";
const MAX_AGE = 3 * 86400000;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
function fields(form: HTMLFormElement): Field[] {
  return (Array.from(form.elements) as Field[]).filter((el) => !!el.name && !el.name.startsWith("$") && !(el instanceof HTMLButtonElement)
    && !["submit", "button", "reset", "image", "file", "password"].includes((el as HTMLInputElement).type));
}
/** Forms worth keeping: something a person types into — not a search box, not a one-button action. */
function keepable(form: HTMLFormElement) {
  if (form.dataset.nodraft != null || (form.getAttribute("method") ?? "").toLowerCase() === "get" || form.getAttribute("action") === "/search") return false;
  return fields(form).filter((el) => (el as HTMLInputElement).type !== "hidden").length >= 2;
}
const keyOf = (path: string, form: HTMLFormElement, i: number) => `${PREFIX}${path}:${form.id || `#${i}`}`;
function read(form: HTMLFormElement): Values {
  const v: Values = {};
  for (const el of fields(form)) {
    const t = (el as HTMLInputElement).type;
    if (t === "radio") { if ((el as HTMLInputElement).checked) v[el.name] = el.value; continue; }
    v[el.name] = t === "checkbox" ? (el as HTMLInputElement).checked : el.value;
  }
  return v;
}
/** Put the values back so that React-controlled fields notice too (native setter + the events React listens to). */
function write(form: HTMLFormElement, values: Values) {
  for (const el of fields(form)) {
    if (!(el.name in values)) continue;
    const t = (el as HTMLInputElement).type, want = values[el.name];
    if (t === "checkbox" || t === "radio") {
      const on = t === "checkbox" ? want === true : el.value === want;
      if ((el as HTMLInputElement).checked !== on) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked")?.set?.call(el, on); el.dispatchEvent(new Event("click", { bubbles: true })); }
      continue;
    }
    if (el.value === String(want)) continue;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, String(want));
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

export function DraftKeeper({ labels }: { labels: { found: string; restore: string; drop: string; restored: string } }) {
  const path = usePathname(), search = useSearchParams().toString();
  const [offer, setOffer] = useState<{ key: string; at: number }[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    const sp = new URLSearchParams(search), failed = sp.has("error");
    let back = false;
    try {
      back = sessionStorage.getItem(RESTORE) === "1"; sessionStorage.removeItem(RESTORE);
      // the save that was under way arrived: the app moved on, or came back to the same page with ✓
      const pending = JSON.parse(localStorage.getItem(PENDING) ?? "null") as { key: string; path: string } | null;
      if (pending && !failed && !back && (pending.path !== path || sp.has("ok"))) { localStorage.removeItem(pending.key); localStorage.removeItem(PENDING); }
      for (let i = localStorage.length - 1; i >= 0; i--) { // old drafts go
        const k = localStorage.key(i); if (!k?.startsWith(PREFIX)) continue;
        const d = JSON.parse(localStorage.getItem(k) ?? "null") as Draft | null; if (!d || Date.now() - d.at > MAX_AGE) localStorage.removeItem(k);
      }
    } catch { return; }

    const dirty = new Set<HTMLFormElement>();
    const forms = () => Array.from(document.forms).filter(keepable);
    const save = (form: HTMLFormElement) => { try { localStorage.setItem(keyOf(path, form, Array.from(document.forms).indexOf(form)), JSON.stringify({ at: Date.now(), values: read(form) } satisfies Draft)); } catch { /* storage full or off */ } };

    // what was left behind on this page
    const t0 = setTimeout(() => {
      const found: { key: string; at: number }[] = [];
      for (const form of forms()) {
        const key = keyOf(path, form, Array.from(document.forms).indexOf(form));
        let d: Draft | null = null; try { d = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { /* ignore */ }
        if (!d) continue;
        if (failed || back) { write(form, d.values); dirty.add(form); window.dispatchEvent(new CustomEvent("draft-restored", { detail: form.id })); if (back) setNote(labels.restored); }
        else found.push({ key, at: d.at });
      }
      setOffer(found);
    }, 300); // after the page's own fields have mounted

    let timer: ReturnType<typeof setTimeout> | undefined;
    const onInput = (e: Event) => {
      const form = (e.target as HTMLElement | null)?.closest?.("form") as HTMLFormElement | null;
      if (!form || !keepable(form) || !e.isTrusted) return;
      dirty.add(form); setOffer((o) => o.filter((x) => x.key !== keyOf(path, form, Array.from(document.forms).indexOf(form))));
      clearTimeout(timer); timer = setTimeout(() => dirty.forEach(save), 2000);
    };
    const every = setInterval(() => dirty.forEach(save), 10000);
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!keepable(form)) return;
      save(form);
      try { localStorage.setItem(PENDING, JSON.stringify({ key: keyOf(path, form, Array.from(document.forms).indexOf(form)), path })); } catch { /* ignore */ }
    };
    document.addEventListener("input", onInput, true); document.addEventListener("change", onInput, true); document.addEventListener("submit", onSubmit, true);
    return () => { clearTimeout(t0); clearTimeout(timer); clearInterval(every); document.removeEventListener("input", onInput, true); document.removeEventListener("change", onInput, true); document.removeEventListener("submit", onSubmit, true); };
  }, [path, search, labels.restored]);

  const restore = () => {
    for (const form of Array.from(document.forms).filter(keepable)) {
      const key = keyOf(path, form, Array.from(document.forms).indexOf(form));
      if (!offer.some((o) => o.key === key)) continue;
      try { const d = JSON.parse(localStorage.getItem(key) ?? "null") as Draft | null; if (d) { write(form, d.values); window.dispatchEvent(new CustomEvent("draft-restored", { detail: form.id })); } } catch { /* ignore */ }
    }
    setOffer([]); setNote(labels.restored);
  };
  const drop = () => { try { for (const o of offer) localStorage.removeItem(o.key); localStorage.removeItem(PENDING); } catch { /* ignore */ } setOffer([]); };

  if (note && !offer.length) return <div className="mb-3 rounded-lg border border-blue bg-blue/8 px-4 py-2 text-sm text-navy" role="status">✓ {note}</div>;
  if (!offer.length) return null;
  const at = new Date(Math.max(...offer.map((o) => o.at)));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-4 py-2 text-sm text-[#7A4A00]" role="status">
      <span>{labels.found.replace("{time}", `${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`)}</span>
      <button type="button" onClick={restore} className="rounded-lg bg-navy px-3 py-1.5 font-semibold text-white">{labels.restore}</button>
      <button type="button" onClick={drop} className="rounded-lg border border-navy/40 bg-white px-3 py-1.5">{labels.drop}</button>
    </div>
  );
}
