"use client";
/**
 * 保存按钮一直看得见 (朱总 2026-11-19 12:09): a form's 保存 sits in the page header, and on a long form it scrolled out of
 * sight. Once the header has left the screen, its form buttons (button[form=…]) appear again in a bar at the bottom;
 * pressing one there presses the original, so the form, the name/value it sends and every check stay exactly the same.
 * Pages without such buttons show nothing.
 */
import { useEffect, useRef, useState } from "react";

export function HeaderSave() {
  const mark = useRef<HTMLSpanElement>(null);
  const [btns, setBtns] = useState<{ label: string; primary: boolean; i: number }[]>([]);
  const [out, setOut] = useState(false);
  const orig = useRef<HTMLButtonElement[]>([]);
  useEffect(() => {
    const header = mark.current?.parentElement;
    if (!header) return;
    const read = () => { orig.current = Array.from(header.querySelectorAll<HTMLButtonElement>("button[form]")).filter((b) => !b.disabled);
      setBtns(orig.current.map((b, i) => ({ label: (b.textContent ?? "").trim(), primary: /bg-(navy|blue)/.test(b.className), i }))); };
    read();
    const io = new IntersectionObserver(([e]) => setOut(!e.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(header);
    const mo = new MutationObserver(read); mo.observe(header, { subtree: true, childList: true, characterData: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return (
    <>
      <span ref={mark} hidden />
      {out && btns.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hair bg-white/95 px-3 py-2 pr-16 shadow-[0_-2px_8px_rgba(11,45,83,0.08)] backdrop-blur md:pr-24" role="toolbar">
          <div className="ml-auto flex max-w-5xl flex-wrap items-center justify-end gap-2">
            {btns.map((b) => (
              <button key={b.i} type="button" onClick={() => orig.current[b.i]?.click()}
                className={b.primary ? "min-h-10 rounded-lg bg-navy px-5 text-sm font-semibold text-white" : "min-h-10 rounded-lg border border-navy/45 bg-white px-4 text-sm text-navy"}>{b.label}</button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
