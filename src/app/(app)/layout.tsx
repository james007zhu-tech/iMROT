import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AiAssistant } from "@/components/AiAssistant";

const NAV: { key: "dash" | "alm" | "crm" | "slm" | "scm" | "fin" | "to" | "opd" | "admin"; href: string }[] = [
  { key: "dash", href: "/dashboard" }, { key: "alm", href: "/assets" }, { key: "crm", href: "/customers" }, { key: "slm", href: "/service-orders" }, { key: "scm", href: "/parts" },
  { key: "fin", href: "/finance" }, { key: "to", href: "/tax" }, { key: "opd", href: "/people" }, { key: "admin", href: "/admin" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("nav");
  const c = await getTranslations("common");
  return (
    <div className="min-h-screen md:flex">
      <aside className="bg-navy text-white md:w-56 md:shrink-0">
        <div className="flex items-center justify-between px-4 py-3 md:block">
          <Link href="/assets" className="text-lg font-bold tracking-wide">{c("appName")}</Link>
          <div className="md:mt-2"><LanguageSwitcher /></div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:px-2">
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} className="whitespace-nowrap rounded px-3 py-2 text-sm hover:bg-white/10">{t(n.key)}</Link>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center gap-3 border-b bg-white px-4 py-2">
          <form action="/search" className="flex w-full max-w-md gap-1"><input name="q" placeholder={c("search")} className="w-full rounded border px-3 py-1.5 text-sm" /><button className="rounded bg-slate-100 px-3 text-sm">⌕</button></form>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
      <AiAssistant scope="staff" />
    </div>
  );
}
