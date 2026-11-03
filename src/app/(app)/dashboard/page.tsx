import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { listDashboards, renderDashboard } from "@/server/dashboards";
import { DashboardBuilder } from "@/components/DashboardBuilder";
import Link from "next/link";
import { DashboardGrid as Grid } from "@/components/DashboardGrid";

export const dynamic = "force-dynamic";

export default async function DashboardHome({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (id) redirect(`/dashboard/${id}`);
  const locale = (await getLocale()) as "th" | "zh" | "en";
  const t = await getTranslations("common");
  const [list, { widgets }] = await Promise.all([listDashboards(), renderDashboard("default")]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">{t("dashboard")}</h1>
        <nav className="ml-2 flex flex-wrap gap-1 text-sm">{list.map((d) => <Link key={d.id} href={`/dashboard/${d.id}`} className="rounded-full border px-3 py-1 hover:bg-white">{d.name}</Link>)}</nav>
        <div className="ml-auto w-full md:w-auto"><DashboardBuilder /></div>
      </div>
      <Grid widgets={widgets} locale={locale} />
    </div>
  );
}
