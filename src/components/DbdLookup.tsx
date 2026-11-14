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
  const [state, setState] = useState<{ tone: "ok" | "warn"; text: string; openUrl?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const last = useRef("");

  async function run() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    const id = (form?.elements.namedItem("taxId") as HTMLInputElement | null)?.value.replace(/\D/g, "") ?? "";
    if (!form || id.length !== 13) { setState({ tone: "warn", text: t("taxIdNeeded") }); return; }
    last.current = id;
    setBusy(true); setState(null);
    const put = (name: string, v: unknown, onlyEmpty = false) => {
      const el = form.elements.namedItem(name) as HTMLInputElement | null;
      if (!el || v == null || v === "" || (onlyEmpty && el.value.trim())) return false;
      el.value = String(v);
      el.classList.add("ai-filled");
      el.addEventListener("input", () => el.classList.remove("ai-filled"), { once: true });
      return true;
    };
    /** Second pass: what the registry does not publish (address in English, phone), from the public web. Only empty boxes. */
    const web = async (known: Record<string, string>) => {
      setState({ tone: "ok", text: t("webLooking") });
      const r = await fetch(`/api/dbd/${id}?web=1&${new URLSearchParams(known)}`);
      const w = (await r.json()) as { values?: Record<string, string>; sources?: string[] };
      let n = 0;
      for (const [src, name] of Object.entries(MAP)) if (w.values?.[src] && put(name, w.values[src], true)) n++;
      const reg = (form.elements.namedItem("addressLocal") as HTMLInputElement | null)?.value;
      if (reg) put("billingAddress", reg, true); // a tax invoice carries the registered address unless the customer says otherwise
      return { n, source: w.sources?.[0] };
    };
    try {
      const r = await fetch(`/api/dbd/${id}`);
      const j = await r.json();
      if (j.error === "DBD_BLOCKED" || (!r.ok && j.error !== "NOT_FOUND" && j.error !== "INVALID_TAX_ID")) {
        // the registry does not answer: the web alone
        const w = await web({});
        setState(w.n ? { tone: "ok", text: t("webFilled", { n: w.n }), openUrl: w.source } : { tone: "warn", text: t(j.error === "DBD_BLOCKED" ? "dbdBlocked" : "dbdFailed"), openUrl: j.openUrl });
        return;
      }
      if (!r.ok) { setState({ tone: "warn", text: t(j.error === "NOT_FOUND" ? "dbdNotFound" : "taxIdInvalid"), openUrl: j.openUrl }); return; }
      const values: Record<string, string> = {};
      for (const [src, name] of Object.entries(MAP)) {
        let v = j[src];
        if (v == null || v === "") continue;
        if (name === "foundedAt" && /^\d{8}$/.test(String(v))) v = `${String(v).slice(0, 4)}-${String(v).slice(4, 6)}-${String(v).slice(6)}`;
        if (put(name, v)) values[name] = String(v);
      }
      (form.elements.namedItem("dbdStatus") as HTMLInputElement).value = j.status ?? "";
      (form.elements.namedItem("dbdFetchedAt") as HTMLInputElement).value = j.fetchedAt;
      (form.elements.namedItem("dbdData") as HTMLInputElement).value = JSON.stringify(j.raw ?? null);
      (form.elements.namedItem("dbdValues") as HTMLInputElement).value = JSON.stringify(values);
      const closed = /เลิก|ร้าง|ล้มละลาย|closed|dissolved|bankrupt/i.test(j.status ?? "");
      if (closed) { setState({ tone: "warn", text: t("dbdClosed", { status: j.status }) }); return; }
      const w = await web({ nameTh: j.nameTh ?? "", nameEn: j.nameEn ?? "", addressTh: j.addressTh ?? "" }).catch(() => ({ n: 0, source: undefined }));
      setState({ tone: "ok", text: `${t("dbdFound", { status: j.status ?? "—" })}${w.n ? ` · ${t("webFilled", { n: w.n })}` : ""}` });
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
      {state && <span className={state.tone === "ok" ? "rounded-full border border-navy/35 bg-blue/8 px-2.5 py-0.5 text-xs font-semibold" : "rounded border border-alert bg-alert/10 px-2 py-0.5 text-xs text-alert-ink"}>{state.tone === "ok" ? "✓ " : "⚠ "}{state.text}{state.openUrl && <> <a href={state.openUrl} target="_blank" rel="noreferrer" className="underline">{t("dbdOpenSite")}</a></>}</span>}
      {["dbdStatus", "dbdFetchedAt", "dbdData", "dbdValues"].map((n) => <input key={n} type="hidden" name={n} form={formId} />)}
    </div>
  );
}
