/**
 * Server actions never throw at the user: they redirect back with ?ok= or ?error= and the page shows a banner.
 */
import { redirect } from "next/navigation";
import { errorCode } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { sessionEmployeeCode } from "@/server/auth";
import { gateFor } from "@/server/gate";
import { forgetNotices } from "@/server/notify";

/** `run` may return a message, or `{ ok, to }` to land somewhere else on success (a step form returns to its order). */
export async function guarded(run: () => Promise<string | void | { ok?: string; to: string }>, backTo: string): Promise<void> {
  // N-37 (2026-11-18): a server action can be posted to any address, so the page being refused does not stop it. Before
  // anything runs, the person is put through the same gate as the page this action belongs to; refused there, refused here.
  const code = await sessionEmployeeCode().catch(() => null);
  if (code) {
    const me = await prisma.employee.findUnique({ where: { code }, select: { id: true, code: true, role: true, extraRoles: true, approver: true, active: true } });
    if (me?.active) { const g = await gateFor(me, backTo.split("#")[0]); if (!g.ok) redirect(g.scope ? "/no-access?scope=1" : `/no-access?roles=${encodeURIComponent(g.roles ?? "MD")}`); }
  }
  let target = backTo;
  const began = Date.now();
  try {
    const r = await run();
    forgetNotices(); // the bell counts what is still open — after an approval, not 20 seconds later (2026-11-19)
    if (Date.now() - began > 3000) console.warn(`[slow-action] ${backTo} took ${Date.now() - began} ms`); // so a slow save can be told from a slow network
    const ok = typeof r === "object" && r ? r.ok : r;
    const dest = typeof r === "object" && r ? r.to : backTo;
    target = `${dest}${dest.includes("?") ? "&" : "?"}ok=${encodeURIComponent(ok ?? "saved")}`;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))) throw e; // let Next handle its own control-flow errors
    const msg = errorCode(e);
    target = `${backTo}${backTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg.slice(0, 300))}`;
  }
  redirect(target);
}

