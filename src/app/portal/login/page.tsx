import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signInContact } from "@/server/auth";
import { blocked, clientAddress, noteFailure, noteSuccess } from "@/server/login-guard";

export default async function PortalLogin({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const { e, next } = await searchParams;
  const t = await getTranslations("common");
  async function login(form: FormData) {
    "use server";
    const login = String(form.get("login")).trim(), from = await clientAddress();
    if (blocked(`portal:${login}`, from)) redirect("/portal/login?e=wait");
    const ok = await signInContact(login, String(form.get("password")));
    if (ok) noteSuccess(`portal:${login}`); else noteFailure(`portal:${login}`, from);
    const next = String(form.get("next") || "");
    redirect(ok ? (/^\/portal(\/[\w\-./?=&%]*)?$/.test(next) ? next : "/portal") : "/portal/login?e=1"); // only back into the portal, never to another site
  }
  return (
    <form action={login} className="space-y-3 rounded-lg border bg-white p-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <input name="login" placeholder={t("login")} className="w-full rounded border px-3 py-3 text-base" required />
      <input name="password" type="password" placeholder={t("password")} className="w-full rounded border px-3 py-3 text-base" required />
      {e && <p className="text-sm text-alert-ink">{t(e === "wait" ? "loginWait" : "invalidPortalLogin")}</p>}
      <button className="w-full rounded bg-blue py-3 text-base text-white">{t("ok")}</button>
    </form>
  );
}
