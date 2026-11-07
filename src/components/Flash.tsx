import { getTranslations } from "next-intl/server";

/** Result banner after a server action. Stable error codes ("SERIAL_EXISTS:…", "INVALID_INPUT:…") are shown in the viewer's language. */
export async function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  if (!error) return <div className="rounded-lg border border-blue bg-blue/8 px-4 py-2 text-sm text-navy">✓ {ok}</div>;
  const u = await getTranslations("ui");
  const [code, ...rest] = error.split(":");
  // Field names from validation errors are shown with their form labels where we have one.
  const detail = code === "INVALID_INPUT" || code === "DUPLICATE" ? rest.join(":").split(", ").map((f) => (u.has(`fld_${f.split(".")[0]}`) ? u(`fld_${f.split(".")[0]}`) : f)).join("、") : rest.join(":");
  const text = /^[A-Z_]+$/.test(code) && u.has(`err_${code}`) ? u(`err_${code}`, { detail }) : error;
  return <div className="rounded-lg border border-alert bg-alert/10 px-4 py-2 text-sm text-alert-ink">⚠ {text}</div>;
}
