"use server";
/** Supplier page actions — bound to the supplier code only. */
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { savePartnerProfile } from "@/server/srm";

export async function savePartnerAction(code: string, f: FormData) {
  await guarded(async () => {
    const me = await currentEmployee();
    const extra = String(f.get("extraCapabilities") ?? "").split(/[,，;\s]+/).filter(Boolean);
    const days = String(f.get("paymentDays") ?? "").trim();
    await savePartnerProfile({ code, actorCode: me.code, isPartner: f.get("isPartner") === "on", capabilities: [...f.getAll("cap").map(String), ...extra], countryCode: String(f.get("countryCode") || "TH"), paymentMode: (String(f.get("paymentMode") || "") || undefined) as "MONTHLY" | undefined, paymentDays: days ? Number(days) : undefined });
  }, `/suppliers/${code}`);
}
