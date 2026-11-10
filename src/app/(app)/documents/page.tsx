import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { maskName } from "@/lib/mask";
import { DOC_PLACES, DOC_TYPES } from "@/lib/doc-center";
import { PageHeader, Table, Pager, PAGE_SIZE, Card, btnBlue } from "@/components/ui";

export const dynamic = "force-dynamic";

const day = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/**
 * /documents            单据中心 — every numbered document, by type, number, customer or order
 * /documents?type=DN    one document's own list (menu entries 设备接收单, 送货单, 入库单 …)
 * /documents?type=AC    验收 — acceptance records (they carry no number of their own; listed by order)
 * ?new=1                where to start a new one: the form, or the orders that are ready for this step
 */
export default async function Documents({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; page?: string; new?: string }> }) {
  const sp = await searchParams;
  const type = sp.type === "AC" || DOC_TYPES.includes(sp.type ?? "") ? sp.type! : undefined;
  const q = sp.q?.trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const [t, n, d, u, ts] = await Promise.all([getTranslations("common"), getTranslations("nav"), getTranslations("docs"), getTranslations("ui"), getTranslations("orderStatus")]);
  const place = type && type !== "AC" ? DOC_PLACES[type] : undefined;
  const title = type === "AC" ? n("acceptance") : place ? n(place.nav) : n("documents");
  const href = (o: { type?: string; page?: number; new?: boolean }) => `/documents?${new URLSearchParams({ ...((o.type ?? type) ? { type: (o.type ?? type)! } : {}), ...(q ? { q } : {}), ...(o.page ? { page: String(o.page) } : {}), ...(o.new ? { new: "1" } : {}) })}`;
  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });

  // ── where a new one starts ──
  const step = type === "AC" ? { path: "accept", statuses: ["ACCEPTANCE_PENDING", "IN_PROGRESS"], modes: undefined as string[] | undefined } : place?.step;
  const ready = sp.new && step ? await prisma.serviceOrder.findMany({ where: { status: { in: step.statuses as never }, ...(step.modes ? { mode: { in: step.modes as never } } : {}) }, orderBy: { reportedAt: "desc" }, take: 40, select: { no: true, status: true, customer: { select: { name: true } }, reportedSymptom: true, project: true } }) : null;
  const newButton = place?.newHref ? <Link href={place.newHref} className={btnBlue}>＋ {d("new", { name: title })}</Link> : step ? <Link href={href({ new: true })} className={btnBlue}>＋ {d("new", { name: title })}</Link> : null;

  let total = 0;
  let body: React.ReactNode;
  if (type === "AC") {
    const where: Prisma.AcceptanceWhereInput = q ? { serviceOrder: { OR: [{ no: like(q) }, { customer: { name: like(q) } }] } } : {};
    const [rows, c] = await Promise.all([prisma.acceptance.findMany({ where, orderBy: { acceptedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { serviceOrder: { select: { no: true, customer: { select: { name: true } } } } } }), prisma.acceptance.count({ where })]);
    total = c;
    body = (
      <Table head={[d("order"), t("customer"), t("status"), d("date"), d("signedBy")]}>
        {rows.map((a) => <tr key={a.id}><td className="font-mono"><Link href={`/service-orders/${a.serviceOrder.no}/accept`} className="text-blue hover:underline">{a.serviceOrder.no}</Link></td><td>{a.serviceOrder.customer.name}</td><td>{d(`ac_${a.status}`)}</td><td className="whitespace-nowrap">{day(a.acceptedAt)}</td><td>{maskName(a.customerSignatory)}</td></tr>)}
        {rows.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-navy/60">{d("none")}</td></tr>}
      </Table>
    );
  } else {
    const where: Prisma.DocumentWhereInput = { ...(type ? { type: type as never } : {}), ...(q ? { OR: [{ no: like(q) }, { customer: { name: like(q) } }, { serviceOrder: { no: like(q) } }, { serviceOrder: { customerRef: like(q) } }] } : {}) };
    const [rows, c] = await Promise.all([prisma.document.findMany({ where, orderBy: [{ issuedAt: "desc" }, { no: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { customer: { select: { name: true } }, serviceOrder: { select: { no: true, customer: { select: { name: true } } } }, createdBy: { select: { name: true } } } }), prisma.document.count({ where })]);
    total = c;
    body = (
      <Table head={[d("no"), ...(type ? [] : [d("kind")]), d("date"), t("customer"), d("order"), d("by"), ""]}>
        {rows.map((x) => {
          const p = DOC_PLACES[x.type];
          return (
            <tr key={x.id} className={x.voidedAt ? "text-navy/40 line-through" : ""}>
              <td className="font-mono"><Link href={p ? p.open(x.no, x.serviceOrder?.no) : `/search?q=${x.no}`} className="text-blue hover:underline">{x.no}</Link></td>
              {!type && <td>{p ? n(p.nav) : x.type}</td>}
              <td className="whitespace-nowrap">{day(x.issuedAt)}</td>
              <td>{x.customer?.name ?? x.serviceOrder?.customer.name ?? ""}</td>
              <td className="font-mono">{x.serviceOrder && x.serviceOrder.no !== x.no ? <Link href={`/service-orders/${x.serviceOrder.no}`} className="hover:underline">{x.serviceOrder.no}</Link> : ""}</td>
              <td>{x.createdBy.name}</td>
              <td className="text-right">{x.templateCode ? <a href={`/api/documents/${x.no}/render?format=pdf`} className="text-xs text-blue hover:underline">PDF</a> : null}</td>
            </tr>
          );
        })}
        {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-navy/60">{d("none")}</td></tr>}
      </Table>
    );
  }
  const counts = type ? [] : await prisma.document.groupBy({ by: ["type"], _count: true });
  return (
    <div className="space-y-4">
      <PageHeader title={title} badge={<span className="text-sm text-navy/60">{total}</span>} actions={newButton} />
      {!type && (
        <div className="flex flex-wrap gap-2">
          {DOC_TYPES.map((k) => <Link key={k} href={href({ type: k })} className="rounded-full border border-navy/20 bg-white px-3 py-1.5 text-[13px] text-navy hover:border-blue hover:text-blue">{n(DOC_PLACES[k].nav)} <span className="text-xs text-navy/50">{counts.find((c) => c.type === k)?._count ?? 0}</span></Link>)}
          <Link href={href({ type: "AC" })} className="rounded-full border border-navy/20 bg-white px-3 py-1.5 text-[13px] text-navy hover:border-blue hover:text-blue">{n("acceptance")}</Link>
        </div>
      )}
      {ready && (
        <Card title={d("pickOrder", { name: title })} accent>
          {ready.length === 0 ? <p className="text-sm text-navy/70">{d("noReady")}</p> : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {ready.map((o) => <Link key={o.no} href={`/service-orders/${o.no}/${step!.path}`} className="rounded-lg border border-hair bg-white px-3 py-2 text-sm hover:border-blue"><span className="font-mono text-blue">{o.no}</span> <span className="text-navy">{o.customer.name}</span><span className="block truncate text-xs text-navy/60">{ts(o.status)}{o.reportedSymptom ? ` · ${o.reportedSymptom}` : (o.project as { name?: string } | null)?.name ? ` · ${(o.project as { name?: string }).name}` : ""}</span></Link>)}
            </div>
          )}
        </Card>
      )}
      <form className="flex max-w-md gap-2">{type && <input type="hidden" name="type" value={type} />}<input name="q" defaultValue={q} placeholder={d("searchPh")} className="w-full rounded-lg border px-3 py-2 text-sm" /><button className="whitespace-nowrap rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold text-navy">{t("search")}</button></form>
      {body}
      <Pager page={page} total={total} href={(p) => href({ page: p })} prev={u("prevPage")} next={u("nextPage")} />
    </div>
  );
}
