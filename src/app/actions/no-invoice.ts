"use server";
/** 不开票 / 撤销 on the invoice candidates (server/to.ts markNoInvoice). */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { markNoInvoice } from "@/server/to";

export async function noInvoiceAction(back: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const why = String(f.get("why") ?? ""), more = String(f.get("more") ?? "").trim();
    await markNoInvoice({ no: String(f.get("no")), actorCode: me.code, undo: f.get("undo") === "1", reason: [why, more].filter(Boolean).join("：") });
    return f.get("undo") === "1" ? "noInvoiceUndone" : "noInvoiceMarked";
  }, back);
}
