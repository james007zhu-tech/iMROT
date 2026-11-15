"use client";
/**
 * A table is unusable on a phone — five columns leave each box a finger's nail wide (walk-through
 * 2026-11-15, the lines of a trade order). On a narrow screen every table that holds boxes becomes a stack of cards:
 * one row = one card, each box under its column's name. And a long run of blank rows waits behind "＋ one more line"
 * instead of filling the screen. Nothing changes on a desktop, and nothing about what is sent.
 */
import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const BOX = "input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea";

export function PhoneTables({ more }: { more: string }) {
  const path = usePathname(), query = useSearchParams().toString();
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 640px)");
    const dress = () => {
      for (const table of document.querySelectorAll<HTMLTableElement>("main table")) {
        if (/\bmin-w-/.test(table.className) || table.closest("[data-keep-table]")) continue; // a sheet meant to be scrolled sideways
        const reads = !table.querySelector(`tbody ${BOX}`);
        // a list to read stacks too (its headings were breaking one letter a line), but only when it has headings to label the values
        if (reads && table.querySelectorAll("thead th").length < 3) continue;
        table.classList.add("tbl-stack");
        if (reads) table.classList.add("tbl-read");
        const heads = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
        const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody > tr")];
        for (const tr of rows) [...tr.children].forEach((td, i) => { const h = heads[i]; if (h && h !== "#" && !(td as HTMLElement).dataset.l) (td as HTMLElement).dataset.l = h; if (td.querySelector(BOX) == null) td.classList.add("tbl-plain"); if (td.querySelector("textarea, input[type=text]:not([list]), input:not([type])") && !/\bw-\d/.test(td.className)) td.classList.add("tbl-wide"); });
        if (reads || !narrow.matches || table.dataset.more) continue;
        // blank rows: nothing typed in any box, apart from a value every row carries (a default unit)
        const boxes = (tr: HTMLTableRowElement) => [...tr.querySelectorAll<HTMLInputElement>(BOX)].filter((b) => b.tagName !== "SELECT");
        const same = new Set<number>();
        const cols = rows.length ? boxes(rows[0]).length : 0;
        for (let c = 0; c < cols; c++) { const v = boxes(rows[0])[c]?.value; if (v && rows.every((r) => boxes(r)[c]?.value === v)) same.add(c); }
        const blank = (tr: HTMLTableRowElement) => boxes(tr).length > 0 && boxes(tr).every((b, c) => !b.value || same.has(c));
        let firstBlank = rows.length;
        while (firstBlank > 0 && blank(rows[firstBlank - 1])) firstBlank--;
        const hide = rows.slice(Math.max(firstBlank + 1, 2)); // keep what is filled, one blank after it, and never fewer than two
        if (hide.length < 2) continue;
        table.dataset.more = "1";
        hide.forEach((r) => r.classList.add("tbl-later"));
        const btn = document.createElement("button");
        btn.type = "button"; btn.className = "tbl-more"; btn.textContent = `＋ ${more}`;
        btn.onclick = () => { const next = table.querySelector<HTMLTableRowElement>("tr.tbl-later"); next?.classList.remove("tbl-later"); next?.querySelector<HTMLElement>(BOX)?.focus(); if (!table.querySelector("tr.tbl-later")) btn.remove(); };
        table.after(btn);
      }
    };
    dress();
    const seen = new MutationObserver(() => dress());
    const main = document.querySelector("main");
    if (main) seen.observe(main, { childList: true, subtree: true });
    return () => seen.disconnect();
  }, [path, query, more]);
  return null;
}
