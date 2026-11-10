import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { getLocale } from "next-intl/server";
import { assist, type AssistFile } from "@/server/ai";
import { sessionScope } from "@/server/api-auth";
import { saveUpload, UPLOADS_DIR } from "@/lib/uploads";
import { readFile } from "node:fs/promises";
import nodePath from "node:path";

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".txt": "text/plain", ".csv": "text/csv", ".eml": "text/plain" };

export const maxDuration = 300;

/**
 * POST — staff or portal contact (decided by the signed session cookie).
 *  JSON { messages:[{role,content}], path, fields }, or multipart with the same JSON in "payload" plus file*:
 *  staff may hand the assistant documents (inquiry, PO, nameplate, screenshot); they are saved and read by the model.
 */
export async function POST(req: Request) {
  try {
    const scope = await sessionScope();
    if (!scope) return NextResponse.json({ error: "not signed in" }, { status: 401 });
    let body: { messages: { role: "user" | "assistant"; content: string }[]; path?: string; fields?: string[]; attachments?: { name: string; url: string }[] };
    const files: AssistFile[] = [];
    if (req.headers.get("content-type")?.includes("multipart/form-data")) {
      const form = await req.formData();
      body = JSON.parse(String(form.get("payload") ?? "{}"));
      if (scope.kind === "staff") for (const f of form.getAll("file")) {
        if (!(f instanceof File) || f.size === 0 || f.size > 20_000_000) continue;
        const saved = await saveUpload(f, "chat");
        files.push({ name: f.name, url: saved.url, mediaType: f.type || "application/octet-stream", bytes: Buffer.from(await f.arrayBuffer()) });
      }
    } else body = await req.json();
    // files handed over earlier in this conversation stay in front of the model (the client sends back their refs)
    if (scope.kind === "staff") for (const a of (body.attachments ?? []).slice(-5)) {
      const m = /^\/api\/uploads\/([A-Za-z0-9._-]+)$/.exec(String(a?.url ?? ""));
      if (!m || files.some((f) => f.url === a.url)) continue;
      const bytes = await readFile(nodePath.join(UPLOADS_DIR, m[1])).catch(() => null);
      if (bytes) files.unshift({ name: String(a.name).slice(0, 200), url: a.url, mediaType: TYPES[nodePath.extname(m[1]).toLowerCase()] ?? "application/octet-stream", bytes });
    }
    const locale = await getLocale();
    const { messages, path, fields } = body;
    const out = await assist(messages, scope.kind === "staff"
      ? { employeeCode: scope.employeeCode, locale, path, fields }
      : { contactId: scope.contactId, customerId: scope.customerId, locale, path, fields }, files);
    return NextResponse.json({ ...out, files: files.map((f) => ({ name: f.name, url: f.url })) });
  } catch (e) { return NextResponse.json({ error: errorCode(e) }, { status: 400 }); }
}
