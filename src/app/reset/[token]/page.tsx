import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { completeReset, MIN_PASSWORD, resetTarget } from "@/server/password-reset";
import { noteSuccess } from "@/server/login-guard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/** 忘记密码, step 3: the link's owner types a new password. The link works once, for 30 minutes. */
export default async function Reset({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ e?: string }> }) {
  const { token } = await params;
  const { e } = await searchParams;
  const t = await getTranslations("common");
  const target = await resetTarget(token);
  async function set(form: FormData) {
    "use server";
    let done: { email: string | null } | null = null, code = "";
    try { done = await completeReset(token, String(form.get("password") ?? ""), String(form.get("again") ?? "")); }
    catch (x) { code = (x as Error).message.split(":")[0]; }
    if (!done) redirect(`/reset/${token}?e=${["PASSWORD_SHORT", "PASSWORD_MISMATCH"].includes(code) ? code : "RESET_LINK_DEAD"}`);
    if (done.email) noteSuccess(done.email); // wrong tries before the reset no longer lock the account
    redirect("/login?e=reset");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form action={set} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <div className="flex items-center justify-between">{/* eslint-disable-next-line @next/next/no-img-element */}
          <h1><img src="/brand/dcit-logo.png" alt={t("appName")} className="h-12 w-auto" /></h1><LanguageSwitcher tone="light" /></div>
        <h2 className="text-base font-semibold text-navy">{t("resetTitle")}</h2>
        {!target ? <p className="rounded bg-tint p-3 text-sm text-navy">{t("resetDead")}</p> : (<>
          <p className="text-sm text-navy/70">{target.employee.name} · <span className="font-mono">{target.employee.code}</span></p>
          <input name="password" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} placeholder={t("resetNew", { n: MIN_PASSWORD })} className="w-full rounded border px-3 py-2" required />
          <input name="again" type="password" autoComplete="new-password" minLength={MIN_PASSWORD} placeholder={t("resetAgain")} className="w-full rounded border px-3 py-2" required />
          {e && <p className="text-sm text-alert-ink">{t(e === "PASSWORD_SHORT" ? "resetShort" : e === "PASSWORD_MISMATCH" ? "resetMismatch" : "resetDead", { n: MIN_PASSWORD })}</p>}
          <button type="submit" className="w-full rounded bg-blue py-2 text-white">{t("resetSave")}</button>
        </>)}
        <Link href={target ? "/login" : "/forgot"} className="block text-center text-sm text-blue">{t(target ? "backToLogin" : "forgotTitle")}</Link>
      </form>
    </div>
  );
}
