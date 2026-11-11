import { NextResponse } from "next/server";
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";

export const maxDuration = 120;

/**
 * Speech to text for 口述 on browsers without speech recognition (Chrome and in-app browsers on a phone).
 * Any service that speaks the OpenAI transcription API: STT_URL (default https://api.openai.com/v1), STT_KEY
 * (or OPENAI_API_KEY), STT_MODEL (default gpt-4o-transcribe). A Whisper server on our own machine works the same
 * way — set STT_URL to it. Without a key and without STT_URL the feature is off and the page falls back to the
 * phone keyboard's microphone.
 */
const base = () => (process.env.STT_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
const key = () => process.env.STT_KEY ?? process.env.OPENAI_API_KEY ?? "";
const enabled = () => !!key() || !!process.env.STT_URL;

// trade words the recogniser would otherwise mishear; mixed Chinese / Thai / English is normal on site
const HINT = "DCiT 工业现场口述：变频器, 逆变, 直流母线, IGBT, 功率模块, 散热器, 风扇, 绝缘, 兆欧, 过流, 过压, 接地, 编码器, PLC, 伺服, SINAMICS, S120, G120, MICROMASTER, FR-A800, MD500, ACS880, F30001, A07900, 报价, 送货单, อินเวอร์เตอร์, มอเตอร์, พัดลม, ฉนวน, กระแสเกิน";

export async function GET() {
  return NextResponse.json({ enabled: enabled() });
}

export async function POST(req: Request) {
  if (!(await sessionEmployeeCode()) && !(await sessionContactId())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  if (!enabled()) return NextResponse.json({ error: "STT_NOT_CONFIGURED" }, { status: 501 });
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size === 0) return NextResponse.json({ error: "no audio" }, { status: 400 });
    if (audio.size > 24_000_000) return NextResponse.json({ error: "AUDIO_TOO_LONG" }, { status: 413 });
    const out = new FormData();
    out.append("file", audio, audio.name || "voice.m4a");
    out.append("model", process.env.STT_MODEL ?? "gpt-4o-transcribe");
    out.append("prompt", HINT);
    // no language is forced: engineers mix Chinese, Thai and English in one sentence
    const r = await fetch(`${base()}/audio/transcriptions`, { method: "POST", headers: key() ? { authorization: `Bearer ${key()}` } : {}, body: out, signal: AbortSignal.timeout(110_000) });
    const text = await r.text();
    if (!r.ok) { console.warn(`[stt] ${r.status} ${text.slice(0, 300)}`); return NextResponse.json({ error: "STT_FAILED" }, { status: 502 }); }
    let said = text;
    try { said = (JSON.parse(text) as { text?: string }).text ?? ""; } catch { /* a plain-text reply */ }
    return NextResponse.json({ text: said.trim() });
  } catch (e) {
    console.warn("[stt]", e);
    return NextResponse.json({ error: "STT_FAILED" }, { status: 502 });
  }
}
