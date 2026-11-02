import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { listDashboards, renderDashboard } from "@/server/dashboards";
import { ChartFor } from "@/components/charts";
import { DashboardBuilder } from "@/components/DashboardBuilder";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardHome({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  if (id) redirect(`/dashboard/${id}`);
  const locale = (await getLocale()) as "th" | "zh" | "en";
  const [list, { widgets }] = await Promise.all([listDashboards(), renderDashboard("default")]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold">Dashboard</h1>
        <nav className="ml-2 flex flex-wrap gap-1 text-sm">{list.map((d) => <Link key={d.id} href={`/dashboard/${d.id}`} className="rounded-full border px-3 py-1 hover:bg-white">{d.name}</Link>)}</nav>
        <div className="ml-auto w-full md:w-auto"><DashboardBuilder /></div>
      </div>
      <Grid widgets={widgets} locale={locale} />
    </div>
  );
}

export function Grid({ widgets, locale }: { widgets: Awaited<ReturnType<typeof renderDashboard>>["widgets"]; locale: "th" | "zh" | "en" }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {widgets.map((w, i) => (
        <section key={i} className={`rounded-lg border bg-white p-3 ${w.w === 2 ? "col-span-2" : "col-span-1"} ${w.chart === "kpi" ? "min-h-24" : ""}`}>
          {w.chart !== "kpi" && <h2 className="mb-2 text-sm font-semibold text-navy">{w.def.title[locale]}</h2>}
          <ChartFor chart={w.chart} data={w.data} title={w.def.title[locale]} />
        </section>
      ))}
    </div>
  );
}
