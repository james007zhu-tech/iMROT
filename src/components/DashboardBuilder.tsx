"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

/** "Describe the dashboard you want" → AI picks metrics and charts from the catalog → saved → opened. */
export function DashboardBuilder({ dashboardId }: { dashboardId?: string }) {
  const t = useTranslations("ai");
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function build() {
    if (!prompt.trim()) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/ai/dashboard", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, dashboardId }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setPrompt("");
      router.push(`/dashboard/${j.id}`); router.refresh();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void build(); }} className="flex gap-2">
      <input value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={dashboardId ? t("editDashboard") : t("buildDashboard")} className="w-full rounded border px-3 py-1.5 text-sm md:w-80" />
      <button disabled={busy} className="rounded bg-blue px-3 py-1.5 text-sm text-white disabled:opacity-50">{busy ? "…" : "AI"}</button>
      {err && <span className="text-xs text-alert-ink">{err}</span>}
    </form>
  );
}
