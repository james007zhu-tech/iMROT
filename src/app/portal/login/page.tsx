import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { isStaffEmail, signInContact, signInEmployee } from "@/server/auth";
import { PasswordInput } from "@/components/PasswordInput";
import { blocked, clientAddress, noteFailure, noteSuccess, triesLeft } from "@/server/login-guard";

export default async function PortalLogin({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const { e, next } = await searchParams;
  const t = await getTranslations("common");
  async function login(form: FormData) {
    "use server";
    const login = String(form.get("login")).trim(), from = await clientAddress();
    // A colleague at the customers' door (an old home-screen icon opens here): a staff address signs in as staff.
    if (login.includes("@") && (await isStaffEmail(login))) {
      if (blocked(login, from)) redirect("/login?e=wait");
      const r = await signInEmployee(login, String(form.get("password")));
      if (r === "ok") { noteSuccess(login); redirect("/home"); }
      noteFailure(login, from);
      redirect(`/login?e=${r}&left=${triesLeft(login, from)}`);
    }
    if (blocked(`portal:${login}`, from)) redirect("/portal/login?e=wait");
    const ok = await signInContact(login, String(form.get("password")));
    if (ok) noteSuccess(`portal:${login}`); else noteFailure(`portal:${login}`, from);
    const next = String(form.get("next") || "");
    redirect(ok ? (/^\/portal(\/[\w\-./?=&%]*)?$/.test(next) ? next : "/portal") : "/portal/login?e=1"); // only back into the portal, never to another site
  }
  return (
    <form action={login} className="space-y-3 rounded-lg border bg-white p-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <h1 className="text-base font-semibold text-navy">{t("portalSignIn")}</h1>
      <input name="login" autoCapitalize="none" autoCorrect="off" autoComplete="username" placeholder={t("login")} className="w-full rounded border px-3 py-3 text-base" required />
      <PasswordInput name="password" autoComplete="current-password" placeholder={t("password")} className="w-full rounded border px-3 py-3 text-base" required label={{ show: t("pwShow"), hide: t("pwHide") }} />
      {e && <p className="text-sm text-alert-ink">{t(e === "wait" ? "loginWait" : "invalidPortalLogin")}</p>}
      <button className="w-full rounded bg-blue py-3 text-base text-white">{t("ok")}</button>
      <Link href="/login" className="block text-center text-sm text-blue">{t("staffSignInLink")}</Link>
    </form>
  );
}
