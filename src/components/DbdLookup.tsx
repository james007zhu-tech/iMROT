"use client";
/**
 * Tax ID → DBD. Runs on the button, and by itself when a valid 13-digit ID is typed or recognised.
 * Filled fields get the light-blue mark; the raw result rides along in hidden inputs so the server can store it.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

const MAP: Record<string, string> = { nameTh: "nameLocal", nameEn: "name", addressTh: "addressLocal", addressEn: "addressEn", phone: "phone", registeredCapital: "registeredCapital", foundedAt: "foundedAt" };

export function DbdLookup({ formId }: { formId: string }) {
  const t = useTranslations("ui");
  const [state, setState] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef("");

  async function run() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const id = (form?.elements.namedItem("taxId") as HTMLInputElement | null)?.value.replace(/\D/g, "") ?? "";
    if (!form || id.length !== 13) { setState({ tone: "warn", text: t("taxIdNeeded") }); return; }
    last.current = id;
    setBusy(true); setState(null);
    try {
      const r = await fetch(`/api/dbd/${id}`);
      const j = await r.json();
      if (!r.ok) { setState({ tone: "warn", text: t(j.error === "NOT_FOUND" ? "dbdNotFound" : j.error === "INVALID_TAX_ID" ? "taxIdInvalid" : "dbdFailed") }); return; }
      const values: Record<string, string> = {};
      for (const [src, name] of Object.entries(MAP)) {
        let v = j[src];
        if (v == null || v === "") continue;
        if (name === "foundedAt" && /^\d{8}$/.test(String(v))) v = `${String(v).slice(0, 4)}-${String(v).slice(4, 6)}-${String(v).slice(6)}`;
        const el = form.elements.namedItem(name) as HTMLInputElement | null;
        if (!el) continue;
        el.value = String(v); values[name] = String(v);
        el.classList.add("ai-filled");
        el.addEventListener("input", () => el.classList.remove("ai-filled"), { once: true });
      }
      (form.elements.namedItem("dbdStatus") as HTMLInputElement).value = j.status ?? "";
      (form.elements.namedItem("dbdFetchedAt") as HTMLInputElement).value = j.fetchedAt;
      (form.elements.namedItem("dbdData") as HTMLInputElement).value = JSON.stringify(j.raw ?? null);
      (form.elements.namedItem("dbdValues") as HTMLInputElement).value = JSON.stringify(values);
      const closed = /เลิก|ร้าง|ล้มละลาย|closed|dissolved|bankrupt/i.test(j.status ?? "");
      setState(closed ? { tone: "warn", text: t("dbdClosed", { status: j.status }) } : { tone: "ok", text: t("dbdFound", { status: j.status ?? "—" }) });
    } catch { setState({ tone: "warn", text: t("dbdFailed") }); } finally { setBusy(false); }
  }

  // Auto-run once a full 13-digit ID is present (typed, or filled by the upload box).
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const el = form?.elements.namedItem("taxId") as HTMLInputElement | null;
    if (!el) return;
    const on = () => { const id = el.value.replace(/\D/g, ""); if (id.length === 13 && id !== last.current) void run(); };
    el.addEventListener("input", on); el.addEventListener("change", on);
    return () => { el.removeEventListener("input", on); el.removeEventListener("change", on); };
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={run} disabled={busy} className="inline-flex min-h-10 items-center rounded-lg bg-blue px-4 text-sm font-semibold text-white">{busy ? t("reading") : t("dbdLookup")}</button>
      {state && <span className={state.tone === "ok" ? "rounded-full border border-navy/35 bg-blue/8 px-2.5 py-0.5 text-xs font-semibold" : "rounded border border-alert bg-alert/10 px-2 py-0.5 text-xs text-alert-ink"}>{state.tone === "ok" ? "✓ " : "⚠ "}{state.text}</span>}
      {["dbdStatus", "dbdFetchedAt", "dbdData", "dbdValues"].map((n) => <input key={n} type="hidden" name={n} form={formId} />)}
    </div>
  );
}
