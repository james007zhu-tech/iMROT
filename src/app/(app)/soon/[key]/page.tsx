import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NAV } from "@/lib/nav";
import { PageHeader, Card } from "@/components/ui";

/** A menu entry whose page is not built yet: says so, says what it will hold, and points at what exists today. */
const TODAY: Record<string, string[]> = { finReports: ["/finance", "/dashboard"], expenses: [], training: ["/fault-codes"], permissions: ["/people"], dictionary: ["/series", "/admin"] };

export default async function Soon({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!NAV.some((g) => g.items.some((i) => i.soon && i.key === key))) notFound();
  const n = await getTranslations("nav");
  const t = await getTranslations("soon");
  return (
    <div className="space-y-4">
      <PageHeader title={n(key)} badge={<span className="rounded-full bg-[#FFF4E5] px-2.5 py-0.5 text-xs font-semibold text-[#9A5B00]">{t("badge")}</span>} />
      <Card>
        <p className="text-sm leading-relaxed text-navy">{t(key)}</p>
        {TODAY[key]?.length ? <p className="mt-3 text-sm text-navy/70">{t("meanwhile")} {TODAY[key].map((h) => <Link key={h} href={h} className="mr-3 text-blue hover:underline">{h}</Link>)}</p> : null}
      </Card>
    </div>
  );
}
