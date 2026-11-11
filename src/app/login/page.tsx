import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signInEmployee } from "@/server/auth";
import { blocked, clientAddress, noteFailure, noteSuccess } from "@/server/login-guard";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const t = await getTranslations("common");
  async function login(form: FormData) {
    "use server";
    const email = String(form.get("email")).trim(), from = await clientAddress();
    if (blocked(email, from)) redirect("/login?e=wait");
    const ok = await signInEmployee(email, String(form.get("password")));
    if (ok) noteSuccess(email); else noteFailure(email, from);
    redirect(ok ? "/home" : "/login?e=1");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form action={login} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <div className="flex items-center justify-between">{/* eslint-disable-next-line @next/next/no-img-element */}
          <h1><img src="/brand/dcit-logo.png" alt={t("appName")} className="h-12 w-auto" /></h1><LanguageSwitcher tone="light" /></div>
        <p className="text-xs text-navy/70">DUCHENG INDUSTRIAL (THAILAND) CO., LTD.</p>
        <input name="email" type="email" placeholder={t("email")} className="w-full rounded border px-3 py-2" required />
        <input name="password" type="password" placeholder={t("password")} className="w-full rounded border px-3 py-2" required />
        {e && <p className="text-sm text-alert-ink">{t(e === "wait" ? "loginWait" : "invalidLogin")}</p>}
        <button type="submit" className="w-full rounded bg-blue py-2 text-white">{t("ok")}</button>
      </form>
    </div>
  );
}
