"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

type Msg = { role: "user" | "assistant"; content: string; actions?: Action[] };
type Action = { type: "navigate" | "fill_form" | "dashboard" | "confirm" | "done"; href?: string; fields?: Record<string, string>; id?: string; summary?: string; state?: "done" | "cancelled" | "failed"; note?: string };

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
  const [files, setFiles] = useState<File[]>([]);
  const kept = useRef<{ name: string; url: string }[]>([]); // files already handed over in this conversation
  const recRef = useRef<{ stop: () => void } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => { if (msgs.length) bottom.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, open]);
  // the home conversation survives opening a record and coming back (this tab only)
  useEffect(() => {
    if (variant !== "page" || seed) return;
    try { const saved = JSON.parse(sessionStorage.getItem("dcit-chat") ?? "null"); if (saved?.msgs?.length) { setMsgs(saved.msgs); kept.current = saved.files ?? []; } } catch { /* storage unavailable: start empty */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (variant !== "page") return; try { sessionStorage.setItem("dcit-chat", JSON.stringify({ msgs: msgs.slice(-40), files: kept.current })); } catch { /* ignore */ } }, [msgs, variant]);
  const seeded = useRef(false);
  useEffect(() => { if (seed && !seeded.current) { seeded.current = true; void send(seed); } /* a message-centre "ask" arrives as ?ask= */ // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  async function send(text: string) {
    if ((!text.trim() && !files.length) || busy) return;
    const sent = files;
    const shown = [text.trim(), ...sent.map((f) => `📎 ${f.name}`)].filter(Boolean).join("\n");
    const next = [...msgs, { role: "user" as const, content: shown }];
    setMsgs(next); setInput(""); setFiles([]); setBusy(true);
    try {
      const payload = { messages: next.map(({ role, content }) => ({ role, content })), path, attachments: kept.current, fields: variant === "page" ? [] : Array.from(document.querySelectorAll<HTMLElement>("main form [name]")).map((el) => el.getAttribute("name")).filter((n, i, a): n is string => !!n && !n.startsWith("$") && a.indexOf(n) === i).slice(0, 80) };
      let r: Response;
      if (sent.length) { const fd = new FormData(); fd.append("payload", JSON.stringify(payload)); for (const f of sent) fd.append("file", f); r = await fetch("/api/ai/assist", { method: "POST", body: fd }); }
      else r = await fetch("/api/ai/assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      if (Array.isArray(j.files)) kept.current = j.files;
      setMsgs([...next, { role: "assistant", content: j.text, actions: j.actions }]);
      const go = (j.actions as Action[] | undefined)?.find((a) => a.type === "navigate");
      if (go?.href && variant !== "page") { router.push(go.href); } // on the home page the conversation stays; the answer carries a button instead
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠ ${(e as Error).message}` }]);
    } finally { setBusy(false); }
  }

  /** The person presses confirm / cancel on a card the assistant prepared (tax invoice, payment). */
  async function decide(mi: number, ai: number, go: boolean) {
    const a = msgs[mi]?.actions?.[ai];
    if (!a?.id || a.state) return;
    const patch = (p: Partial<Action>) => setMsgs((m) => m.map((x, i) => (i === mi ? { ...x, actions: x.actions?.map((y, k) => (k === ai ? { ...y, ...p } : y)) } : x)));
    try {
      const r = await fetch("/api/ai/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: a.id, go }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      patch({ state: go ? "done" : "cancelled", note: go ? j.summary : undefined, href: j.href });
    } catch (e) { patch({ state: "failed", note: (e as Error).message }); }
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
      {m.actions?.map((a, j) =>
        a.type === "fill_form" && a.fields ? <button key={j} onClick={() => fillForm(a.fields!)} className="mt-2 rounded bg-navy px-2 py-1 text-xs text-white">{t("fillForm")}</button>
        : a.type === "navigate" ? <a key={j} href={a.href} className="mt-2 flex items-center gap-2 rounded-lg border border-blue/40 bg-white px-3 py-2 text-[13px] font-semibold text-blue hover:bg-blue hover:text-white"><span className="flex-1">{t("openPage")}</span><span>→</span></a>
        : a.type === "done" ? <a key={j} href={a.href ?? "#"} className="mt-2 flex items-center gap-2 rounded-lg border border-[#BFE3CB] bg-white px-3 py-2 text-[13px] text-navy hover:border-blue"><span className="font-bold text-[#1F8A4C]">✓</span><span className="flex-1">{a.summary}</span>{a.href && <span className="text-blue">→</span>}</a>
        : a.type === "confirm" ? (
          <div key={j} className="mt-2 rounded-lg border border-[#F2C36B] bg-[#FFF9EC] px-3 py-2 text-[13px] text-navy">
            <div className="font-semibold">{a.summary}</div>
            {!a.state && <div className="mt-2 flex gap-2"><button type="button" onClick={() => void decide(i, j, true)} className="rounded-lg bg-navy px-3 py-1.5 text-xs font-bold text-white">{t("confirm")}</button><button type="button" onClick={() => void decide(i, j, false)} className="rounded-lg border border-navy/40 bg-white px-3 py-1.5 text-xs font-semibold">{t("cancel")}</button></div>}
            {a.state === "done" && <a href={a.href ?? "#"} className="mt-1 block text-[#1F8A4C]">✓ {a.note}</a>}
            {a.state === "cancelled" && <div className="mt-1 text-navy/60">{t("cancelled")}</div>}
            {a.state === "failed" && <div className="mt-1 text-alert-ink">⚠ {a.note}</div>}
          </div>
        ) : null)}
    </div>
  );
  const tools = (
    <>
      <button type="button" onClick={toggleVoice} title={t("voice")} className={`h-10 w-10 shrink-0 rounded-full ${listening ? "bg-alert/100 text-white" : "bg-blue/8"}`}>🎤</button>
      {scope === "staff" && <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-blue/8" title={t("attach")}>📎<input type="file" multiple accept="application/pdf,image/*,.txt,.csv,.eml" className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])].slice(0, 5)); e.target.value = ""; }} /></label>}
      {scope === "staff" && <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-blue/8" title={t("photo")}>📷<input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void attachPhoto(e.target.files[0])} /></label>}
    </>
  );
  const chips = files.length > 0 && <div className="flex w-full flex-wrap gap-1.5 pb-1">{files.map((f, k) => <span key={k} className="flex items-center gap-1 rounded-full bg-blue/10 px-2.5 py-1 text-xs text-navy">📎 {f.name}<button type="button" onClick={() => setFiles((x) => x.filter((_, n) => n !== k))} className="text-navy/60">✕</button></span>)}</div>;
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(input); } };
  const drop = { onDragOver: (e: React.DragEvent) => e.preventDefault(), onDrop: (e: React.DragEvent) => { if (scope !== "staff" || !e.dataTransfer.files.length) return; e.preventDefault(); setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 5)); } };
  /** big = the home page: the text on top across the full width, the tools in one row under it (as in the Claude app) */
  const composer = (big: boolean) => big ? (
    <form onSubmit={(e) => { e.preventDefault(); void send(input); }} {...drop} className="rounded-3xl border border-navy/20 bg-white px-3 pb-2.5 pt-3 shadow-sm focus-within:border-blue">
      {chips}
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={2} placeholder={t("placeholder")} className="block max-h-48 w-full resize-none border-0 px-2 text-[16px] leading-relaxed outline-none placeholder:not-italic placeholder:text-navy/40" />
      <div className="mt-1 flex items-center gap-2">{tools}<button disabled={busy} aria-label="send" className="ml-auto h-10 w-10 shrink-0 rounded-full bg-blue text-lg font-bold text-white disabled:opacity-50">↑</button></div>
    </form>
  ) : (
    <form onSubmit={(e) => { e.preventDefault(); void send(input); }} {...drop} className="flex flex-wrap items-end gap-1 border-t p-2">
      {chips}
      {tools}
      <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey} rows={1} placeholder={t("placeholder")} className="max-h-24 min-w-0 flex-1 resize-none rounded border px-3 py-2 text-sm" />
      <button disabled={busy} className="h-10 shrink-0 rounded-full bg-blue px-4 font-bold text-white disabled:opacity-50">↑</button>
    </form>
  );

  if (variant === "page") {
    const empty = msgs.length === 0;
    // 朱总 2026-11-10: nothing may jump when the first message is sent. The box is fixed to the bottom edge from the
    // first screen on (phone and desk); only what is above it changes — greeting and suggestions, then the messages.
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col pb-44">
        {empty ? (
          <div className="flex min-h-[calc(100dvh-20rem)] flex-col justify-center">
            {greeting && <h1 className="mb-5 text-center text-[22px] font-bold leading-snug text-navy md:mb-6 md:text-[28px]">{greeting}</h1>}
            {suggestions.length > 0 && <div className="flex flex-wrap justify-center gap-2">{suggestions.map((sg) => <button key={sg} type="button" onClick={() => void send(sg)} className="rounded-full border border-navy/20 bg-white px-3.5 py-1.5 text-[13px] text-navy hover:border-blue hover:text-blue">{sg}</button>)}</div>}
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-[14.5px]">
            {msgs.map(bubble)}{busy && <div className="mr-auto rounded-2xl bg-[#F4F7FB] px-3 py-2 text-navy/70">{t("working")}</div>}<div ref={bottom} />
            <button type="button" onClick={() => { setMsgs([]); kept.current = []; }} className="mx-auto mt-2 text-xs text-navy/50 hover:text-blue">{t("newChat")}</button>
          </div>
        )}
        <div className="fixed inset-x-0 bottom-0 z-20 bg-gradient-to-t from-[#F4F7FB] from-75% px-4 pt-4 md:left-56 md:px-6" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom, 0px))" }}>
          <div className="mx-auto max-w-3xl">{composer(true)}</div>
        </div>
      </div>
    );
  }
  if (path === "/home") return null; // the home page is the conversation itself
  return (
    <>
      <button onClick={() => setOpen((o) => !o)} aria-label="AI" className="ai-fab fixed bottom-3 right-3 z-40 h-12 w-12 md:bottom-4 md:right-4 md:h-14 md:w-14">
        {/* the "i" of DCiT: white stem, blue square dot — the dot is the live part */}
        <span className="ai-fab-pulse" aria-hidden /><span className="ai-fab-ring" aria-hidden />
        <svg viewBox="0 0 48 48" aria-hidden className="relative h-full w-full"><rect x="20.5" y="20" width="7" height="16" fill="#fff" /><rect x="20.5" y="10.5" width="7" height="7" className="ai-fab-dot" /></svg>
      </button>
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
