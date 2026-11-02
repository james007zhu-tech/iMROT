"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

type Msg = { role: "user" | "assistant"; content: string; actions?: Action[] };
type Action = { type: "navigate" | "fill_form" | "dashboard"; href?: string; fields?: Record<string, string> };

/**
 * Floating assistant available on every page: type, dictate (Web Speech API), or attach a nameplate photo.
 * Answers come with record numbers; drafts can be written into the form on the current page with one tap.
 */
export function AiAssistant({ scope }: { scope: "staff" | "portal" }) {
  const t = useTranslations("ai");
  const locale = useLocale();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<{ stop: () => void } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/ai/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), path }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setMsgs([...next, { role: "assistant", content: j.text, actions: j.actions }]);
      const go = (j.actions as Action[] | undefined)?.find((a) => a.type === "navigate");
      if (go?.href) { router.push(go.href); }
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠ ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }

  function fillForm(fields: Record<string, string>) {
    let n = 0;
    for (const [k, v] of Object.entries(fields)) {
      const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${k}"]`);
      if (!el) continue;
      const setter = Object.getOwnPropertyDescriptor(el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")?.set;
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      n++;
    }
    setMsgs((m) => [...m, { role: "assistant", content: t("filled", { n }) }]);
  }

  function toggleVoice() {
    if (listening) { recRef.current?.stop(); setListening(false); return; }
    const SR = (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike; SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!SR) { setMsgs((m) => [...m, { role: "assistant", content: t("noVoice") }]); return; }
    const rec = new SR();
    rec.lang = locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US";
    rec.interimResults = true; rec.continuous = true;
    let finalText = "";
    rec.onresult = (ev) => { let interim = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript; } setInput(finalText + interim); };
    rec.onend = () => setListening(false);
    rec.start(); recRef.current = rec; setListening(true);
  }

  async function attachPhoto(file: File) {
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("photo", file);
      const r = await fetch("/api/ai/nameplate", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      const fields: Record<string, string> = {};
      if (j.serialNumber) fields.serialNumber = j.serialNumber;
      if (j.matchedModelId) fields.modelId = j.matchedModelId;
      setMsgs((m) => [...m, { role: "user", content: `📷 ${file.name}` }, { role: "assistant", content: `${j.brand ?? "?"} ${j.series ?? ""} ${j.model ?? "?"} · S/N ${j.serialNumber ?? "?"} · ${Math.round((j.confidence ?? 0) * 100)}%${j.notes ? `\n${j.notes}` : ""}`, actions: Object.keys(fields).length ? [{ type: "fill_form", fields }] : [] }]);
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", content: `⚠ ${(e as Error).message}` }]); } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-label="AI" className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue text-xl font-bold text-white shadow-lg">AI</button>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col rounded-t-2xl border bg-white shadow-2xl md:inset-x-auto md:bottom-20 md:right-4 md:h-[32rem] md:w-96 md:rounded-2xl">
          <div className="flex items-center justify-between border-b px-4 py-2"><b className="text-navy">{t("title")}</b><button onClick={() => setOpen(false)} className="text-slate-500">✕</button></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-3 text-sm">
            {msgs.length === 0 && <p className="text-slate-500">{scope === "portal" ? t("hintPortal") : t("hintStaff")}</p>}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "ml-8 rounded-lg bg-blue/10 p-2" : "mr-8 rounded-lg bg-slate-100 p-2"}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.actions?.map((a, j) => a.type === "fill_form" && a.fields ? <button key={j} onClick={() => fillForm(a.fields!)} className="mt-2 rounded bg-navy px-2 py-1 text-xs text-white">{t("fillForm")}</button> : a.type === "navigate" ? <a key={j} href={a.href} className="mt-2 inline-block text-xs text-blue underline">{a.href}</a> : null)}
              </div>
            ))}
            {busy && <div className="mr-8 rounded-lg bg-slate-100 p-2 text-slate-500">…</div>}
            <div ref={bottom} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className="flex items-end gap-1 border-t p-2">
            <button type="button" onClick={toggleVoice} title={t("voice")} className={`h-10 w-10 rounded-full ${listening ? "bg-rose-500 text-white" : "bg-slate-100"}`}>🎤</button>
            {scope === "staff" && <label className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-slate-100" title={t("photo")}>📷<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void attachPhoto(e.target.files[0])} /></label>}
            <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} rows={1} placeholder={t("placeholder")} className="max-h-24 flex-1 resize-none rounded border px-3 py-2 text-sm" />
            <button disabled={busy} className="h-10 rounded bg-blue px-3 text-white disabled:opacity-50">↑</button>
          </form>
        </div>
      )}
    </>
  );
}

interface SpeechRecognitionLike { lang: string; interimResults: boolean; continuous: boolean; onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void }
