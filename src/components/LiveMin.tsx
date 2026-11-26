"use client";
/**
 * 最低售价 notices that follow the typing (朱总 2026-11-26: after changing a price the notice still showed the old
 * one). The total at the foot of the quote already recalculates while it is typed (QuoteSum); these two were rendered
 * once from the saved lines, so the page contradicted itself until it was saved. Same rule as the server
 * (belowMinLines): 最低售价 = cost ÷ (1 − margin floor), a price is below it from half a satang under.
 */
import { useEffect, useRef, useState } from "react";

function useForm<T>(read: (n: (name: string) => number | null) => T, key: (v: T) => string, deps: unknown[]): [React.RefObject<HTMLSpanElement | null>, T | null] {
  const ref = useRef<HTMLSpanElement>(null);
  const [v, setV] = useState<T | null>(null);
  useEffect(() => {
    const form = ref.current?.closest("form") ?? document.querySelector("main form");
    if (!form) return;
    const n = (name: string) => { const el = (form as HTMLFormElement).elements.namedItem(name) as HTMLInputElement | null; const x = el ? parseFloat(el.value) : NaN; return Number.isFinite(x) ? x : null; };
    let last = "";
    const run = () => { const next = read(n), k = key(next); if (k !== last) { last = k; setV(next); } };
    run();
    form.addEventListener("input", run);
    const t = setInterval(run, 1000); // the assistant and the upload box write values without an event
    return () => { form.removeEventListener("input", run); clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return [ref, v];
}

/** The notice above the lines: which rows are priced under their 最低售价 right now. `label` carries {list}. */
export function BelowMinAlert({ rows, floor, label, initial }: { rows: number; floor: number; label: string; initial: string }) {
  const [ref, list] = useForm((n) => {
    if (floor >= 1) return "";
    const out: string[] = [];
    for (let i = 0; i < rows; i++) { const q = n(`q${i}`), p = n(`p${i}`), c = n(`c${i}`); if (!q || q <= 0 || !c || c <= 0) continue; const min = Math.round((c / (1 - floor)) * 100) / 100; if ((p ?? 0) < min - 0.005) out.push(`#${i + 1} ${(p ?? 0).toFixed(2)} < ${min.toFixed(2)}`); }
    return out.join("、");
  }, (s) => s, [rows, floor]);
  const text = list ?? initial; // before the page is live: what the saved lines say
  return <span ref={ref} className={text ? "block" : "hidden"}>{text ? <span className="block rounded-lg border border-alert bg-alert/10 px-3 py-2 text-[13px] text-alert-ink" role="alert">⚠ {label.replace("{list}", text)}</span> : null}</span>;
}

/** The note under one line (建议售价 · 最低售价): red and marked while the typed price is under the minimum. */
export function RowMinNote({ i, min, text, belowText, initialBelow }: { i: number; min: number; text: string; belowText: string; initialBelow: boolean }) {
  const [ref, live] = useForm((n) => { const p = n(`p${i}`) ?? 0; return p > 0 && p < min - 0.005; }, (b) => String(b), [i, min]);
  const below = live ?? initialBelow;
  return <span ref={ref} className={`text-[11px] row-note ${below ? "font-semibold text-alert-ink" : "text-navy/70"}`}>{text}{below ? ` ${belowText}` : ""}</span>;
}
