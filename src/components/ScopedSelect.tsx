"use client";
/**
 * A drop-down that lists only what belongs to the customer chosen elsewhere on the form (trial finding 2026-11-14:
 * plant and reporter listed every customer's). `follow` is the form field that decides — the customer field itself,
 * or a field such as the machine whose value maps to a customer through `via`. Nothing chosen yet: everything, labelled.
 */
import { useEffect, useRef, useState } from "react";

export type ScopedOption = { value: string; label: string; scope: string; wide?: string };

export function ScopedSelect({ name, options, follow, via, className, none = "—" }: { name: string; options: ScopedOption[]; follow: string; via?: Record<string, string>; className?: string; none?: string }) {
  const ref = useRef<HTMLSelectElement>(null);
  const [scope, setScope] = useState("");
  useEffect(() => {
    const read = () => {
      const form = ref.current?.form;
      const el = form?.elements.namedItem(follow);
      const first = el instanceof RadioNodeList ? (el[0] as HTMLInputElement | undefined) : (el as HTMLInputElement | null);
      const v = first?.value ?? "";
      setScope(via ? via[v] ?? "" : v);
    };
    read();
    const t = setInterval(read, 400); // the deciding field may be written by a picker or by the upload box, without an event
    return () => clearInterval(t);
  }, [follow, via]);
  const mine = scope ? options.filter((o) => o.scope === scope) : options;
  useEffect(() => { const s = ref.current; if (s && s.value && !mine.some((o) => o.value === s.value)) s.value = ""; }, [mine]);
  return (
    <select ref={ref} name={name} className={className} defaultValue="">
      <option value="">{none}</option>
      {mine.map((o) => <option key={o.value} value={o.value}>{scope ? o.label : o.wide ?? o.label}</option>)}
    </select>
  );
}
