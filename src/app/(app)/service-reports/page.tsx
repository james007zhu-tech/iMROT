import { legacyTail } from "@/server/legacy";
import { currentEmployee } from "@/server/auth";
import { orderScope, teamIds } from "@/server/scope";
import { can } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { ReadyOrders } from "@/components/ReadyOrders";
import { PageHeader, Table, Pager, PAGE_SIZE } from "@/components/ui";
import { OldTag } from "@/components/OldTag";

export const dynamic = "force-dynamic";

const KINDS = ["inspection", "repair", "maintenance"] as const;
const DOC = { inspection: "IN", repair: "RP", maintenance: "PM" } as const;
const NAVKEY = { inspection: "inspectionReports", repair: "repairReports", maintenance: "maintenanceReports" } as const;
const day = (d?: Date | null) => (d ? localIso(d)!.slice(0, 10) : "");
const cut = (s?: string | null, n = 70) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

/** 精益服务: every inspection (INTH), repair (RPTH) and maintenance (PMTH) report in one list each, newest first. */
import { sortOf } from "@/lib/sort";
import type { Prisma } from "@prisma/client";
export default async function ServiceReports({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; page?: string; new?: string; sort?: string }> }) {
  const sp = await searchParams;
  const kind = (KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as (typeof KINDS)[number]) : "inspection";
  const q = sp.q?.trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const t = await getTranslations("common");
  const n = await getTranslations("nav");
  const r = await getTranslations("reports");
  const u = await getTranslations("ui");
  const d = await getTranslations("docs");
  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const me = await currentEmployee();
  const own = can.allOrders(me) ? {} : { OR: [{ serviceOrder: await orderScope(me) }, { engineerId: { in: await teamIds(me) } }] };
  const scope = { AND: [own, q ? { OR: [{ no: like(q) }, { asset: { code: like(q) } }, { asset: { serialNumber: like(q) } }, { serviceOrder: { no: like(q) } }, { serviceOrder: { customer: { name: like(q) } } }] } : {}] };
  const inc = { asset: { select: { code: true, serialNumber: true } }, engineer: { select: { name: true } }, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } };
  const paging = { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
  // 列表排序 (朱总 2026-11-28): the same five columns for the three kinds of report; "date" is each kind's own date
  const so = sortOf<"asc" | "desc">(sp.sort, { date: (x) => x, no: (x) => x, asset: (x) => x, customer: (x) => x, order: (x) => x, engineer: (x) => x }, "-date", { kind, q });
  const dir = so.desc ? "desc" as const : "asc" as const;
  const by = <D,>(date: D): object[] => (so.field === "no" ? [{ no: dir }] : so.field === "asset" ? [{ asset: { code: dir } }] : so.field === "customer" ? [{ serviceOrder: { customer: { name: dir } } }, { no: "desc" }] : so.field === "order" ? [{ serviceOrder: { no: dir } }, { no: "desc" }] : so.field === "engineer" ? [{ engineer: { name: dir } }, { no: "desc" }] : [date as object, { no: dir }]);
  let total = 0;
  let rows: { no: string; date: string; asset: { code: string; serialNumber: string }; customer: string; order: string; engineer: string; gist: string; href: string; draft?: boolean; old?: boolean }[] = [];
  if (kind === "inspection") {
    const [list, c] = await Promise.all([prisma.inspection.findMany({ where: scope, include: { ...inc, asset: { select: { code: true, serialNumber: true, customer: { select: { name: true } } } } }, orderBy: by({ inspectedAt: dir }) as Prisma.InspectionOrderByWithRelationInput[], ...paging }), prisma.inspection.count({ where: scope })]);
    total = c;
    rows = list.map((i) => ({ no: i.no, date: day(i.inspectedAt), asset: i.asset, customer: i.serviceOrder?.customer.name ?? i.asset.customer?.name ?? "—", order: i.serviceOrder?.no ?? "", engineer: i.engineer.name, gist: cut(i.conclusion || i.probableCause || i.findings), href: i.serviceOrder ? `/service-orders/${i.serviceOrder.no}` : i.draft ? `/inspections/new?asset=${i.asset.code}` : `/assets/${i.asset.code}`, draft: i.draft }));
  } else {
    const where = { ...scope, kind: kind === "maintenance" ? ("MAINTENANCE" as const) : { in: ["REPAIR" as const, "OVERHAUL" as const] } };
    const [list, c] = await Promise.all([prisma.repairJob.findMany({ where, include: inc, orderBy: by({ finishedAt: dir }) as Prisma.RepairJobOrderByWithRelationInput[], ...paging }), prisma.repairJob.count({ where })]);
    total = c;
    rows = list.map((j) => ({ no: j.no, date: day(j.finishedAt ?? j.startedAt), asset: j.asset, customer: j.serviceOrder.customer.name, order: j.serviceOrder.no, engineer: j.engineer.name, gist: cut(kind === "maintenance" ? j.hazards || j.handled || j.conclusion : j.rootCause || j.confirmedFault || j.conclusion), href: `/service-orders/${j.serviceOrder.no}` }));
  }
  // the old system's reports follow this system's own (朱总 2026-11-24: one list, old and new together)
  if (kind !== "maintenance") {
    const old = await legacyTail(me, [kind === "inspection" ? "INSPECTION" : "REPAIR"], { q, page, size: PAGE_SIZE, liveTotal: total });
    rows = [...rows, ...old.rows.map((x) => ({ no: x.no, date: x.date, asset: { code: x.assetCode, serialNumber: x.serial || x.field("序列号") }, customer: x.customer, order: "", engineer: x.by, gist: cut(x.field("主要故障点", "实际维修方案", "设备故障内容", "故障内容", "ผลการตรวจสอบ") || x.title), href: x.href, old: true }))];
    total += old.total;
  }
  const href = (p: number) => `/service-reports?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ""}${so.key ? `&sort=${so.key}` : ""}&page=${p}`;
  return (
    <div className="space-y-4">
      <PageHeader title={n(NAVKEY[kind])} badge={<span className="text-sm text-navy/60">{total}</span>} newHref={kind === "inspection" ? "/inspections/new" : `/service-reports?kind=${kind}&new=1`} newLabel={d("new", { name: n(NAVKEY[kind]) })} />
      {sp.new && <ReadyOrders type={DOC[kind]} title={n(NAVKEY[kind])} />}
      <form className="flex max-w-md gap-2"><input type="hidden" name="kind" value={kind} /><input name="q" defaultValue={q} placeholder={r("searchPh")} className="w-full rounded-lg border px-3 py-2 text-sm" /><button className="whitespace-nowrap rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold text-navy">{t("search")}</button></form>
      <Table head={[so.th("no", r("reportNo")), so.th("date", r("date")), so.th("asset", t("assetCode")), so.th("customer", t("customer")), so.th("order", r("order")), so.th("engineer", r("engineer")), r(kind === "inspection" ? "gistInspection" : kind === "repair" ? "gistRepair" : "gistMaintenance")]}>
        {rows.map((x) => (
          <tr key={x.href + x.no}>
            <td className="whitespace-nowrap font-mono"><Link href={x.href} className="text-blue hover:underline">{x.no}</Link>{x.draft ? <span className="ml-1 text-xs text-[#9A5B00]">{r("draft")}</span> : null}{x.old ? <OldTag /> : null}</td>
            <td className="whitespace-nowrap">{x.date}</td>
            <td>{x.asset.code ? <Link href={`/assets/${x.asset.code}`} className="font-mono hover:underline">{x.asset.code}</Link> : null}<span className="block text-xs text-navy/60">{x.asset.serialNumber}</span></td>
            <td>{x.customer}</td>
            <td className="font-mono"><Link href={x.href} className="hover:underline">{x.order}</Link></td>
            <td>{x.engineer}</td>
            <td className="max-w-md text-[13px]">{x.gist}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-navy/60">{r("none")}</td></tr>}
      </Table>
      <Pager page={page} total={total} href={href} prev={u("prevPage")} next={u("nextPage")} />
    </div>
  );
}
