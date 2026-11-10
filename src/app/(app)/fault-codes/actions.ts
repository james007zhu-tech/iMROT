"use server";
import { getTranslations } from "next-intl/server";
/** Server actions of the knowledge pages, bound to plain values only (rule 19). */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { importFaultCodes, publishKnowledge, reviewCodes, saveFaultCode, saveSeries } from "@/server/knowledge";
import { LANGS, lines } from "@/lib/knowledge";
import { UPLOADS_DIR } from "@/lib/uploads";
import { readZip } from "@/lib/docx/zip";

/** Bulk review from a code list: the checked ids + the pressed button's action. */
export async function bulkReviewAction(back: string, op: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const ids = f.getAll("id").map(String).filter(Boolean);
    if (!ids.length) throw new Error("NOTHING_SELECTED");
    if (!op) throw new Error("INVALID_INPUT");
    const r = await reviewCodes({ ids, action: op as never, note: String(f.get("note") ?? ""), actorCode: me.code });
    return r.skipped.length ? `${r.changed} · skipped ${r.skipped.length}` : `${r.changed}`;
  }, back);
}

export async function publishAction(back: string) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await publishKnowledge(me.code);
    return `+${r.added} ~${r.updated} -${r.removed}`;
  }, back);
}

// Imports: the uploaded file is kept under uploads/imports (not served) between preview and commit.
const IMPORT_DIR = path.join(path.dirname(UPLOADS_DIR), "imports");

export async function previewImportAction(f: FormData) {
  await guarded(async () => {
    await currentEmployee();
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("NOTHING_SELECTED");
    let name = file.name, text: string;
    const buf = Buffer.from(await file.arrayBuffer());
    if (/\.zip$/i.test(name)) {
      // Grok hands over a zip: README + JSON + CSV — take the JSON, else the CSV
      const entries = readZip(buf);
      const pick = entries.find((e) => /\.json$/i.test(e.name)) ?? entries.find((e) => /\.csv$/i.test(e.name));
      if (!pick) throw new Error("IMPORT_FORMAT");
      name = pick.name; text = pick.data.toString("utf8");
    } else text = buf.toString("utf8");
    const token = randomUUID();
    await mkdir(IMPORT_DIR, { recursive: true });
    await writeFile(path.join(IMPORT_DIR, `${token}.txt`), text);
    const q = new URLSearchParams({ token, name, category: String(f.get("categoryCode") ?? ""), series: String(f.get("seriesId") ?? "") });
    return { ok: "preview", to: `/fault-codes/import?${q}` };
  }, "/fault-codes/import");
}

export async function readImport(token: string): Promise<string> {
  await currentEmployee();
  if (!/^[0-9a-f-]{36}$/.test(token)) throw new Error("INVALID_INPUT");
  return readFile(path.join(IMPORT_DIR, `${token}.txt`), "utf8");
}

export async function commitImportAction(token: string, name: string, categoryCode: string, seriesId: string) {
  await guarded(async () => {
    const me = await currentEmployee();
    const r = await importFaultCodes({ fileName: name, text: await readImport(token), actorCode: me.code, dryRun: false, createMissing: true, categoryCode: categoryCode || undefined, seriesId: seriesId || undefined });
    const u = await getTranslations("ui");
    return { ok: u("kbImported", { created: r.counts!.created, updated: r.counts!.updated, skipped: r.counts!.skipped }), to: "/fault-codes?status=REVIEW" };
  }, `/fault-codes/import?token=${token}&name=${encodeURIComponent(name)}`);
}

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };

/** Save one fault code from its page (new when id is ""). */
export async function saveCodeAction(id: string, f: FormData) {
  let to = id ? `/fault-codes/${id}` : "/fault-codes/new";
  await guarded(async () => {
    const me = await currentEmployee();
    const publicText = Object.fromEntries(LANGS.map((l) => [l, { title: str(f, `title_${l}`), meaning: str(f, `meaning_${l}`), causes: lines(str(f, `causes_${l}`)), checks: lines(str(f, `checks_${l}`)), remedy: str(f, `remedy_${l}`), safety: str(f, `safety_${l}`), prepare: str(f, `prepare_${l}`) }]));
    const manualText = Object.fromEntries(LANGS.map((l) => [l, { meaning: str(f, `manual_${l}_meaning`), actions: str(f, `manual_${l}_actions`) }]));
    const c = await saveFaultCode(id || null, {
      seriesId: String(f.get("seriesId") ?? ""), code: String(f.get("code") ?? ""), kind: str(f, "kind"), mustStop: str(f, "mustStop"), appliesTo: str(f, "appliesTo"),
      publicText, manualText, related: (str(f, "related") ?? "").split(/[,，\s]+/), keywords: (str(f, "keywords") ?? "").split(/[|｜,，]/),
      source: { title: str(f, "source_title"), docId: str(f, "source_docId"), revision: str(f, "source_revision"), date: str(f, "source_date"), page: Number(str(f, "source_page")) || undefined, url: str(f, "source_url") },
      internalNotes: str(f, "internalNotes"), commonParts: str(f, "commonParts"),
    }, me.code);
    to = `/fault-codes/${c.id}`;
    return { ok: c.code, to };
  }, to);
}

/** Save a series from the dictionary form (new when id is ""). */
export async function saveSeriesAction(id: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const s = await saveSeries(id || null, {
      brandId: String(f.get("brandId") ?? ""), code: String(f.get("code") ?? ""), name: String(f.get("name") ?? ""), categoryCode: str(f, "categoryCode"),
      lifecycle: (str(f, "lifecycle") ?? "ACTIVE") as never, successorId: str(f, "successorId"), aliases: (str(f, "aliases") ?? "").split(/[,，]+/),
      codePattern: str(f, "codePattern"), codeRule: str(f, "codeRule"), notes: str(f, "notes"), slug: str(f, "slug"),
      publicVisible: f.get("publicVisible") === "on", active: f.get("active") === "on",
    }, me.code);
    return { ok: s.name, to: `/series/${s.id}` };
  }, id ? `/series/${id}` : "/series/new");
}
