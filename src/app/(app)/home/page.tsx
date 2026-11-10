import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AiAssistant } from "@/components/AiAssistant";
import { currentEmployee } from "@/server/auth";
import { shortcutsOf } from "@/lib/nav";

export const dynamic = "force-dynamic";

/**
 * 首页 = the conversation (朱总 2026-11-10: "一个对话框，大家日常 90% 的工作都在这个对话框里完成").
 * The same assistant as the floating button, as the page itself; below it the person's pinned entries.
 * `?ask=` carries a question from the message centre and is sent on arrival.
 */
export default async function Home({ searchParams }: { searchParams: Promise<{ ask?: string }> }) {
  const { ask } = await searchParams;
  const me = await currentEmployee();
  const t = await getTranslations("home");
  const s = await getTranslations("shortcut");
  const pins = shortcutsOf(me.shortcuts, me.role);
  const hour = (new Date().getUTCHours() + 7) % 24; // DCiT works on Thailand time
  const hello = t(hour < 11 ? "morning" : hour < 17 ? "afternoon" : "evening", { name: (me.nameLocal || me.name).split(/\s+/)[0] });
  const suggestions = ["s1", "s2", "s3", "s4", "s5", "s6"].map((k) => t(k));
  return (
    <div>
      <AiAssistant key={ask ?? ""} scope="staff" variant="page" greeting={hello} suggestions={suggestions} seed={ask} />
      {!ask && (
        <div className="mx-auto mt-10 max-w-3xl">
          <div className="mb-2 flex items-baseline justify-between"><b className="text-sm text-navy/70">{t("pinned")}</b><Link href="/shortcuts" className="text-xs text-blue hover:underline">{t("editPinned")}</Link></div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">{pins.map((p) => <Link key={p.key} href={p.href} className="rounded-xl border border-hair bg-white px-4 py-3 text-sm font-semibold text-navy hover:border-blue hover:text-blue">{s(p.key)}</Link>)}</div>
        </div>
      )}
    </div>
  );
}
