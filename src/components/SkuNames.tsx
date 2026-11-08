"use client";
/**
 * Shows the part name under each SKU box on stock documents (wireframe: 名称 per line) and flags unknown SKUs in
 * orange before saving. One instance per form: it watches inputs marked data-sku and writes into the matching
 * [data-sku-name="<input name>"] element, so the part list is sent to the browser once, not once per row.
 */
import { useEffect } from "react";

export function SkuNames({ names, unknown }: { names: Record<string, string>; unknown: string }) {
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
    const onInput = (e: Event) => { const t = e.target as HTMLInputElement; if (t?.dataset && "sku" in t.dataset) show(t); };
    document.addEventListener("input", onInput);
    const refresh = () => document.querySelectorAll<HTMLInputElement>("input[data-sku]").forEach(show);
    window.addEventListener("draft-restored", refresh);
    refresh();
    return () => { document.removeEventListener("input", onInput); window.removeEventListener("draft-restored", refresh); };
  }, [names, unknown]);
  return null;
}
