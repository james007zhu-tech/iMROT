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

/**
 * Word → PDF with LibreOffice, safely:
 *  - one conversion at a time per server process, on a profile of its own (no clash with another soffice);
 *  - the PDF counts only if this run wrote it (soffice exits 0 without converting when its profile is held by a
 *    hung instance — the cause of old reports being handed out, 2026-11-08);
 *  - on a miss, retried once on a brand-new profile, which also becomes the profile for later conversions.
 */
let queue: Promise<unknown> = Promise.resolve();
let profile: string | null = null;

export function convertToPdf(docxPath: string, outDir: string): Promise<string | undefined> {
  const job = queue.then(() => convertNow(docxPath, outDir));
  queue = job.catch(() => undefined);
  return job;
}

async function convertNow(docxPath: string, outDir: string): Promise<string | undefined> {
  const soffice = await sofficePath();
  if (!soffice) return undefined;
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, stat, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const exec = promisify(execFile);
  const out = path.join(outDir, `${path.basename(docxPath, path.extname(docxPath))}.pdf`);
  const run = async (dir: string) => {
    await rm(out, { force: true });
    try { await exec(soffice, [`-env:UserInstallation=${pathToFileURL(dir).href}`, "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", outDir, docxPath], { timeout: 120000 }); }
    catch (e) { console.error(`[office] soffice: ${(e as Error).message.slice(0, 200)}`); }
    return ((await stat(out).catch(() => null))?.size ?? 0) > 0;
  };
  profile ??= await mkdtemp(path.join(tmpdir(), "dcit-lo-"));
  if (await run(profile)) return out;
  const fresh = await mkdtemp(path.join(tmpdir(), "dcit-lo-"));
  const old = profile;
  profile = fresh;
  await rm(old, { recursive: true, force: true }).catch(() => {});
  if (await run(fresh)) return out;
  console.error(`[office] no PDF for ${path.basename(docxPath)} even on a fresh profile`);
  return undefined;
}
