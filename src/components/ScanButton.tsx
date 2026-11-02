"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Scan the QR on a DCiT nameplate with the phone camera (BarcodeDetector where available).
 * The QR encodes /portal/report?asset=ATH…, so on browsers without BarcodeDetector the system camera app does the same job.
 */
export function ScanButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const w = window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => { detect: (v: HTMLVideoElement) => Promise<{ rawValue: string }[]> } };
    if (!w.BarcodeDetector) { setErr("no-detector"); return; }
    const detector = new w.BarcodeDetector({ formats: ["qr_code"] });
    let stream: MediaStream | null = null, timer: number | undefined, stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            const hit = codes.find((c) => /ATH\d+|AVN\d+|ACN\d+/.test(c.rawValue));
            if (hit) { const m = /\/portal\/report\?asset=([A-Z0-9]+)/.exec(hit.rawValue) ?? /([A-Z]{3}\d{8})/.exec(hit.rawValue); if (m) { stopped = true; router.push(`/portal/report?asset=${m[1]}`); return; } }
          } catch { /* keep scanning */ }
          timer = window.setTimeout(tick, 300);
        };
        void tick();
      } catch (e) { setErr((e as Error).message); }
    })();
    return () => { stopped = true; if (timer) clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [open, router]);

  return (
    <>
      <button type="button" onClick={() => { setErr(null); setOpen(true); }} className="w-full rounded-lg border-2 border-blue py-3 text-base font-bold text-blue">📷 {label}</button>
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <video ref={video} className="flex-1 object-cover" muted playsInline />
          <div className="bg-black p-3 text-center text-sm text-white">
            {err === "no-detector" ? "This browser cannot scan in-page — open the phone's camera app and point it at the nameplate QR." : err ?? "Point at the DCiT nameplate QR"}
            <button onClick={() => setOpen(false)} className="ml-3 rounded bg-white/20 px-3 py-1">✕</button>
          </div>
        </div>
      )}
    </>
  );
}
