"use server";
/** 汇率 — 财务手工覆盖 (server/fx.ts): a rate set by hand for one day, with a reason; every change is in the audit log. */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { overrideRate, removeOverride } from "@/server/fx";

const BACK = "/finance/fx";
export async function overrideAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const day = String(f.get("rateDate") ?? "").trim();
    const r = await overrideRate({ actorCode: me.code, currency: String(f.get("currency") ?? ""), rateDate: day ? new Date(day) : new Date(), rateToCny: Number(f.get("rate")), note: String(f.get("note") ?? "") });
    return { ok: `${r.currency} ${Number(r.rateToCny)}`, to: BACK };
  }, BACK);
}
export async function removeAction(f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    await removeOverride({ actorCode: me.code, id: String(f.get("id")), note: String(f.get("note") ?? "") });
    return "fxRemoved";
  }, BACK);
}
