"use client";
/**
 * Rule ④: every form starts with this box. Choose / photograph / drop / Ctrl+V a file or text;
 * it is stored, read, and the recognised values are written into the form (marked light blue until edited).
 * The stored files travel with the form in a hidden `attachments` input (JSON), so the original is kept with the record.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { RecognizeKind } from "@/lib/recognize";

type Att = { name: string; url: string; kind: string };

/**
 * `lineFields` maps a recognised line column to the input-name prefix of the form's row inputs, e.g.
 * { description: "d", qty: "q", unitPrice: "p" } fills d0/q0/p0, d1/q1/p1 … from the document's line items.
 */
export function UploadRecognize({ kind, formId, title, hint, initial = [], lineFields }: { kind: RecognizeKind; formId: string; title: string; hint: string; initial?: Att[]; lineFields?: Record<string, string> }) {
  const t = useTranslations("ui");
  const [busy, setBusy] = useState(false);
  const [atts, setAtts] = useState<Att[]>(initial);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  async function send(files: File[], text?: string) {
    if (!files.length && !text?.trim()) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("kind", kind);
      if (text) fd.set("text", text);
      files.forEach((f) => fd.append("file", f));
      const r = await fetch("/api/ai/recognize", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      if (j.rejected) { setMsg({ tone: "warn", text: t(kind === "customer" ? "rejectedDoc" : "rejectedDocGeneric", { kind: j.docKind || "?" }) }); return; }
      setAtts((a) => [...a, ...(j.attachments as Att[])]);
      const uncertain = new Set<string>((j.uncertain as string[] | undefined) ?? []);
      let n = fill(formId, j.fields as Record<string, string>, uncertain);
      if (lineFields && Array.isArray(j.lines)) n += fillLines(formId, j.lines as Record<string, string>[], lineFields);
      const checks = uncertain.size;
      const looked = Array.isArray(j.lookedUp) ? (j.lookedUp as string[]).length : 0; // company data found on the web, not on the paper
      const base = (n > 0 ? (checks ? t("filledNCheck", { n, c: checks }) : t("filledN", { n })) : t("nothingFound")) + (looked ? ` ${t("lookedUpN", { n: looked })}` : "");
      setMsg(j.notes === "no-model" ? { tone: "warn", text: `${n > 0 ? `${base} — ` : ""}${t("noModel")}` } : n > 0 ? { tone: checks ? "warn" : "ok", text: base } : { tone: "warn", text: base });
    } catch (e) {
      setMsg({ tone: "warn", text: (e as Error).message });
    } finally { setBusy(false); }
  }

  // Ctrl+V anywhere on the page while no field has focus, or inside the box.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA") && !boxRef.current?.contains(target);
      if (typing) return;
      const files = Array.from(e.clipboardData?.files ?? []);
      const text = e.clipboardData?.getData("text") ?? "";
      if (!files.length && !text) return;
      e.preventDefault();
      void send(files, text);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

  return (
    <div ref={boxRef} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void send(Array.from(e.dataTransfer.files)); }}
      className="rounded-xl border-2 border-dashed border-blue bg-blue/6 p-4" data-upload-box>
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-blue/15 md:flex">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2374D5" strokeWidth="2" aria-hidden="true"><path d="M12 16V4m0 0l-4 4m4-4l4 4" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></svg>
        </div>
        <div className="flex-1">
          <b className="text-[15px]">{title}</b>
          <p className="text-[13px] text-navy/75">{hint}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="min-h-10 rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">{t("chooseFile")}</button>
          <button type="button" disabled={busy} onClick={() => camRef.current?.click()} className="min-h-10 rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">{t("takePhoto")}</button>
          <button type="button" disabled={busy} onClick={async () => { try { const items = await navigator.clipboard.read(); const files: File[] = []; let text = ""; for (const it of items) { for (const type of it.types) { const b = await it.getType(type); if (type.startsWith("text/")) text += await b.text(); else files.push(new File([b], `paste.${type.split("/")[1]}`, { type })); } } void send(files, text); } catch { setMsg({ tone: "warn", text: t("pasteHint") }); } }} className="min-h-10 rounded-lg border border-navy/45 bg-white px-3 text-sm font-semibold">{t("paste")}</button>
        </div>
      </div>
      <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.txt,.csv,.eml" onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={camRef} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { void send(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {(busy || msg || atts.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {busy && <span className="text-blue">{t("reading")}</span>}
          {atts.map((a) => <a key={a.url} href={a.url} target="_blank" className="rounded-full border border-navy/35 bg-white px-2.5 py-0.5 font-semibold">📄 {a.name}</a>)}
          {msg && <span className={msg.tone === "ok" ? "text-blue" : "rounded border border-alert bg-alert/10 px-2 py-0.5 text-alert-ink"}>{msg.tone === "warn" ? "⚠ " : "✓ "}{msg.text}</span>}
        </div>
      )}
      <AttachmentsField formId={formId} atts={atts} />
    </div>
  );
}

/** The box sits above the <form>, so the hidden input is attached with the HTML `form` attribute. */
function AttachmentsField({ formId, atts }: { formId: string; atts: Att[] }) {
  return <input type="hidden" name="attachments" form={formId} value={JSON.stringify(atts)} readOnly />;
}

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, uncertain: boolean): boolean {
  if (el instanceof HTMLSelectElement && !Array.from(el.options).some((o) => o.value === value)) return false;
  if (el instanceof HTMLInputElement && el.type === "checkbox") { el.checked = /^(1|true|yes|y)$/i.test(value); }
  else if (el instanceof HTMLInputElement && el.type === "datetime-local" && /^\d{4}-\d{2}-\d{2}$/.test(value)) el.value = `${value}T09:00`; // the paper gives a date, the field wants a time too
  else el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  // light blue = filled by recognition; orange = filled but the person must check it (low confidence or code not found in the document)
  el.classList.add(uncertain ? "ai-uncertain" : "ai-filled");
  el.addEventListener("input", () => el.classList.remove("ai-filled", "ai-uncertain"), { once: true });
  return true;
}

function fill(formId: string, fields: Record<string, string>, uncertain = new Set<string>()): number {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  if (!form) return 0;
  let n = 0;
  for (const [name, value] of Object.entries(fields)) {
    const el = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (!el || !("value" in el)) continue;
    if (setValue(el, value, uncertain.has(name))) n++;
  }
  return n;
}

/** Row inputs are named <prefix><index>; rows hidden by RevealRows are revealed by dispatching input on them. */
function fillLines(formId: string, lines: Record<string, string>[], map: Record<string, string>): number {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  if (!form) return 0;
  let n = 0;
  lines.forEach((line, i) => {
    for (const [col, prefix] of Object.entries(map)) {
      const value = line[col];
      if (value == null) continue;
      const el = form.elements.namedItem(`${prefix}${i}`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!el || !("value" in el)) continue;
      const row = el.closest("[data-row]") as HTMLElement | null;
      if (row) row.hidden = false;
      if (setValue(el, value, col === "hsCode")) n++; // an HS code may be the model's own classification: always for a person to check
    }
  });
  return n;
}
