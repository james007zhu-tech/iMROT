"use client";
/**
 * Shows the part name under each SKU box on stock documents (wireframe: 名称 per line) and flags unknown SKUs in
 * orange before saving. One instance per form: it watches inputs marked data-sku and writes into the matching
 * [data-sku-name="<input name>"] element, so the part list is sent to the browser once, not once per row.
 */
import { useEffect } from "react";

export function SkuNames({ names, unknown, stock, stockLabels }: { names: Record<string, string>; unknown: string; stock?: Record<string, number>; stockLabels?: { onHand: string; over: string } }) {
  useEffect(() => {
    const lower = new Map(Object.entries(names).map(([k, v]) => [k.toLowerCase(), v]));
    const show = (el: HTMLInputElement) => {
      const out = document.querySelector<HTMLElement>(`[data-sku-name="${el.name}"]`);
      if (!out) return;
      const v = el.value.trim();
      const name = v ? lower.get(v.toLowerCase()) : undefined;
      out.textContent = !v ? "" : name ?? unknown;
      out.className = `block truncate text-xs ${!v ? "" : name ? "text-navy/70" : "font-semibold text-alert-ink"}`;
    };
    // N-40 (2026-11-18): on an issue (direction = OUT) the row says what is on hand and turns red when the quantity is more
    const low = stock ? new Map(Object.entries(stock).map(([k, v]) => [k.toLowerCase(), v])) : null;
    const check = (el: HTMLInputElement) => {
      if (!low || !stockLabels || !el.form) return;
      const i = el.name.replace(/^s/, ""), q = el.form.elements.namedItem(`q${i}`) as HTMLInputElement | null, dir = el.form.elements.namedItem("direction") as HTMLSelectElement | null;
      if (!q || !/^\d+$/.test(i)) return;
      let note = q.parentElement?.querySelector<HTMLElement>(`[data-stock-note="${i}"]`) ?? null;
      const have = low.get(el.value.trim().toLowerCase()), want = Number(q.value) || 0, out = dir?.value === "OUT";
      const over = out && have != null && want > have + 1e-9;
      q.classList.toggle("field-bad", over); q.setCustomValidity(over ? `${stockLabels.onHand} ${have}` : "");
      if (!out || have == null || !el.value.trim()) { note?.remove(); return; }
      if (!note) { note = document.createElement("span"); note.dataset.stockNote = i; q.insertAdjacentElement("afterend", note); }
      note.textContent = over ? `${stockLabels.onHand} ${have} · ${stockLabels.over} ${want - have}` : `${stockLabels.onHand} ${have}`;
      note.className = `row-note text-xs ${over ? "font-semibold text-[#C0392B]" : "text-navy/60"}`;
    };
    const checkAll = () => document.querySelectorAll<HTMLInputElement>("input[data-sku]").forEach(check);
    const onInput = (e: Event) => { const t = e.target as HTMLInputElement; if (t?.dataset && "sku" in t.dataset) { show(t); check(t); } else if (t?.name && (/^q\d+$/.test(t.name) || t.name === "direction")) checkAll(); };
    document.addEventListener("input", onInput); document.addEventListener("change", onInput);
    const refresh = () => { document.querySelectorAll<HTMLInputElement>("input[data-sku]").forEach(show); checkAll(); };
    window.addEventListener("draft-restored", refresh);
    refresh();
    return () => { document.removeEventListener("input", onInput); document.removeEventListener("change", onInput); window.removeEventListener("draft-restored", refresh); };
  }, [names, unknown, stock, stockLabels]);
  return null;
}
