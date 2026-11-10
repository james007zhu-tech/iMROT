import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AiAssistant } from "@/components/AiAssistant";
import { NavLinks } from "@/components/NavLinks";
import { currentEmployee, signOut } from "@/server/auth";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NAV } from "@/lib/nav";
import { noticesFor } from "@/server/notify";
import { MessageCenter } from "@/components/MessageCenter";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentEmployee(); // redirects to /login when not signed in
  const t = await getTranslations("nav");
  const c = await getTranslations("common");
  const notices = await noticesFor(me).catch(() => []); // a reminder query must never take the page down
  async function out() { "use server"; await signOut(); redirect("/login"); }
  return (
    <div className="min-h-screen md:flex">
      {/* phone: the menu is a drawer behind ☰ (checkbox, no script); desktop: the side column */}
      <input id="navtoggle" type="checkbox" className="peer hidden" aria-hidden />
      <label htmlFor="navtoggle" className="fixed inset-0 z-40 hidden bg-navy/40 peer-checked:block md:!hidden" aria-hidden />
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-[82vw] max-w-xs flex-col overflow-y-auto border-r border-hair bg-white text-navy shadow-2xl peer-checked:flex md:sticky md:top-0 md:z-auto md:flex md:h-screen md:w-56 md:max-w-none md:shrink-0 md:shadow-none">
        <div className="flex items-center justify-between px-4 py-3 md:block md:px-5 md:pt-5">
          <Link href="/home" aria-label={c("appName")}><img src="/brand/dcit-logo.png" alt="DCiT" className="h-9 w-auto md:h-11" /></Link>
          <div className="md:mt-2 md:-ml-2"><LanguageSwitcher tone="light" /></div>
        </div>
        <form action="/search" className="mx-3 mb-2 flex gap-1 md:hidden"><input name="q" placeholder={c("search")} className="w-full rounded-md border px-3 py-2 text-sm" /><button className="rounded-md border border-navy/45 px-3 text-sm">⌕</button></form>
        {/* OPD: the MD sees the employee list; everyone else sees only their own file (decision 2026-11-08). */}
        <Suspense><NavLinks groups={NAV.map((g) => ({ key: g.key, label: t(g.key), href: g.href, items: g.items.filter((i) => !i.mdOnly || me.role === "MD").map((i) => i.key === "talent" && me.role !== "MD" ? { key: i.key, href: `/people/${me.code}`, label: t("opdSelf") } : { key: i.key, href: i.href, label: t(i.key), soon: i.soon }) }))} /></Suspense>
        <div className="mt-auto flex items-center justify-between border-t border-hair px-4 py-3 text-sm text-navy/70 md:hidden"><span>{me.name} · <span className="font-mono">{me.code}</span></span><form action={out}><button className="text-blue">{c("signOut")}</button></form></div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-white px-3 py-2 md:static md:px-4">
          <label htmlFor="navtoggle" className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full text-navy hover:bg-tint md:hidden" aria-label="menu"><svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current" strokeWidth={2} strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h10" /></svg></label>
          <Link href="/home" aria-label={c("appName")} className="flex flex-1 justify-center md:hidden"><img src="/brand/dcit-logo.png" alt="DCiT" className="h-8 w-auto" /></Link>
          <form action="/search" className="hidden w-full max-w-md gap-1 md:flex"><input name="q" placeholder={c("search")} className="w-full rounded-md border px-3 py-1.5 text-sm" /><button className="rounded-md border border-navy/45 px-3 text-sm">⌕</button></form>
          <div className="flex items-center gap-3 text-sm text-navy/70 md:ml-auto"><MessageCenter notices={notices} /><span className="hidden md:inline">{me.name} · <span className="font-mono">{me.code}</span></span><form action={out} className="hidden md:block"><button className="text-blue">{c("signOut")}</button></form></div>
        </header>
        <main className="p-4 md:p-6">{children}</main>
      </div>
      <AiAssistant scope="staff" />
    </div>
  );
}
