"use client";
/**
 * The quote adds itself up while it is typed (walk-through 2026-11-15: a sales person on a phone could not see the
 * total or the margin until after saving): amount before VAT, VAT, total, cost and margin — against the floor of the
 * business mode, so a quote that will need the MD's approval says so before it is saved.
 */
import { useEffect, useRef, useState } from "react";

export function QuoteSum({ rows, vatRate, floor, currency, labels, plain }: { plain?: boolean; rows: number; vatRate: number; floor: number; currency: string; labels: { subtotal: string; vat: string; total: string; cost: string; margin: string; below: string; noCost: string } }) {
  const ref = useRef<HTMLDivElement>(null);
  const [s, setS] = useState({ sub: 0, cost: 0, costed: true, any: false });
  useEffect(() => {
    const form = ref.current?.closest("form") ?? (document.getElementById(ref.current?.dataset.form ?? "") as HTMLFormElement | null) ?? document.querySelector("main form");
    if (!form) return;
    const n = (name: string) => { const el = form.elements.namedItem(name) as HTMLInputElement | null; const v = el ? parseFloat(el.value) : NaN; return Number.isFinite(v) ? v : null; };
    const sum = () => {
      let sub = 0, cost = 0, costed = true, any = false;
      for (let i = 0; i < rows; i++) { const q = n(`q${i}`), p = n(`p${i}`), c = n(`c${i}`); if (!q || p == null) continue; any = true; sub += q * p; if (c == null) costed = false; else cost += q * c; }
      setS({ sub, cost, costed, any });
    };
    sum();
    form.addEventListener("input", sum);
    const t = setInterval(sum, 1000); // the assistant and the upload box write values without an event
    return () => { form.removeEventListener("input", sum); clearInterval(t); };
  }, [rows]);
  const f = (x: number) => x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const margin = s.sub > 0 && s.costed ? (s.sub - s.cost) / s.sub : null;
  const low = margin != null && margin < floor;
  return (
    <div ref={ref} className={`sticky bottom-2 z-10 rounded-xl border bg-white/95 p-3 text-sm shadow-md backdrop-blur ${low && !plain ? "border-alert" : ""}`}>
      {!s.any ? <span className="text-navy/60">{labels.total}: —</span> : (
        <div className={`grid grid-cols-2 gap-x-4 gap-y-1 ${plain ? "md:grid-cols-3" : "md:grid-cols-5"}`}>
          <span>{labels.subtotal}<b className="block font-mono">{f(s.sub)}</b></span>
          <span>{labels.vat}<b className="block font-mono">{f(s.sub * vatRate)}</b></span>
          <span>{labels.total} ({currency})<b className="block font-mono text-base text-navy">{f(s.sub * (1 + vatRate))}</b></span>
          {!plain && <span>{labels.cost}<b className="block font-mono">{s.costed ? f(s.cost) : "—"}</b></span>}
          {!plain && <span className={low ? "text-alert-ink" : ""}>{labels.margin}<b className="block font-mono">{margin == null ? labels.noCost : `${(margin * 100).toFixed(1)}%`}</b>{low && <span className="text-xs">{labels.below}</span>}</span>}
        </div>
      )}
    </div>
  );
}
