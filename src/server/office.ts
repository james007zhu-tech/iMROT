/**
 * Where LibreOffice's `soffice` is on this host (PATH, or the macOS app bundle), so the Word reports can be turned
 * into PDF. Without it the render route hands out the .docx and buttons must say "Word", not "PDF" (trial 2026-11-05).
 * Looked up once per server process.
 */
import { access } from "node:fs/promises";
import path from "node:path";

let cached: Promise<string | null> | null = null;
export function sofficePath(): Promise<string | null> {
  cached ??= (async () => {
    const candidates = [
      ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "soffice")),
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/usr/lib/libreoffice/program/soffice",
    ];
    for (const p of candidates) {
      try { await access(p); return p; } catch { /* next */ }
    }
    return null;
  })();
  return cached;
}

export async function pdfAvailable(): Promise<boolean> {
  return (await sofficePath()) !== null;
}
