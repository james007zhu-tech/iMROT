/**
 * Metric catalog: every number a dashboard can show. Dashboards (hand-made or AI-built) reference metrics by id,
 * so the AI never writes queries. Each metric returns labelled series; charts are chosen per widget.
 * Datasets are aggregated in JS from Prisma reads so the same code runs on PostgreSQL and on the in-memory stand-in.
 */
import type { prisma as PrismaLike } from "@/lib/db";

type Db = typeof PrismaLike;
export type ChartKind = "kpi" | "bar" | "line" | "donut" | "table";
export interface Series { labels: string[]; values: number[]; unit?: string; secondary?: number[] }
export interface MetricDef { id: string; title: { th: string; zh: string; en: string }; charts: ChartKind[]; params?: { months?: number; top?: number }; run: (db: Db, params: Record<string, number>) => Promise<Series> }

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
function lastMonths(n: number): string[] {
  const out: string[] = []; const now = new Date();
  for (let i = n - 1; i >= 0; i--) out.push(monthKey(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}
function tally<T>(rows: T[], key: (r: T) => string | null | undefined, val: (r: T) => number = () => 1): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r); if (!k) continue; m.set(k, (m.get(k) ?? 0) + val(r)); }
  return m;
}
const top = (m: Map<string, number>, n: number): Series => { const e = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n); return { labels: e.map((x) => x[0]), values: e.map((x) => x[1]) }; };

