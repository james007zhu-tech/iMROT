import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { PageHeader, Table, Pager, PAGE_SIZE } from "@/components/ui";

export const dynamic = "force-dynamic";

const KINDS = ["inspection", "repair", "maintenance"] as const;
const NAVKEY = { inspection: "inspectionReports", repair: "repairReports", maintenance: "maintenanceReports" } as const;
const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");
const cut = (s?: string | null, n = 70) => (s && s.length > n ? `${s.slice(0, n)}…` : s ?? "");

/** 精益服务: every inspection (INTH), repair (RPTH) and maintenance (PMTH) report in one list each, newest first. */
export default async function ServiceReports({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const kind = (KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as (typeof KINDS)[number]) : "inspection";
  const q = sp.q?.trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const t = await getTranslations("common");
  const n = await getTranslations("nav");
  const r = await getTranslations("reports");
  const u = await getTranslations("ui");
  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const scope = q ? { OR: [{ no: like(q) }, { asset: { code: like(q) } }, { asset: { serialNumber: like(q) } }, { serviceOrder: { no: like(q) } }, { serviceOrder: { customer: { name: like(q) } } }] } : {};
  const inc = { asset: { select: { code: true, serialNumber: true } }, engineer: { select: { name: true } }, serviceOrder: { select: { no: true, customer: { select: { name: true } } } } };
  const paging = { skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE };
  let total = 0;
  let rows: { no: string; date: string; asset: { code: string; serialNumber: string }; customer: string; order: string; engineer: string; gist: string; href: string; draft?: boolean }[] = [];
  if (kind === "inspection") {
    const [list, c] = await Promise.all([prisma.inspection.findMany({ where: scope, include: inc, orderBy: { inspectedAt: "desc" }, ...paging }), prisma.inspection.count({ where: scope })]);
    total = c;
    rows = list.map((i) => ({ no: i.no, date: day(i.inspectedAt), asset: i.asset, customer: i.serviceOrder.customer.name, order: i.serviceOrder.no, engineer: i.engineer.name, gist: cut(i.conclusion || i.probableCause || i.findings), href: `/service-orders/${i.serviceOrder.no}`, draft: i.draft }));
  } else {
    const where = { ...scope, kind: kind === "maintenance" ? ("MAINTENANCE" as const) : { in: ["REPAIR" as const, "OVERHAUL" as const] } };
    const [list, c] = await Promise.all([prisma.repairJob.findMany({ where, include: inc, orderBy: [{ finishedAt: "desc" }, { no: "desc" }], ...paging }), prisma.repairJob.count({ where })]);
    total = c;
    rows = list.map((j) => ({ no: j.no, date: day(j.finishedAt ?? j.startedAt), asset: j.asset, customer: j.serviceOrder.customer.name, order: j.serviceOrder.no, engineer: j.engineer.name, gist: cut(kind === "maintenance" ? j.hazards || j.handled || j.conclusion : j.rootCause || j.confirmedFault || j.conclusion), href: `/service-orders/${j.serviceOrder.no}` }));
  }
  const href = (p: number) => `/service-reports?kind=${kind}${q ? `&q=${encodeURIComponent(q)}` : ""}&page=${p}`;
  return (
    <div className="space-y-4">
      <PageHeader title={n(NAVKEY[kind])} badge={<span className="text-sm text-navy/60">{total}</span>} />
      <form className="flex max-w-md gap-2"><input type="hidden" name="kind" value={kind} /><input name="q" defaultValue={q} placeholder={r("searchPh")} className="w-full rounded-lg border px-3 py-2 text-sm" /><button className="whitespace-nowrap rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold text-navy">{t("search")}</button></form>
      <Table head={[r("reportNo"), r("date"), t("assetCode"), t("customer"), r("order"), r("engineer"), r(kind === "inspection" ? "gistInspection" : kind === "repair" ? "gistRepair" : "gistMaintenance")]}>
        {rows.map((x) => (
          <tr key={x.no}>
            <td className="font-mono"><Link href={x.href} className="text-blue hover:underline">{x.no}</Link>{x.draft ? <span className="ml-1 text-xs text-[#9A5B00]">{r("draft")}</span> : null}</td>
            <td className="whitespace-nowrap">{x.date}</td>
            <td><Link href={`/assets/${x.asset.code}`} className="font-mono hover:underline">{x.asset.code}</Link><span className="block text-xs text-navy/60">{x.asset.serialNumber}</span></td>
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
