"use client";
/** Repeating form rows: the server renders `children` (all possible rows); this shows the first `initial` and reveals one per click.
 *  Rows that hold a value after a restored draft (see FormMemory) are shown again. */
import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from "react";

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
  // Phone (朱总 2026-11-10): a row of a line table becomes a card of its own — numbered, alternate ground, every
  // field under its name. Names come from the desktop header row just above (hidden on a phone), else the placeholder.
  const [heads, setHeads] = useState<string[]>([]);
  useEffect(() => {
    const h = box.current?.previousElementSibling;
    if (h && h.classList.contains("md:grid")) setHeads(Array.from(h.children).map((x) => x.textContent ?? ""));
  }, []);
  const card = (r: React.ReactNode, i: number) => {
    if (!isValidElement<{ className?: string; children?: React.ReactNode }>(r) || typeof r.type !== "string" || !/\bgrid\b/.test(r.props.className ?? "")) return r;
    const cells = Children.toArray(r.props.children).map((c, j) => {
      const ph = isValidElement<{ placeholder?: string }>(c) ? c.props.placeholder : undefined;
      const name = heads[j] || ph;
      return <label key={j} className="flex min-w-0 flex-col gap-0.5"><span className="truncate text-[11px] text-navy/60 md:hidden">{name || "\u00a0"}</span>{c}</label>;
    });
    return cloneElement(r, { className: `${r.props.className} max-md:rounded-xl max-md:border max-md:border-hair max-md:p-3 ${i % 2 ? "max-md:bg-[#E9F0F9]" : "max-md:bg-white"}` },
      <span key="no" className="col-span-full -mb-1 text-xs font-bold text-blue md:hidden">#{i + 1}</span>, ...cells);
  };
  return (
    <div ref={box} className="space-y-3 md:space-y-2">
      {rows.map((r, i) => <div key={i} data-row hidden={i >= n}>{card(r, i)}</div>)}
      {n < rows.length && <button type="button" onClick={() => setN(n + 1)} className="min-h-10 rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">＋ {addLabel}</button>}
    </div>
  );
}
