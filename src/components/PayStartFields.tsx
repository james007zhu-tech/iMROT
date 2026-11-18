"use client";
/** 发起付款: 应付金额、预扣税率 → 预扣税额 and 实付 are worked out as finance types (server/pay.ts whtOf does the same). */
import { useState } from "react";
const TYPE_PCT: Record<string, number> = { SERVICE: 3, RENT: 5, TRANSPORT: 1, ADVERTISING: 2 };

export function PayStartFields({ open, baseShare, rate, currency, cls, labels, taxIdOk }: { open: number; baseShare: number; rate: number; currency: string; cls: string; labels: { gross: string; rate: string; wht: string; net: string; date: string; type: string; types: Record<string, string>; draft: string; noTaxId: string }; taxIdOk: boolean; }) {
  const [gross, setGross] = useState(open.toFixed(2)), [pct, setPct] = useState(String(Math.round(rate * 10000) / 100));
  const [type, setType] = useState(rate > 0 ? "SERVICE" : "");
  const pick = (v: string) => { setType(v); if (v && v !== "OTHER") setPct(String(TYPE_PCT[v])); if (!v) setPct("0"); };
  const g = Number(gross) || 0, r = (Number(pct) || 0) / 100;
  const wht = Math.round(g * baseShare * r * 100) / 100, net = Math.round((g - wht) * 100) / 100;
  return (
    <div className="grid grid-cols-2 gap-1">
      <label className="text-[11px] text-navy/70">{labels.gross}<input name="amount" type="number" step="0.01" min="0.01" max={open.toFixed(2)} value={gross} onChange={(e) => setGross(e.target.value)} className={`${cls} w-full`} /></label>
      <label className="text-[11px] text-navy/70">{labels.type}<select name="whtType" value={type} onChange={(e) => pick(e.target.value)} className={`${cls} w-full`}><option value="">—</option>{Object.entries(labels.types).map(([k, v]) => <option key={k} value={k}>{v}{TYPE_PCT[k] ? ` ${TYPE_PCT[k]}%` : ""}</option>)}</select></label>
      <label className="text-[11px] text-navy/70">{labels.rate}<input name="whtPct" type="number" step="0.01" min="0" max="15" value={pct} onChange={(e) => setPct(e.target.value)} className={`${cls} w-full`} /></label>
      <label className="text-[11px] text-navy/70">{labels.wht}<input readOnly tabIndex={-1} value={wht.toFixed(2)} className={`${cls} w-full bg-tint`} /></label>
      <label className="text-[11px] font-semibold text-navy">{labels.net}<input readOnly tabIndex={-1} value={`${currency} ${net.toFixed(2)}`} className={`${cls} w-full bg-tint font-semibold`} /></label>
      {wht > 0 && <p className={`col-span-2 rounded-md px-2 py-1 text-[11px] ${taxIdOk ? "bg-tint text-navy" : "bg-[#FDECEC] font-semibold text-alert-ink"}`}>{taxIdOk ? labels.draft : labels.noTaxId}</p>}
    </div>
  );
}
