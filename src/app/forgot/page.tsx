import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { blocked, clientAddress, noteFailure } from "@/server/login-guard";
import { requestReset } from "@/server/password-reset";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

/** 忘记密码, step 1: ask. The answer is the same whether or not the address is known. */
export default async function Forgot({ searchParams }: { searchParams: Promise<{ sent?: string; e?: string }> }) {
  const { sent, e } = await searchParams;
  const t = await getTranslations("common");
  async function ask(form: FormData) {
    "use server";
    const email = String(form.get("email") ?? "").trim(), from = await clientAddress();
    if (blocked(`forgot:${email}`, from)) redirect("/forgot?e=wait");
    noteFailure(`forgot:${email}`, from); // asking counts against the same throttle as guessing
    await requestReset(email);
    redirect("/forgot?sent=1");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form action={ask} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <div className="flex items-center justify-between">{/* eslint-disable-next-line @next/next/no-img-element */}
          <h1><img src="/brand/dcit-logo.png" alt={t("appName")} className="h-12 w-auto" /></h1><LanguageSwitcher tone="light" /></div>
        <h2 className="text-base font-semibold text-navy">{t("forgotTitle")}</h2>
        {sent ? <p className="rounded bg-tint p-3 text-sm text-navy">{t("forgotSent")}</p> : (<>
          <p className="text-sm text-navy/70">{t("forgotHelp")}</p>
          <input name="email" type="email" placeholder={t("email")} className="w-full rounded border px-3 py-2" required />
          {e && <p className="text-sm text-alert-ink">{t("loginWait")}</p>}
          <button type="submit" className="w-full rounded bg-blue py-2 text-white">{t("forgotAsk")}</button>
        </>)}
        <Link href="/login" className="block text-center text-sm text-blue">{t("backToLogin")}</Link>
      </form>
    </div>
  );
}
