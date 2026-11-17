"use client";
/**
 * The bell's drop-down (派修单 v3 第 14 条, MD on the phone 2026-11-17 20:44: "每条消息都点不动"). The link did open its
 * page — underneath: the layout stays mounted across a navigation, so the open list stayed on top of the page it had
 * just opened, and on a phone it covers the whole screen. Now a tap on a message closes the list, as does arriving on
 * another page or a tap outside.
 */
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

export function BellBox({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const path = usePathname(), search = useSearchParams().toString();
  useEffect(() => { if (ref.current) ref.current.open = false; }, [path, search]);
  useEffect(() => {
    const out = (e: Event) => { if (ref.current?.open && !ref.current.contains(e.target as Node)) ref.current.open = false; };
    document.addEventListener("click", out); return () => document.removeEventListener("click", out);
  }, []);
  return <details ref={ref} className={className} onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setTimeout(() => { if (ref.current) ref.current.open = false; }, 0); }}>{children}</details>;
}
