import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AiAssistant } from "@/components/AiAssistant";
import { NavLinks } from "@/components/NavLinks";
import { currentEmployee, signOut } from "@/server/auth";
import { redirect } from "next/navigation";

const NAV: { key: "dash" | "alm" | "crm" | "slm" | "scm" | "fin" | "to" | "opd" | "admin"; href: string }[] = [
  { key: "dash", href: "/dashboard" }, { key: "alm", href: "/assets" }, { key: "crm", href: "/customers" }, { key: "slm", href: "/service-orders" }, { key: "scm", href: "/parts" },
  { key: "fin", href: "/finance" }, { key: "to", href: "/tax" }, { key: "opd", href: "/people" }, { key: "admin", href: "/admin" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentEmployee(); // redirects to /login when not signed in
  const t = await getTranslations("nav");
  const c = await getTranslations("common");
  async function out() { "use server"; await signOut(); redirect("/login"); }
  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-navy text-white md:w-56 md:shrink-0">
        <div className="flex items-center justify-between px-4 py-3 md:block">
          <Link href="/assets" className="text-lg font-bold tracking-wide">{c("appName")}</Link>
          <div className="md:mt-2"><LanguageSwitcher /></div>
        </div>
        {/* OPD (employees) is MD-only (decision 2026-11-03): others do not see the menu at all. */}
        <NavLinks items={NAV.filter((n) => n.key !== "opd" || me.role === "MD").map((n) => ({ href: n.href, label: t(n.key) }))} />
      </aside>
      <div className="flex-1">
        <header className="flex items-center gap-3 border-b border-line bg-white px-4 py-2">
          <form action="/search" className="flex w-full max-w-md gap-1"><input name="q" placeholder={c("search")} className="w-full rounded-md border px-3 py-1.5 text-sm" /><button className="rounded-md border border-navy/45 px-3 text-sm">⌕</button></form>
          <div className="ml-auto flex items-center gap-3 text-sm text-navy/70"><span className="hidden md:inline">{me.name} · <span className="font-mono">{me.code}</span></span><form action={out}><button className="text-blue">{c("signOut")}</button></form></div>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
      <AiAssistant scope="staff" />
    </div>
  );
}
