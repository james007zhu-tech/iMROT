"use server";
/** 单据上改汇率 (server/fx.ts overrideDocRate). */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { overrideDocRate } from "@/server/fx";

export async function docRateAction(kind: "order" | "po", no: string, back: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const why = String(f.get("why") ?? ""), more = String(f.get("more") ?? "").trim();
    if (why === "other" && !more) throw new Error("REASON_REQUIRED");
    await overrideDocRate({ kind, no, actorCode: me.code, rateToCny: Number(f.get("rate")), reason: [String(f.get("whyLabel_" + why) ?? why), more].filter(Boolean).join("：") });
    return "fxDocSaved";
  }, back);
}
