import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { AiAssistant } from "@/components/AiAssistant";

/** Customer portal: phone-first, one column, big tap targets. Same data, restricted to the contact's customer. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("common");
  return (
    <div className="mx-auto min-h-screen max-w-xl">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-navy px-4 py-3 text-white">
        <Link href="/portal" className="font-bold">{t("appName")}</Link>
        <LanguageSwitcher />
      </header>
      <main className="p-4">{children}</main>
      <AiAssistant scope="portal" />
    </div>
  );
}
