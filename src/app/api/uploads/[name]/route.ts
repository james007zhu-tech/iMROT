/**
 * GET /api/uploads/:name — photos, receipts, certificates and other attachments saved by saveUpload().
 * Staff only: these files include ID cards, salary letters' sources and customers' papers, and the system is
 * reachable from the internet (os.i-mrot.com), so nothing is served without a signed-in employee.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { sessionEmployeeCode } from "@/server/auth";
import { UPLOADS_DIR } from "@/lib/uploads";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".heic": "image/heic",
  ".txt": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".json": "application/json",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".webm": "audio/webm", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};
/** Types a browser may show in place; everything else downloads, so an uploaded HTML or SVG can never run as a page of ours. */
const INLINE = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  if (!(await sessionEmployeeCode())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  const { name } = await ctx.params;
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) return NextResponse.json({ error: "bad name" }, { status: 400 });
  const ext = path.extname(name).toLowerCase();
  try {
    const body = await readFile(path.join(UPLOADS_DIR, name));
    return new NextResponse(new Uint8Array(body), { headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-disposition": `${INLINE.has(ext) ? "inline" : "attachment"}; filename="${name}"`,
      "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
