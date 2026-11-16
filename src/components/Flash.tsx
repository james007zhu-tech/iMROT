import { getTranslations } from "next-intl/server";

/** Result banner after a server action. Stable error codes ("SERIAL_EXISTS:…", "INVALID_INPUT:…") are shown in the viewer's language. */
export async function Flash({ ok, error }: { ok?: string; error?: string }) {
  if (!ok && !error) return null;
  const u = await getTranslations("ui");
  // a plain word from an action ("saved", "withdrawn") is said in the viewer's language; a number or a sentence passes as it is
  if (!error) return <div className="rounded-lg border border-blue bg-blue/8 px-4 py-2 text-sm text-navy">✓ {ok && /^[A-Za-z_]+$/.test(ok) && u.has(`ok_${ok}`) ? u(`ok_${ok}`) : ok}</div>;
  const [code, ...rest] = error.split(":");
  // Field names from validation errors are shown with their form labels where we have one.
  const detail = code === "INVALID_INPUT" || code === "DUPLICATE" ? rest.join(":").split(", ").map((f) => (u.has(`fld_${f.split(".")[0]}`) ? u(`fld_${f.split(".")[0]}`) : f)).join("、") : rest.join(":");
  const text = /^[A-Z_]+$/.test(code) && u.has(`err_${code}`) ? u(`err_${code}`, { detail }) : error;
  return <div className="rounded-lg border border-alert bg-alert/10 px-4 py-2 text-sm text-alert-ink">⚠ {text}</div>;
}
