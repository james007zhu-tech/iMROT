import { NextResponse } from "next/server";
import { errorCode } from "@/lib/errors";
import { saveUpload } from "@/lib/uploads";
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";
import { recognizeDocuments } from "@/server/recognize";
import { RECOGNIZE, type RecognizeKind } from "@/lib/recognize";

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
    const r = await recognizeDocuments(kind, files.map((f) => ({ name: f.original, url: f.url, mediaType: f.mediaType, bytes: f.bytes })), String(form.get("text") || "") || undefined);
    const kindLabel = r.docKind && RECOGNIZE[kind].accept?.includes(r.docKind.toUpperCase()) ? r.docKind.toUpperCase() : RECOGNIZE[kind].attachKind;
    return NextResponse.json({ ...r, attachments: files.map((f) => ({ name: f.original, url: f.url, kind: kindLabel })) });
  } catch (e) {
    return NextResponse.json({ error: errorCode(e) }, { status: 400 });
  }
}
