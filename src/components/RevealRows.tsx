"use client";
/** Repeating form rows: the server renders `children` (all possible rows); this shows the first `initial` and reveals one per click. */
import { Children, useState } from "react";

export function RevealRows({ children, initial = 1, addLabel }: { children: React.ReactNode; initial?: number; addLabel: string }) {
  const rows = Children.toArray(children);
  const [n, setN] = useState(initial);
  return (
    <div className="space-y-2">
      {rows.map((r, i) => <div key={i} hidden={i >= n}>{r}</div>)}
      {n < rows.length && <button type="button" onClick={() => setN(n + 1)} className="min-h-10 rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">＋ {addLabel}</button>}
    </div>
  );
}
