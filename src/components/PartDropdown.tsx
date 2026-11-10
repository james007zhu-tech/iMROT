"use client";
/**
 * 料号 and 品名 as a real drop-down (朱总 2026-11-10: a phone shows no list for a plain text box). Mounted once per
 * form; it serves every row. Tapping or typing in a row's SKU or name box opens the parts list under it (the
 * model's own parts first, with stock), filtered by what is typed — SKU, maker's number or name. Choosing one fills
 * the row's SKU, name, Thai name and unit. A part that is not in the list can still be typed.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export interface PartOption { sku: string; vendorPartNo?: string | null; name: string; nameLocal?: string | null; unit?: string | null; onHand?: number; own?: boolean }

export function PartDropdown({ formId, parts, sku, name, local, unit, vendor, labels }: {
  formId: string; parts: PartOption[]; sku: string; name?: string; local?: string; unit?: string; vendor?: string; labels: { none: string; onHand: string; own: string };
}) {
  const [at, setAt] = useState<{ el: HTMLInputElement; i: string; top: number; left: number; width: number } | null>(null);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const rowOf = (el: EventTarget | null) => {
      if (!(el instanceof HTMLInputElement) || el.form !== form) return null;
      const m = new RegExp(`^(?:${[sku, name].filter(Boolean).join("|")})(\\d+)$`).exec(el.name);
      return m ? { el, i: m[1] } : null;
    };
    const place = (el: HTMLInputElement, i: string) => { const r = el.getBoundingClientRect(); const w = Math.min(Math.max(r.width, 300), window.innerWidth - 16); setAt({ el, i, top: r.bottom + window.scrollY + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + window.scrollX, width: w }); };
    const open = (e: Event) => { const r = rowOf(e.target); if (!r) return; r.el.removeAttribute("list"); r.el.autocomplete = "off"; setQ(e.type === "input" ? r.el.value : ""); place(r.el, r.i); };
    const close = (e: Event) => { if (box.current?.contains(e.target as Node) || rowOf(e.target)) return; setAt(null); };
    form.addEventListener("focusin", open); form.addEventListener("input", open);
    document.addEventListener("pointerdown", close);
    return () => { form.removeEventListener("focusin", open); form.removeEventListener("input", open); document.removeEventListener("pointerdown", close); };
  }, [formId, sku, name]);

  const found = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (p: PartOption) => { const h = `${p.sku} ${p.vendorPartNo ?? ""} ${p.name} ${p.nameLocal ?? ""}`.toLowerCase(); return words.every((w) => h.includes(w)); };
    return parts.filter(hit).slice(0, 30);
  }, [q, parts]);

  function pick(p: PartOption) {
    if (!at) return;
    const form = at.el.form!;
    const set = (prefix: string | undefined, v: string | null | undefined, keep = false) => {
      const el = prefix ? (form.elements.namedItem(`${prefix}${at.i}`) as HTMLInputElement | null) : null;
      if (!el || v == null || (keep && el.value.trim())) return;
      el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    setAt(null); // close first: the writes below fire `input`, which would reopen the list
    setTimeout(() => { set(sku, p.sku); set(name, p.name); set(local, p.nameLocal ?? "", true); set(unit, p.unit); set(vendor, p.vendorPartNo); setAt(null); }, 0);
  }

  if (!at) return null;
  return (
    <div ref={box} style={{ position: "absolute", top: at.top, left: at.left, width: at.width }} className="z-50 max-h-72 overflow-y-auto rounded-xl border border-navy/25 bg-white p-1 shadow-2xl">
      {found.map((p) => (
        <button type="button" key={p.sku} onPointerDown={(e) => e.preventDefault()} onClick={() => pick(p)} className="block w-full rounded-lg px-3 py-2 text-left hover:bg-[#EEF3F9] active:bg-[#EEF3F9]">
          <span className="block text-[14.5px] font-semibold text-navy">{p.name}{p.own ? <span className="ml-2 rounded bg-blue/10 px-1.5 py-0.5 text-[11px] font-normal text-blue">{labels.own}</span> : null}</span>
          <span className="block text-xs text-navy/60"><span className="font-mono">{p.sku}</span>{p.onHand !== undefined ? <span className={p.onHand > 0 ? "" : "font-semibold text-alert-ink"}>  ·  {labels.onHand} {p.onHand}</span> : null}</span>
        </button>
      ))}
      {found.length === 0 && <p className="px-3 py-2 text-sm text-navy/60">{labels.none}</p>}
    </div>
  );
}
