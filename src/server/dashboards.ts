/** Dashboards: list / create / render specs over the metric catalog. The AI builder lives in ai.ts and calls createDashboard. */
import { prisma } from "@/lib/db";
import { runSpec, sanitizeSpec, type DashboardSpec } from "@/lib/metrics";
import type { Prisma } from "@prisma/client";

export const DEFAULT_SPEC: DashboardSpec = {
  widgets: [
    { metric: "open_orders", chart: "kpi", w: 1 }, { metric: "assets_in_service", chart: "kpi", w: 1 }, { metric: "receivables_outstanding", chart: "kpi", w: 1 }, { metric: "avg_days_report_to_accept", chart: "kpi", w: 1 },
    { metric: "orders_per_month", chart: "bar", w: 2 }, { metric: "orders_by_status", chart: "donut", w: 2 },
    { metric: "revenue_cny_per_month", chart: "line", w: 2 }, { metric: "assets_by_customer", chart: "bar", w: 2 },
  ],
};

export async function listDashboards() {
  return prisma.dashboard.findMany({ orderBy: { createdAt: "asc" }, include: { owner: { select: { name: true } } } });
}

export async function createDashboard(name: string, spec: unknown, ownerEmployeeCode?: string) {
  const owner = ownerEmployeeCode ? await prisma.employee.findUnique({ where: { code: ownerEmployeeCode } }) : null;
  const clean = sanitizeSpec(spec);
  if (clean.widgets.length === 0) throw new Error("dashboard has no valid widgets");
  return prisma.dashboard.create({ data: { name, ownerId: owner?.id, spec: clean as unknown as Prisma.InputJsonValue } });
}

export async function updateDashboard(id: string, patch: { name?: string; spec?: unknown }) {
  return prisma.dashboard.update({ where: { id }, data: { name: patch.name, spec: patch.spec ? (sanitizeSpec(patch.spec) as unknown as Prisma.InputJsonValue) : undefined } });
}

export async function renderDashboard(id: string | "default") {
  const d = id === "default" ? null : await prisma.dashboard.findUnique({ where: { id } });
  const spec = d ? sanitizeSpec(d.spec) : DEFAULT_SPEC;
  return { name: d?.name ?? "DCiT", spec, widgets: await runSpec(prisma, spec) };
}
