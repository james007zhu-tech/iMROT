"use client";
/**
 * 手动汇率 (派修单 v5 P1-2): the rate field of a document with the Bank of China rate beside it. While the person types,
 * it says how far the new rate is from the BoC rate; past the threshold (2 %) it says the MD has to approve — and the
 * button, when this component carries one, changes to 提交 MD 批准.
 */
import { useState } from "react";
import { fmtRate } from "@/lib/money";

export function FxInput({ name, reasonName, boc, start, threshold, cls, labels, reasons, button, collapsed }: {
  name: string; reasonName: string; boc: { rate: number; date: string } | null; start?: number | null; threshold: number; cls: string; collapsed?: boolean;
  labels: { rate: string; reason: string; boc: string; diff: string; needsMd: string; edit: string; noBoc: string };
  reasons: { value: string; label: string }[]; button?: { save: string; askMd: string };
}) {
  const [first] = useState(start != null ? fmtRate(start) : boc ? fmtRate(boc.rate) : ""); // what the box opens with — never changed afterwards
  const [open, setOpen] = useState(!collapsed), [v, setV] = useState(first);
  const n = Number(v) || 0, diff = boc && n > 0 ? (n - boc.rate) / boc.rate : 0, changed = !boc || (n > 0 && Math.abs(n - boc.rate) > 1e-9), over = Math.abs(diff) > threshold + 1e-9;
  if (!open) return <span className="text-[12px] text-navy/80">{boc ? `@ ${fmtRate(boc.rate)} · ${labels.boc} ${boc.date} ` : `${labels.noBoc} `}<button type="button" onClick={() => setOpen(true)} className="text-blue underline">✎ {labels.edit}</button></span>;
  return (
    <span className="flex flex-wrap items-end gap-2">
      {/* F-03 (2026-11-20, third round): this box is now the same plain box as the one on /finance/fx that testers type into
          without trouble — a number field the page never writes to: its starting value is fixed when it appears, and the
          page only listens (on the label, not on the box) to show the difference from the Bank of China rate. */}
      <label className="text-xs text-navy/70" onInput={(e) => setV((e.target as HTMLInputElement).value)}>{labels.rate}<input name={name} type="number" step="any" min="0.00000001" required defaultValue={first} className={`${cls} mt-0.5 block w-44`} /></label>
      <label className="text-xs text-navy/70">{labels.reason}<select name={reasonName} required={changed} defaultValue="" className={`${cls} mt-0.5 block`}><option value="" disabled>—</option>{reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      <span className={`pb-1 text-xs ${over ? "font-semibold text-[#C0392B]" : "text-navy/70"}`} role="status">{boc ? `${labels.boc} ${fmtRate(boc.rate)} (${boc.date}) · ${labels.diff} ${(diff * 100).toFixed(2)}%` : labels.noBoc}{over ? ` · ${labels.needsMd}` : ""}</span>
      {button && <button className={`rounded-md px-3 py-1.5 text-sm font-semibold text-white ${over ? "bg-[#C0392B]" : "bg-navy"}`}>{over ? button.askMd : button.save}</button>}
    </span>
  );
}
