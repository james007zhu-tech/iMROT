"use server";
/** Server actions of the order page that are bound to the order number only (rule 19: no closures over translators). */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { reopenAsPartner } from "@/server/srm";
import { undoDecline } from "@/server/decline";
import { advanceServiceOrder } from "@/server/slm";

/** 转合作维修: close this REPAIR order and continue on a new 合作维修 order (decided 2026-11-09). */
export async function reopenAsPartnerAction(no: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const order = await reopenAsPartner({ no, actorCode: me.code, reason: String(f.get("reason") ?? "") });
    return { ok: order.no, to: `/service-orders/${order.no}/partner` };
  }, `/service-orders/${no}`);
}

/** 客户拒绝报价 undone: the customer changed their mind before a DNTH or TITH went out (2026-11-09). */
export async function undoDeclineAction(no: string) {
  await guarded(async () => {
    const me = await currentEmployee();
    await undoDecline({ no, actorCode: me.code });
    return { ok: no, to: `/service-orders/${no}` };
  }, `/service-orders/${no}`);
}

/** Close a declined order once the machine is back and the fee is invoiced or waived. */
export async function closeDeclinedAction(no: string) {
  await guarded(async () => {
    const me = await currentEmployee();
    await advanceServiceOrder(no, "CLOSED", me.code);
    return { ok: no, to: `/service-orders/${no}` };
  }, `/service-orders/${no}`);
}
