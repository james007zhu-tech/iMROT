"use client";
/**
 * Quantity box on the delivery note with a live check against what is still due:
 * "✓ matches" (navy), "short n" / "over n" (orange). The server repeats the same check before it issues.
 */
import { useEffect, useRef, useState } from "react";

export function QtyCheck({ name, due, defaultValue, labels, className }: {
  name: string; due: number; defaultValue: number; labels: { ok: string; short: string; over: string }; className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [v, setV] = useState(defaultValue);
  // FormMemory writes restored values straight into the DOM; read them back.
  useEffect(() => {
    const on = () => setV(Number(ref.current?.value || 0));
    window.addEventListener("draft-restored", on);
    return () => window.removeEventListener("draft-restored", on);
  }, []);
  const diff = v - due;
  const text = diff === 0 ? labels.ok : (diff < 0 ? labels.short : labels.over).replace("{n}", String(Math.abs(diff)));
  return (
    <div className="flex items-center gap-2">
      <input ref={ref} name={name} type="number" min={0} step="1" defaultValue={defaultValue} onInput={(e) => setV(Number(e.currentTarget.value || 0))} className={className} />
      <span data-check={diff === 0 ? "ok" : "diff"} className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${diff === 0 ? "border-navy/35 bg-tint text-navy" : "border-alert bg-alert/15 text-alert-ink"}`}>{text}</span>
    </div>
  );
}
