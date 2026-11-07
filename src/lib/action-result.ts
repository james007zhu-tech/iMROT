/**
 * Server actions never throw at the user: they redirect back with ?ok= or ?error= and the page shows a banner.
 */
import { redirect } from "next/navigation";
import { errorCode } from "@/lib/errors";

/** `run` may return a message, or `{ ok, to }` to land somewhere else on success (a step form returns to its order). */
export async function guarded(run: () => Promise<string | void | { ok?: string; to: string }>, backTo: string): Promise<void> {
  let target = backTo;
  try {
    const r = await run();
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

