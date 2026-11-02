/**
 * Server actions never throw at the user: they redirect back with ?ok= or ?error= and the page shows a banner.
 */
import { redirect } from "next/navigation";

export async function guarded(run: () => Promise<string | void>, backTo: string): Promise<never> {
  let target = backTo;
  try {
    const ok = await run();
    target = `${backTo}${backTo.includes("?") ? "&" : "?"}ok=${encodeURIComponent(ok ?? "saved")}`;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND"))) throw e; // let Next handle its own control-flow errors
    const msg = (e as Error).message ?? "error";
    target = `${backTo}${backTo.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg.slice(0, 300))}`;
  }
  redirect(target);
}
