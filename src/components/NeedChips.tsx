"use client";
/** 检测单: the model's own parts with stock on hand — one tap puts a part on the next empty "needs" row (no SKU to remember). */
export function NeedChips({ formId, parts, label, onHandLabel }: { formId: string; parts: { sku: string; name: string; position?: string | null; onHand: number }[]; label: string; onHandLabel: string }) {
  function add(p: { sku: string; name: string }) {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    for (let i = 0; i < 20; i++) {
      const sku = form.elements.namedItem(`ns${i}`) as HTMLInputElement | null;
      if (!sku) return;
      const desc = form.elements.namedItem(`nd${i}`) as HTMLInputElement;
      const qty = form.elements.namedItem(`nq${i}`) as HTMLInputElement;
      if (sku.value === p.sku) { qty.value = String((Number(qty.value) || 0) + 1); qty.dispatchEvent(new Event("input", { bubbles: true })); return; }
      if (sku.value.trim() || desc.value.trim()) continue;
      const row = sku.closest("[data-row]") as HTMLElement | null;
      if (row) row.hidden = false;
      sku.value = p.sku; desc.value = p.name; qty.value = "1";
      for (const el of [sku, desc, qty]) el.dispatchEvent(new Event("input", { bubbles: true }));
      sku.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
  }
  if (!parts.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px]">
      <span className="text-navy/70">{label}</span>
      {parts.map((p) => (
        <button type="button" key={`${p.sku}${p.position ?? ""}`} onClick={() => add(p)} className="rounded-full border border-navy/25 bg-white px-3 py-1.5 text-left hover:border-blue">
          ＋ {p.name}{p.position ? ` · ${p.position}` : ""} <span className={`text-xs ${p.onHand > 0 ? "text-navy/60" : "font-semibold text-alert-ink"}`}>{onHandLabel} {p.onHand}</span>
        </button>
      ))}
    </div>
  );
}
