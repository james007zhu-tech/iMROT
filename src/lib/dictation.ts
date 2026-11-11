"use client";
/**
 * 口述 that works on every phone (朱总 2026-11-10: Chrome on a phone has no speech input). Three ways, best first:
 *   record   the page records the voice and the server turns it into text — any browser, needs HTTPS and a
 *            speech service configured on the server (GET /api/ai/transcribe says whether it is)
 *   native   the browser's own speech recognition (Safari, desktop Chrome)
 *   keyboard neither: the text box is opened and focused, and the person uses the microphone key of the phone's
 *            keyboard — works everywhere, also on plain http
 */
import { useEffect, useRef, useState } from "react";

export type DictationMode = "record" | "native" | "keyboard";
export type DictationState = "idle" | "listening" | "transcribing";

type SR = { lang: string; interimResults: boolean; continuous: boolean; onresult: ((ev: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start: () => void; stop: () => void };

let sttEnabled: Promise<boolean> | null = null;
const serverStt = () => (sttEnabled ??= fetch("/api/ai/transcribe").then((r) => r.json()).then((j) => !!j.enabled).catch(() => false));

export function useDictation(locale: string, opts: { onText: (text: string, final: boolean) => void; onError: (code: "denied" | "failed") => void; base?: () => string }) {
  const [state, setState] = useState<DictationState>("idle");
  const [mode, setMode] = useState<DictationMode>("keyboard");
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => {
    let alive = true;
    const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    const canRecord = window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
    void serverStt().then((on) => { if (alive) setMode(on && canRecord ? "record" : w.SpeechRecognition || w.webkitSpeechRecognition ? "native" : "keyboard"); });
    return () => { alive = false; stop.current?.(); };
  }, []);

  async function start() {
    const before = opts.base?.() ?? "";
    const join = (t: string) => (before && t ? `${before} ${t}` : before || t);
    if (mode === "record") {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { opts.onError("denied"); return; }
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setState("transcribing");
        try {
          const blob = new Blob(chunks, { type: rec.mimeType || "audio/mp4" });
          const fd = new FormData(); fd.append("audio", blob, `voice.${/webm/.test(blob.type) ? "webm" : /ogg/.test(blob.type) ? "ogg" : "m4a"}`); fd.append("locale", locale);
          const r = await fetch("/api/ai/transcribe", { method: "POST", body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          opts.onText(join(String(j.text ?? "").trim()), true);
        } catch { opts.onError("failed"); } finally { setState("idle"); }
      };
      rec.start(); stop.current = () => { if (rec.state !== "inactive") rec.stop(); }; setState("listening");
      return;
    }
    if (mode === "native") {
      const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
      const r = new (w.SpeechRecognition ?? w.webkitSpeechRecognition)!();
      r.lang = locale === "th" ? "th-TH" : locale === "zh" ? "zh-CN" : "en-US"; r.interimResults = true; r.continuous = true;
      let said = "";
      r.onresult = (ev) => { let interim = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const x = ev.results[i]; if (x.isFinal) said += x[0].transcript; else interim += x[0].transcript; } opts.onText(join(said + interim), false); };
      r.onend = () => { setState("idle"); opts.onText(join(said), true); };
      r.onerror = () => { setState("idle"); if (!said) opts.onError("failed"); };
      try { r.start(); } catch { opts.onError("failed"); return; }
      stop.current = () => r.stop(); setState("listening");
    }
    // keyboard: nothing to start — the caller opens its text box
  }

  return { state, mode, toggle: () => (state === "listening" ? stop.current?.() : state === "idle" ? void start() : undefined) };
}
