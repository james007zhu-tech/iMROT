"use client";
/**
 * 业务模式 cards on the new-order page (mockup business-modes-v0.1, approved 2026-11-09). One radio per mode; the
 * fields that only one mode needs appear under the cards: 维保 sub-type, 合作维修 reason. Modes not open yet are shown
 * disabled so people see the whole set. The inputs sit above the upload box, outside the form, so they name it (form=…).
 */
import { useState } from "react";

export type ModeCard = { mode: string; name: string; sub: string; desc: string; floor: string; assetNote: string; open: boolean };

export function ModeCards({ form, cards, initial, kinds, labels, inputCls }: {
  form: string; cards: ModeCard[]; initial: string; kinds: { value: string; label: string }[];
  labels: { kind: string; reason: string; reasonPh: string; soon: string }; inputCls: string;
}) {
  const [mode, setMode] = useState(initial);
  // Machine modes and trade modes ask for different fields (asset + fault vs customer + SKU lines): the server renders those,
  // so switching to a mode with another form reloads with ?mode=; between machine modes only the small extra fields change.
  // Each non-machine mode has a form of its own (国内贸易, 国际贸易 with trade terms, 自动化项目 with the project card).
  const layout = (m: string) => (["REPAIR", "PARTNER_REPAIR", "MAINTENANCE"].includes(m) ? "MACHINE" : m);
  const trade = (m: string) => layout(m) !== "MACHINE";
  const pick = (m: string) => {
    if (layout(m) === layout(initial)) return setMode(m);
    const q = new URLSearchParams(window.location.search);
    q.set("mode", m); q.delete("error"); if (trade(m)) q.delete("asset");
    window.location.search = q.toString();
  };
  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map((c) => (
          <label key={c.mode} className={`relative flex flex-col rounded-xl border-[1.5px] bg-white px-3.5 py-3 ${c.open ? "cursor-pointer" : "cursor-not-allowed opacity-60"} ${mode === c.mode ? "border-blue ring-3 ring-blue/15" : "border-navy/15"}`}>
            <input type="radio" form={form} name="mode" value={c.mode} checked={mode === c.mode} disabled={!c.open} onChange={() => pick(c.mode)} className="absolute right-3 top-3 size-4 accent-blue" />
            <span className="pr-6 text-base font-bold text-navy">{c.name}</span>
            <span className="text-[11px] text-navy/60">{c.sub}</span>
            <span className="my-2 min-h-9 text-[13px] text-navy/90">{c.desc}</span>
            <span className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="rounded-md bg-tint px-1.5 py-0.5 text-navy">{c.floor}</span>
              <span className="rounded-md bg-tint px-1.5 py-0.5 text-navy">{c.assetNote}</span>
              {!c.open && <span className="rounded-md bg-alert/15 px-1.5 py-0.5 text-alert-ink">{labels.soon}</span>}
            </span>
          </label>
        ))}
      </div>
      {mode === "MAINTENANCE" && (
        <label className="flex max-w-xs flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.kind}<span className="text-alert"> *</span></span>
          <select form={form} name="kind" className={inputCls}>{kinds.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select>
        </label>
      )}
      {mode === "PARTNER_REPAIR" && (
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.reason}<span className="text-alert"> *</span></span>
          <input form={form} name="partnerReason" required placeholder={labels.reasonPh} className={inputCls} />
        </label>
      )}
    </div>
  );
}
