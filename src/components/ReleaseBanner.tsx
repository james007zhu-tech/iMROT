"use client";
/**
 * 「系统更新中，请稍后再保存」 (release rule, 2026-11-15): shown from a few minutes before a release restarts the
 * system until it is back, so nobody presses save into a restart. Asks the server every 20 seconds; while the server
 * does not answer at all (the restart itself) the banner stays.
 */
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

export function ReleaseBanner() {
  const text = useTranslations("common")("releaseSoon");
  const [on, setOn] = useState(false);
  useEffect(() => {
    let misses = 0;
    const ask = async () => {
      try { const r = await fetch("/api/release", { cache: "no-store" }); const j = (await r.json()) as { soon?: boolean }; misses = 0; setOn(!!j.soon); }
      catch { if (++misses >= 2) setOn(true); }
    };
    void ask();
    const t = setInterval(ask, 20_000);
    return () => clearInterval(t);
  }, []);
  if (!on) return null;
  return <div role="alert" className="fixed inset-x-0 top-0 z-[80] bg-alert px-4 py-2 text-center text-sm font-semibold text-navy shadow">⏳ {text}</div>;
}
