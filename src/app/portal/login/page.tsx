import { redirect } from "next/navigation";
import { signInContact } from "@/server/auth";

export default async function PortalLogin({ searchParams }: { searchParams: Promise<{ e?: string; next?: string }> }) {
  const { e, next } = await searchParams;
  async function login(form: FormData) {
    "use server";
    const ok = await signInContact(String(form.get("login")), String(form.get("password")));
    redirect(ok ? (String(form.get("next") || "") || "/portal") : "/portal/login?e=1");
  }
  return (
    <form action={login} className="space-y-3 rounded-lg border bg-white p-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <input name="login" placeholder="login" className="w-full rounded border px-3 py-3 text-base" required />
      <input name="password" type="password" placeholder="password" className="w-full rounded border px-3 py-3 text-base" required />
      {e && <p className="text-sm text-rose-600">Invalid login</p>}
      <button className="w-full rounded bg-blue py-3 text-base text-white">OK</button>
    </form>
  );
}
