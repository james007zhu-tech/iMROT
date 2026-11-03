import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { signInEmployee } from "@/server/auth";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  const t = await getTranslations("common");
  async function login(form: FormData) {
    "use server";
    const ok = await signInEmployee(String(form.get("email")), String(form.get("password")));
    redirect(ok ? "/assets" : "/login?e=1");
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-navy p-4">
      <form action={login} className="w-full max-w-sm space-y-3 rounded-lg bg-white p-6">
        <div className="flex items-center justify-between"><h1 className="text-xl font-bold text-navy">{t("appName")}</h1><div className="rounded bg-navy px-1"><LanguageSwitcher /></div></div>
        <p className="text-xs text-slate-500">DUCHENG INDUSTRIAL (THAILAND) CO., LTD.</p>
        <input name="email" type="email" placeholder="email" className="w-full rounded border px-3 py-2" required />
        <input name="password" type="password" placeholder="password" className="w-full rounded border px-3 py-2" required />
        {e && <p className="text-sm text-rose-600">Invalid email or password</p>}
        <button type="submit" className="w-full rounded bg-blue py-2 text-white">OK</button>
      </form>
    </div>
  );
}