export const METRICS: MetricDef[] = [
  { id: "open_orders", title: { th: "งานบริการที่เปิดอยู่", zh: "进行中的服务单", en: "Open service orders" }, charts: ["kpi"],
    run: async (db) => ({ labels: ["open"], values: [await db.serviceOrder.count({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } } })] }) },
  { id: "assets_in_service", title: { th: "อุปกรณ์ที่ใช้งาน", zh: "在役设备", en: "Assets in service" }, charts: ["kpi"],
    run: async (db) => ({ labels: ["in service"], values: [await db.asset.count({ where: { status: "IN_SERVICE" } })] }) },
  { id: "assets_total", title: { th: "อุปกรณ์ทั้งหมด", zh: "设备总数", en: "Total assets" }, charts: ["kpi"],
    run: async (db) => ({ labels: ["assets"], values: [await db.asset.count({ where: { status: { not: "RETIRED" } } })] }) },
  { id: "receivables_outstanding", title: { th: "ลูกหนี้คงค้าง", zh: "应收未收", en: "Receivables outstanding" }, charts: ["kpi"],
    run: async (db) => { const inv = await db.invoice.findMany({ where: { paidAt: null } }); return { labels: ["outstanding"], values: [inv.reduce((s, i) => s + Number(i.amountDue) - Number(i.paidAmount ?? 0) - Number(i.whtAmount ?? 0), 0)], unit: inv[0]?.currency ?? "THB" }; } },
  { id: "orders_by_status", title: { th: "งานบริการตามสถานะ", zh: "服务单按状态", en: "Orders by status" }, charts: ["donut", "bar", "table"],
    run: async (db) => { const o = await db.serviceOrder.findMany({ select: { status: true } }); const m = tally(o, (r) => r.status); return { labels: [...m.keys()], values: [...m.values()] }; } },
  { id: "orders_per_month", title: { th: "งานบริการต่อเดือน", zh: "每月服务单", en: "Orders per month" }, charts: ["bar", "line"], params: { months: 12 },
    run: async (db, p) => { const months = lastMonths(p.months ?? 12); const o = await db.serviceOrder.findMany({ select: { reportedAt: true } }); const m = tally(o, (r) => monthKey(r.reportedAt)); return { labels: months, values: months.map((k) => m.get(k) ?? 0) }; } },
  { id: "revenue_cny_per_month", title: { th: "รายได้ (CNY) ต่อเดือน", zh: "每月开票收入（CNY）", en: "Invoiced revenue per month (CNY)" }, charts: ["bar", "line"], params: { months: 12 },
    run: async (db, p) => { const months = lastMonths(p.months ?? 12); const t = await db.taxInvoice.findMany({ where: { voidedAt: null }, select: { issuedAt: true, totalCny: true } }); const m = tally(t, (r) => monthKey(r.issuedAt), (r) => Number(r.totalCny)); return { labels: months, values: months.map((k) => Math.round(m.get(k) ?? 0)), unit: "CNY" }; } },
  { id: "assets_by_status", title: { th: "อุปกรณ์ตามสถานะ", zh: "设备按状态", en: "Assets by status" }, charts: ["donut", "bar", "table"],
    run: async (db) => { const a = await db.asset.findMany({ select: { status: true } }); const m = tally(a, (r) => r.status); return { labels: [...m.keys()], values: [...m.values()] }; } },
  { id: "assets_by_customer", title: { th: "อุปกรณ์ตามลูกค้า", zh: "设备按客户", en: "Assets by customer" }, charts: ["bar", "table"], params: { top: 10 },
    run: async (db, p) => { const a = await db.asset.findMany({ where: { status: { not: "RETIRED" } }, select: { customer: { select: { name: true } } } }); return top(tally(a, (r) => r.customer?.name ?? "—"), p.top ?? 10); } },
  { id: "assets_by_brand", title: { th: "อุปกรณ์ตามยี่ห้อ", zh: "设备按品牌", en: "Assets by brand" }, charts: ["donut", "bar", "table"], params: { top: 8 },
    run: async (db, p) => { const a = await db.asset.findMany({ select: { model: { select: { series: { select: { brand: { select: { name: true } } } } } } } }); return top(tally(a, (r) => r.model?.series.brand.name ?? "—"), p.top ?? 8); } },
  { id: "orders_by_kind", title: { th: "งานตามประเภท", zh: "服务单按类型", en: "Orders by kind" }, charts: ["donut", "bar"],
    run: async (db) => { const o = await db.serviceOrder.findMany({ select: { kind: true } }); const m = tally(o, (r) => r.kind); return { labels: [...m.keys()], values: [...m.values()] }; } },
  { id: "parts_replaced_top", title: { th: "อะไหล่ที่เปลี่ยนบ่อย", zh: "更换最多的部件", en: "Most replaced parts" }, charts: ["bar", "table"], params: { top: 10 },
    run: async (db, p) => { const e = await db.assetEvent.findMany({ where: { type: "PART_REPLACED" }, select: { payload: true } }); return top(tally(e, (r) => (r.payload as { partSku?: string } | null)?.partSku, (r) => Number((r.payload as { qty?: number } | null)?.qty ?? 1)), p.top ?? 10); } },
  { id: "repairs_per_customer", title: { th: "งานซ่อมต่อลูกค้า", zh: "各客户维修次数", en: "Repairs per customer" }, charts: ["bar", "table"], params: { top: 10 },
    run: async (db, p) => { const o = await db.serviceOrder.findMany({ where: { kind: "REPAIR" }, select: { customer: { select: { name: true } } } }); return top(tally(o, (r) => r.customer.name), p.top ?? 10); } },
  { id: "avg_days_report_to_accept", title: { th: "วันเฉลี่ยแจ้งซ่อมถึงตรวจรับ", zh: "报修到验收平均天数", en: "Avg days report → acceptance" }, charts: ["kpi"],
    run: async (db) => { const a = await db.acceptance.findMany({ where: { status: "ACCEPTED" }, select: { acceptedAt: true, serviceOrder: { select: { reportedAt: true } } } }); const d = a.filter((x) => x.acceptedAt).map((x) => (x.acceptedAt!.getTime() - x.serviceOrder.reportedAt.getTime()) / 86400000); return { labels: ["days"], values: [d.length ? Math.round((d.reduce((s, v) => s + v, 0) / d.length) * 10) / 10 : 0], unit: "days" }; } },
  { id: "orders_by_engineer", title: { th: "งานต่อวิศวกร", zh: "各工程师在办服务单", en: "Open orders per engineer" }, charts: ["bar", "table"],
    run: async (db) => { const o = await db.serviceOrder.findMany({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } }, select: { assignee: { select: { name: true } } } }); return top(tally(o, (r) => r.assignee?.name ?? "unassigned"), 20); } },
];

export const metricById = (id: string) => METRICS.find((m) => m.id === id);

export interface Widget { metric: string; chart: ChartKind; w?: 1 | 2; params?: Record<string, number> }
export interface DashboardSpec { widgets: Widget[] }

/** Validate an AI- or user-supplied spec against the catalog; drops unknown metrics and illegal charts. */
export function sanitizeSpec(input: unknown): DashboardSpec {
  const widgets = ((input as DashboardSpec)?.widgets ?? []).flatMap((w) => {
    const m = metricById(w?.metric);
    if (!m) return [];
    const chart = m.charts.includes(w.chart) ? w.chart : m.charts[0];
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(w.params ?? {})) if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
    return [{ metric: m.id, chart, w: w.w === 2 ? 2 : 1, params }];
  });
  return { widgets: widgets.slice(0, 12) };
}

export async function runSpec(db: Db, spec: DashboardSpec) {
  return Promise.all(spec.widgets.map(async (w) => ({ ...w, def: metricById(w.metric)!, data: await metricById(w.metric)!.run(db, w.params ?? {}) })));
}
