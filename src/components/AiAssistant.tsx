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
export function AiAssistant({ scope, variant = "float", suggestions = [], seed, greeting }: { scope: "staff" | "portal"; variant?: "float" | "page"; suggestions?: string[]; seed?: string; greeting?: string }) {
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
  useEffect(() => { if (msgs.length) bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);
  const seeded = useRef(false);
  useEffect(() => { if (seed && !seeded.current) { seeded.current = true; void send(seed); } /* a message-centre "ask" arrives as ?ask= */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function send(text: string) {
    if (!text.trim() || busy) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next); setInput(""); setBusy(true);
    try {
      const r = await fetch("/api/ai/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), path, fields: Array.from(document.querySelectorAll<HTMLElement>("form [name]")).map((el) => el.getAttribute("name")).filter((n, i, a): n is string => !!n && a.indexOf(n) === i).slice(0, 80) }) });
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

  const bubble = (m: Msg, i: number) => (
    <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-2xl bg-blue/10 px-3 py-2" : "mr-auto max-w-[95%] rounded-2xl bg-[#F4F7FB] px-3 py-2"}>
      {m.role === "user" ? <div className="whitespace-pre-wrap">{m.content}</div> : <Md text={m.content} />}
      {m.actions?.map((a, j) => a.type === "fill_form" && a.fields ? <button key={j} onClick={() => fillForm(a.fields!)} className="mt-2 rounded bg-navy px-2 py-1 text-xs text-white">{t("fillForm")}</button> : a.type === "navigate" ? <a key={j} href={a.href} className="mt-2 inline-block text-xs text-blue underline">{a.href}</a> : null)}
    </div>
  );
  const composer = (big: boolean) => (
    <form onSubmit={(e) => { e.preventDefault(); void send(input); }} className={big ? "flex items-end gap-2 rounded-2xl border border-navy/25 bg-white p-2.5 shadow-sm focus-within:border-blue" : "flex items-end gap-1 border-t p-2"}>
      <button type="button" onClick={toggleVoice} title={t("voice")} className={`h-10 w-10 shrink-0 rounded-full ${listening ? "bg-alert/100 text-white" : "bg-blue/8"}`}>🎤</button>
      {scope === "staff" && <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-blue/8" title={t("photo")}>📷<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void attachPhoto(e.target.files[0])} /></label>}
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } }} rows={big ? 2 : 1} autoFocus={big} placeholder={t("placeholder")} className={`flex-1 resize-none px-3 py-2 ${big ? "max-h-48 border-0 text-[15px] outline-none" : "max-h-24 rounded border text-sm"}`} />
      <button disabled={busy} className="h-10 shrink-0 rounded-full bg-blue px-4 font-bold text-white disabled:opacity-50">↑</button>
    </form>
  );

  if (variant === "page") {
    const empty = msgs.length === 0;
    return (
      <div className={`mx-auto flex w-full max-w-3xl flex-col ${empty ? "pt-[8vh]" : "min-h-[calc(100vh-9rem)]"}`}>
        {empty && greeting && <h1 className="mb-6 text-center text-2xl font-bold text-navy md:text-[28px]">{greeting}</h1>}
        {!empty && <div className="flex flex-1 flex-col gap-3 pb-4 text-[14.5px]">{msgs.map(bubble)}{busy && <div className="mr-auto rounded-2xl bg-[#F4F7FB] px-3 py-2 text-navy/70">…</div>}<div ref={bottom} /></div>}
        <div className={empty ? "" : "sticky bottom-0 bg-gradient-to-t from-[#F4F7FB] from-70% pb-3 pt-2"}>{composer(true)}</div>
        {empty && <p className="mt-2 text-center text-xs text-navy/60">{t("hintStaff")}</p>}
        {empty && suggestions.length > 0 && <div className="mt-5 flex flex-wrap justify-center gap-2">{suggestions.map((sg) => <button key={sg} type="button" onClick={() => void send(sg)} className="rounded-full border border-navy/20 bg-white px-3.5 py-1.5 text-[13px] text-navy hover:border-blue hover:text-blue">{sg}</button>)}</div>}
      </div>
    );
  }
  if (path === "/home") return null; // the home page is the conversation itself
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-label="AI" className="fixed bottom-4 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-blue text-xl font-bold text-white shadow-lg">AI</button>
      {open && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex h-[70vh] flex-col rounded-t-2xl border bg-white shadow-2xl md:inset-x-auto md:bottom-20 md:right-4 md:h-[32rem] md:w-96 md:rounded-2xl">
          <div className="flex items-center justify-between border-b px-4 py-2"><b className="text-navy">{t("title")}</b><button onClick={() => setOpen(false)} className="text-navy/70">✕</button></div>
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3 text-sm">
            {msgs.length === 0 && <p className="text-navy/70">{scope === "portal" ? t("hintPortal") : t("hintStaff")}</p>}
            {msgs.map(bubble)}
            {busy && <div className="mr-auto rounded-2xl bg-[#F4F7FB] px-3 py-2 text-navy/70">…</div>}
            <div ref={bottom} />
          </div>
          {composer(false)}
        </div>
      )}
    </>
  );
}

/** Light Markdown for answers: tables, bullets, bold, and record numbers (QTTH…, ATH…) as links to the search. */
function Md({ text }: { text: string }) {
  const inline = (s: string, k: number) => s.split(/(\*\*[^*]+\*\*|\b[A-Z]{1,2}(?:TH|VN|ID|CN)\d{6,}\b)/g).map((p, i) =>
    /^\*\*.+\*\*$/.test(p) ? <b key={`${k}-${i}`}>{p.slice(2, -2)}</b> : /^[A-Z]{1,2}(?:TH|VN|ID|CN)\d{6,}$/.test(p) ? <a key={`${k}-${i}`} href={`/search?q=${p}`} className="font-mono text-blue hover:underline">{p}</a> : p);
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim())); i++; }
      i--;
      blocks.push(<div key={i} className="my-1 overflow-x-auto"><table className="w-full border-collapse text-[13px]"><thead><tr>{rows[0]?.map((c, j) => <th key={j} className="border-b border-navy/20 px-2 py-1 text-left font-semibold">{inline(c, j)}</th>)}</tr></thead><tbody>{rows.slice(1).map((r, a) => <tr key={a}>{r.map((c, j) => <td key={j} className="border-b border-hair px-2 py-1 align-top">{inline(c, j)}</td>)}</tr>)}</tbody></table></div>);
    } else if (/^\s*[-*•]\s+/.test(l)) blocks.push(<div key={i} className="flex gap-2 pl-1"><span className="text-navy/50">•</span><span>{inline(l.replace(/^\s*[-*•]\s+/, ""), i)}</span></div>);
    else if (/^#{1,4}\s+/.test(l)) blocks.push(<div key={i} className="mt-1 font-bold text-navy">{inline(l.replace(/^#{1,4}\s+/, ""), i)}</div>);
    else if (!l.trim()) blocks.push(<div key={i} className="h-2" />);
    else blocks.push(<div key={i}>{inline(l, i)}</div>);
  }
  return <div className="space-y-0.5 leading-relaxed">{blocks}</div>;
}

interface SpeechRecognitionLike { lang: string; interimResults: boolean; continuous: boolean; onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; start: () => void; stop: () => void }
