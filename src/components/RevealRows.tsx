"use client";
/** Repeating form rows: the server renders `children` (all possible rows); this shows the first `initial` and reveals one per click.
 *  Rows that hold a value after a restored draft (see FormMemory) are shown again. */
import { Children, useEffect, useRef, useState } from "react";

export function RevealRows({ children, initial = 1, addLabel }: { children: React.ReactNode; initial?: number; addLabel: string }) {
  const rows = Children.toArray(children);
  const [n, setN] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const on = () => {
      const divs = Array.from(box.current?.querySelectorAll(":scope > div[data-row]") ?? []);
      let last = -1;
      divs.forEach((d, i) => { if (Array.from(d.querySelectorAll("input,textarea")).some((x) => (x as HTMLInputElement).type !== "checkbox" && (x as HTMLInputElement).value.trim() && !(x as HTMLInputElement).defaultValue)) last = i; });
      setN((cur) => Math.max(cur, last + 1));
    };
    window.addEventListener("draft-restored", on);
    return () => window.removeEventListener("draft-restored", on);
  }, []);
  return (
    <div ref={box} className="space-y-2">
      {rows.map((r, i) => <div key={i} data-row hidden={i >= n}>{r}</div>)}
      {n < rows.length && <button type="button" onClick={() => setN(n + 1)} className="min-h-10 rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">＋ {addLabel}</button>}
    </div>
  );
}
