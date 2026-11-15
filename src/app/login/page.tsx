import { VersionTag } from "@/components/ReleaseBanner";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signInEmployee } from "@/server/auth";
import { blocked, clientAddress, noteFailure, noteSuccess, triesLeft } from "@/server/login-guard";
import { PasswordInput } from "@/components/PasswordInput";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string; left?: string }> }) {
  const { e, left } = await searchParams;
  const t = await getTranslations("common");
  async function login(form: FormData) {
    "use server";
    const email = String(form.get("email")).trim(), from = await clientAddress();
    if (blocked(email, from)) { console.warn(`[login-fail] ${new Date().toISOString()} why=locked email=${JSON.stringify(email)}`); redirect("/login?e=wait"); }
    const r = await signInEmployee(email, String(form.get("password")));
    if (r === "ok") { noteSuccess(email); redirect("/home"); }
    noteFailure(email, from);
    redirect(`/login?e=${r}&left=${triesLeft(email, from)}`);
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form action={login} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <div className="flex items-center justify-between">{/* eslint-disable-next-line @next/next/no-img-element */}
          <h1><img src="/brand/dcit-logo.png" alt={t("appName")} className="h-12 w-auto" /></h1><LanguageSwitcher tone="light" /></div>
        <h2 className="text-base font-semibold text-navy">{t("staffSignIn")}</h2>
        <p className="text-xs text-navy/70">DUCHENG INDUSTRIAL (THAILAND) CO., LTD.</p>
        <input name="email" type="email" autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder={t("email")} className="w-full rounded border px-3 py-2" required />
        <PasswordInput name="password" autoComplete="current-password" placeholder={t("password")} className="w-full rounded border px-3 py-2" required label={{ show: t("pwShow"), hide: t("pwHide") }} />
        {e === "reset" ? <p className="rounded bg-tint p-2 text-sm text-navy">{t("resetDone")}</p> : e && <p className="text-sm text-alert-ink">{t(e === "wait" ? "loginWait" : e === "no-account" ? "loginNoAccount" : e === "inactive" ? "loginInactive" : e === "wrong-password" ? "loginWrongPassword" : "invalidLogin", { left: left ?? "" })}</p>}
        <button type="submit" className="w-full rounded bg-blue py-2 text-white">{t("ok")}</button>
        <div className="flex items-center justify-between text-sm"><Link href="/forgot" className="text-blue">{t("forgotTitle")}</Link><Link href="/portal/login" className="text-navy/60">{t("portalSignInLink")}</Link></div>
      </form>
      <VersionTag className="mt-3 text-center" />
    </div>
  );
}
