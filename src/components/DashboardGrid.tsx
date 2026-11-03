import { ChartFor } from "@/components/charts";
import type { renderDashboard } from "@/server/dashboards";

export function DashboardGrid({ widgets, locale }: { widgets: Awaited<ReturnType<typeof renderDashboard>>["widgets"]; locale: "th" | "zh" | "en" }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {widgets.map((w, i) => (
        <section key={i} className={`rounded-xl border bg-white p-4 ${w.w === 2 ? "col-span-2" : "col-span-1"} ${w.chart === "kpi" ? "min-h-24" : ""}`}>
          {w.chart !== "kpi" && <h2 className="mb-2 text-sm font-semibold text-navy">{w.def.title[locale]}</h2>}
          <ChartFor chart={w.chart} data={w.data} title={w.def.title[locale]} />
        </section>
      ))}
    </div>
  );
}
