"use client";
/** Serial number box that warns while typing when the serial is already on file (trial 2026-11-05: only on save). The server still blocks duplicates. */
import { useEffect, useRef, useState } from "react";

export function SerialInput({ inputCls, text }: { inputCls: string; text: string }) {
  const [hit, setHit] = useState<{ code: string; where: string } | null>(null);
  const [sn, setSn] = useState("");
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
      <input name="serialNumber" required onInput={(e) => setSn(e.currentTarget.value)} className={`${inputCls} font-mono ${hit ? "border-alert" : ""}`} />
      {hit && <span className="text-xs font-semibold text-alert-ink">{text.replace("{serial}", sn.trim()).replace("{code}", hit.code).replace("{where}", hit.where)} <a className="underline" href={`/assets/${hit.code}`}>{hit.code}</a></span>}
    </>
  );
}
