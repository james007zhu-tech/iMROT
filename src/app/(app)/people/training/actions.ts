"use server";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { recordTraining, removeTraining, LEVELS, TRAINING_RESULTS } from "@/server/training";

const str = (f: FormData, k: string) => { const v = String(f.get(k) ?? "").trim(); return v || undefined; };
const BACK = "/people/training";

export async function recordAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const atts = (() => { try { return JSON.parse(String(f.get("attachments") || "[]")) as { name: string; url: string }[]; } catch { return []; } })();
    const codes = f.getAll("employeeCodes").map(String).filter(Boolean);
    const date = (k: string) => (str(f, k) ? new Date(str(f, k)!) : undefined);
    const num = (k: string) => (str(f, k) ? Number(str(f, k)) : undefined);
    const n = await recordTraining({
      actorCode: me.code, employeeCodes: codes.length ? codes : [me.code], title: String(f.get("title") ?? ""), kind: String(f.get("kind") ?? ""), provider: str(f, "provider"),
      startedOn: new Date(String(f.get("startedOn"))), endedOn: date("endedOn"), hours: num("hours"),
      result: (TRAINING_RESULTS as readonly string[]).includes(String(f.get("result"))) ? (String(f.get("result")) as "ATTENDED") : "ATTENDED",
      level: (LEVELS as readonly string[]).includes(String(f.get("level"))) ? (String(f.get("level")) as "L1") : undefined,
      score: num("score"), certificateNo: str(f, "certificateNo"), expiresAt: date("expiresAt"), note: str(f, "note"), attachments: atts.map(({ name, url }) => ({ name, url })),
    });
    return { ok: `${String(f.get("title"))} × ${n}`, to: BACK };
  }, `${BACK}/new`);
}
export async function removeAction(id: string) {
  await guarded(async () => { const me = await currentEmployee(); await removeTraining({ id, actorCode: me.code }); }, BACK);
}
