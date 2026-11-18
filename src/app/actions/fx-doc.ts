"use server";
/** 单据上改汇率 (server/fx.ts overrideDocRate). */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { decideDocRate, overrideDocRate } from "@/server/fx";

export async function docRateAction(kind: "order" | "po", no: string, back: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const why = String(f.get("why") ?? ""), more = String(f.get("more") ?? "").trim();
    if (why === "other" && !more) throw new Error("REASON_REQUIRED");
    const r = await overrideDocRate({ kind, no, actorCode: me.code, rateToCny: Number(f.get("rate")), reason: [String(f.get("whyLabel_" + why) ?? why), more].filter(Boolean).join("：") });
    return r === "pending" ? "fxDocPending" : "fxDocSaved";
  }, back);
}

export async function docRateDecideAction(no: string, back: string, f: FormData) {
  await guarded(async () => { const me = await currentEmployee(); const yes = f.get("decision") === "yes"; await decideDocRate({ no, actorCode: me.code, approve: yes, note: String(f.get("note") ?? "").trim() || undefined }); return yes ? "fxDocApproved" : "fxDocRefused"; }, back);
}
