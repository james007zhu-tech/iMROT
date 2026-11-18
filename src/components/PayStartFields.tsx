"use client";
/** 发起付款: 应付金额、预扣税率 → 预扣税额 and 实付 are worked out as finance types (server/pay.ts whtOf does the same). */
import { useState } from "react";
import { fmtRate, rateTyped } from "@/lib/money";
const TYPE_PCT: Record<string, number> = { SERVICE: 3, RENT: 5, TRANSPORT: 1, ADVERTISING: 2 };

export function PayStartFields({ open, baseShare, rate, currency, cls, labels, taxIdOk, accounts, fx, invoiceId }: { invoiceId: string; accounts: { id: string; label: string; ccy: string }[]; fx: Record<string, { rate: number; date: string }>; open: number; baseShare: number; rate: number; currency: string; cls: string; labels: { gross: string; rate: string; wht: string; net: string; date: string; type: string; types: Record<string, string>; draft: string; noTaxId: string; preview: string; account: string; fxAt: string; fxBoc: string; fxEdit: string; fxReason: string; fxReasons: Record<string, string>; fxEquiv: string; fxNone: string; fxDiff: string }; taxIdOk: boolean; }) {
  const [gross, setGross] = useState(open.toFixed(2)), [pct, setPct] = useState(String(Math.round(rate * 10000) / 100));
  const [type, setType] = useState(rate > 0 ? "SERVICE" : "");
  const pick = (v: string) => { setType(v); if (v && v !== "OTHER") setPct(String(TYPE_PCT[v])); if (!v) setPct("0"); };
  // 派修单 v5 P1-3: a foreign-currency account (or invoice) shows its rate to THB and the equivalent; finance may change it, with a reason
  const [acc, setAcc] = useState(""), [edit, setEdit] = useState(false), [fxRate, setFxRate] = useState("");
  const accCcy = accounts.find((a) => a.id === acc)?.ccy ?? "THB", ccy = accCcy !== "THB" ? accCcy : currency !== "THB" ? currency : "";
  const boc = ccy ? fx[ccy] : undefined, used = edit && Number(fxRate) > 0 ? Number(fxRate) : boc?.rate ?? 0, changed = !!ccy && (!boc || Math.abs(used - boc.rate) > 1e-6);
  const g = Number(gross) || 0, r = (Number(pct) || 0) / 100;
  const wht = Math.round(g * baseShare * r * 100) / 100, net = Math.round((g - wht) * 100) / 100;
  return (
    <div className="grid grid-cols-2 gap-1">
      <select name="account" required value={acc} onChange={(e) => { setAcc(e.target.value); setEdit(false); setFxRate(""); }} className={`${cls} col-span-2`}><option value="" disabled>{labels.account}</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
      <label className="text-[11px] text-navy/70">{labels.gross}<input name="amount" type="text" inputMode="decimal" autoComplete="off" required pattern="[0-9,]*\.?[0-9]{0,2}" defaultValue={open.toFixed(2)} onChange={(e) => setGross(e.target.value.replace(/,/g, ""))} onFocus={(e) => { e.target.value = e.target.value.replace(/,/g, ""); }} onBlur={(e) => { const n = Number(e.target.value.replace(/,/g, "")); if (e.target.value.trim() && Number.isFinite(n)) e.target.value = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }} className={`${cls} w-full text-right tabular-nums`} /></label>
      <label className="text-[11px] text-navy/70">{labels.type}<select name="whtType" value={type} onChange={(e) => pick(e.target.value)} className={`${cls} w-full`}><option value="">—</option>{Object.entries(labels.types).map(([k, v]) => <option key={k} value={k}>{v}{TYPE_PCT[k] ? ` ${TYPE_PCT[k]}%` : ""}</option>)}</select></label>
      <label className="text-[11px] text-navy/70">{labels.rate}<input key={type} name="whtPct" type="text" inputMode="decimal" autoComplete="off" pattern="[0-9]*\.?[0-9]{0,2}" defaultValue={pct} onChange={(e) => setPct(e.target.value)} className={`${cls} w-full`} /></label>
      <label className="text-[11px] text-navy/70">{labels.wht}<input readOnly tabIndex={-1} value={wht.toFixed(2)} className={`${cls} w-full bg-tint`} /></label>
      <label className="text-[11px] font-semibold text-navy">{labels.net}<input readOnly tabIndex={-1} value={`${currency} ${net.toFixed(2)}`} className={`${cls} w-full bg-tint font-semibold`} /></label>
      {ccy && acc && <div className="col-span-2 rounded-md border border-hair bg-white px-2 py-1 text-[11px] text-navy">
        {boc ? <span>@ 1 {ccy} = {fmtRate(boc.rate)} THB · {labels.fxBoc} {boc.date} </span> : <span className="font-semibold text-alert-ink">{labels.fxNone} </span>}
        {!edit && <button type="button" onClick={() => { setEdit(true); setFxRate(boc ? fmtRate(boc.rate) : ""); }} data-draft-open className="text-blue underline" aria-label={labels.fxEdit}>✎ {labels.fxEdit}</button>}
        {edit && <span className="mt-1 flex flex-wrap items-center gap-1"><input name="fxRate" type="text" inputMode="decimal" autoComplete="off" required pattern="[0-9]*\.?[0-9]*" value={fxRate} onChange={(e) => setFxRate(rateTyped(e.target.value))} className={`${cls} w-28`} />
          <select name="fxReason" required={changed} defaultValue="" className={`${cls} w-36`}><option value="" disabled>{labels.fxReason}</option>{Object.entries(labels.fxReasons).map(([k, v]) => <option key={k} value={v}>{v}</option>)}</select>
          {boc && changed && <span className="text-[#9A5B00]">{labels.fxDiff} {(((used - boc.rate) / boc.rate) * 100).toFixed(2)}%</span>}</span>}
        {used > 0 && <span className="block font-semibold">{labels.fxEquiv} {currency === ccy ? `THB ${(net * used).toFixed(2)}` : `${ccy} ${(net / used).toFixed(2)}`}</span>}
      </div>}
      {wht > 0 && <p className={`col-span-2 rounded-md px-2 py-1 text-[11px] ${taxIdOk ? "bg-tint text-navy" : "bg-[#FDECEC] font-semibold text-alert-ink"}`}>{taxIdOk ? <>{labels.draft} <a href={`/finance/payables/wht/preview?inv=${invoiceId}&gross=${g}&rate=${r}&type=${type || "SERVICE"}`} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-blue underline">{labels.preview}</a></> : labels.noTaxId}</p>}
    </div>
  );
}
