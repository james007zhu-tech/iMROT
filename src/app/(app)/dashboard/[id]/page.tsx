import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { renderDashboard } from "@/server/dashboards";
import { DashboardGrid as Grid } from "@/components/DashboardGrid";
import { DashboardBuilder } from "@/components/DashboardBuilder";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await prisma.dashboard.findUnique({ where: { id } }))) notFound();
  const locale = (await getLocale()) as "th" | "zh" | "en";
  const t = await getTranslations("common");
  const { name, widgets } = await renderDashboard(id);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2"><Link href="/dashboard" className="text-sm text-blue">← {t("dashboard")}</Link><h1 className="text-xl font-bold">{name}</h1><div className="ml-auto w-full md:w-auto"><DashboardBuilder dashboardId={id} /></div></div>
      <Grid widgets={widgets} locale={locale} />
    </div>
  );
}
