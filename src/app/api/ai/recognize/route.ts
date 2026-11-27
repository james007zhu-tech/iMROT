import { NextResponse } from "next/server";
import { errorCode, errorStatus } from "@/lib/errors";
import { saveUpload, UPLOADS_DIR } from "@/lib/uploads";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".txt": "text/plain", ".csv": "text/csv", ".eml": "text/plain" };
export const maxDuration = 300;
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";
import { recognizeDocuments } from "@/server/recognize";
import { RECOGNIZE, type RecognizeKind } from "@/lib/recognize";

function liveFields(raw: FormDataEntryValue | null) {
  try { const a = JSON.parse(String(raw ?? "[]")); return Array.isArray(a) ? a.slice(0, 140).map((f) => ({ name: String(f.name), label: f.label ? String(f.label).slice(0, 80) : undefined, value: f.value ? String(f.value).slice(0, 200) : undefined, options: Array.isArray(f.options) ? f.options.map((o: unknown) => String(o).slice(0, 90)).slice(0, 40) : undefined, type: f.type ? String(f.type) : undefined })) : []; } catch { return []; }
}

/** POST multipart: kind, text?, file* → saved attachments + fields to fill. Staff or portal contact. */
export async function POST(req: Request) {
  if (!(await sessionEmployeeCode()) && !(await sessionContactId())) return NextResponse.json({ error: "not signed in" }, { status: 401 });
  try {
    const form = await req.formData();
    const kind = String(form.get("kind")) as RecognizeKind;
    if (!(kind in RECOGNIZE)) return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    const files = [];
    for (const f of form.getAll("file")) {
      if (!(f instanceof File) || f.size === 0) continue;
      const saved = await saveUpload(f, RECOGNIZE[kind].attachKind.toLowerCase());
      files.push({ ...saved, original: f.name, mediaType: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) });
    }
    // 先存后读 (朱总 2026-11-27: "已经提交了签字文件，但是页面无法识别"): the page first saves the files (saveOnly) and has
    // them on the form at once; reading them comes second, from the saved copies, and a reading that fails or is slow
    // never costs the upload.
    const fallback = files.map((f) => ({ name: f.original, url: f.url, kind: RECOGNIZE[kind].attachKind }));
    if (form.get("saveOnly")) return NextResponse.json({ attachments: fallback });
    try { for (const a of JSON.parse(String(form.get("saved") || "[]")) as { name?: string; url?: string }[]) {
      const m = /^\/api\/uploads\/([A-Za-z0-9._-]+)$/.exec(String(a?.url ?? ""));
      const bytes = m ? await readFile(nodePath.join(UPLOADS_DIR, m[1])).catch(() => null) : null;
      if (m && bytes) files.push({ name: m[1], url: a.url!, original: String(a.name ?? m[1]).slice(0, 200), mediaType: TYPES[nodePath.extname(m[1]).toLowerCase()] ?? "application/octet-stream", bytes });
    } } catch { /* no saved refs */ }
    const saved = files.map((f) => ({ name: f.original, url: f.url, kind: RECOGNIZE[kind].attachKind }));
    let r: Awaited<ReturnType<typeof recognizeDocuments>>;
    try {
      r = await recognizeDocuments(kind, files.map((f) => ({ name: f.original, url: f.url, mediaType: f.mediaType, bytes: f.bytes })), String(form.get("text") || "") || undefined, String(form.get("context") || "") || undefined, liveFields(form.get("form")));
    } catch (e) {
      if (!saved.length) throw e;
      console.warn(`[recognize] ${kind}: reading failed, files kept — ${errorCode(e)}`);
      return NextResponse.json({ fields: {}, uncertain: [], usedModel: false, notes: "read-failed", attachments: saved });
    }
    const kindLabel = r.docKind && RECOGNIZE[kind].accept?.includes(r.docKind.toUpperCase()) ? r.docKind.toUpperCase() : RECOGNIZE[kind].attachKind;
    return NextResponse.json({ ...r, attachments: saved.map((f) => ({ ...f, kind: kindLabel })) });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: errorStatus(e) });
  }
}
