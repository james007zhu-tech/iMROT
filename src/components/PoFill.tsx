"use client";
import { useEffect, useState } from "react";

export type PoChoice = { no: string; label: string; orderNo: string; customer: string; lines: { sku: string; qty: number }[] };

/**
 * 贸易出库从采购单带出 (朱总 2026-11-15). Choosing a POTH on the stock form fills the part numbers and quantities it
 * brought in, the order it was bought for and the customer — no machine to pick: goods sold are not fitted into one.
 * Clearing the choice gives the form back as it was typed.
 */
export function PoFill({ formId, choices, sku, qty, orderField, assetWrap, labels }: { formId: string; choices: PoChoice[]; sku: string; qty: string; orderField: string; assetWrap: string; labels: { pick: string; none: string; filled: string } }) {
  const [po, setPo] = useState("");
  const chosen = choices.find((c) => c.no === po);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const set = (name: string, v: string) => { const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null; if (!el) return; el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); };
    const wrap = document.getElementById(assetWrap);
    if (wrap) wrap.style.display = chosen ? "none" : "";
    if (!chosen) return;
    set("direction", "OUT"); set(orderField, chosen.orderNo); set("assetCode", "");
    for (let i = 0; form.elements.namedItem(`${sku}${i}`); i++) { const l = chosen.lines[i]; set(`${sku}${i}`, l?.sku ?? ""); set(`${qty}${i}`, l ? String(l.qty) : ""); }
    window.dispatchEvent(new Event("draft-restored")); // RevealRows shows every row that now holds a value
  }, [chosen, formId, sku, qty, orderField, assetWrap]);
  if (!choices.length) return null;
  return (
    <div className="rounded-lg border border-blue/40 bg-[#F4F8FD] p-3">
      <label className="block text-sm font-semibold text-navy">{labels.pick}
        <select value={po} onChange={(e) => setPo(e.target.value)} className="mt-1 block min-h-11 w-full rounded-lg border border-navy/25 bg-white px-2 text-sm font-normal">
          <option value="">{labels.none}</option>{choices.map((c) => <option key={c.no} value={c.no}>{c.label}</option>)}
        </select></label>
      {chosen && <p className="mt-1 text-[13px] text-navy">✓ {labels.filled.replace("{order}", chosen.orderNo).replace("{customer}", chosen.customer).replace("{n}", String(chosen.lines.length))}</p>}
    </div>
  );
}
