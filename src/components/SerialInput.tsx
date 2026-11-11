"use client";
/** Serial number box that warns while typing when the serial is already on file (trial 2026-11-05: only on save). The server still blocks duplicates. */
import { useEffect, useRef, useState } from "react";

export function SerialInput({ inputCls, text, initial = "", noSerialLabel, noSerialHint }: { inputCls: string; text: string; initial?: string; /** 铭牌缺失: tick → DCiT issues an internal serial number */ noSerialLabel?: string; noSerialHint?: string }) {
  const [none, setNone] = useState(false);
  const [hit, setHit] = useState<{ code: string; where: string } | null>(null);
  const [sn, setSn] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (sn.trim().length < 3) { setHit(null); return; }
    timer.current = setTimeout(async () => {
      try { const r = await fetch(`/api/assets/serial?sn=${encodeURIComponent(sn.trim())}`); setHit(r.ok ? (await r.json()).found : null); } catch { setHit(null); }
    }, 400);
  }, [sn]);
  return (
    <>
      <input name="serialNumber" required={!none} disabled={none} defaultValue={initial} onInput={(e) => setSn(e.currentTarget.value)} className={`${inputCls} font-mono ${hit ? "border-alert" : ""}`} />
      {noSerialLabel && <label className="mt-1 flex items-start gap-2 text-xs text-navy"><input type="checkbox" name="noSerial" checked={none} onChange={(e) => { setNone(e.currentTarget.checked); if (e.currentTarget.checked) setHit(null); }} className="mt-0.5 h-4 w-4 shrink-0" /><span>{noSerialLabel}{none && noSerialHint ? <span className="block text-[#9A5B00]">{noSerialHint}</span> : null}</span></label>}
      {hit && !none && <span className="text-xs font-semibold text-alert-ink">{text.replace("{serial}", sn.trim()).replace("{code}", hit.code).replace("{where}", hit.where)} <a className="underline" href={`/assets/${hit.code}`}>{hit.code}</a></span>}
    </>
  );
}
