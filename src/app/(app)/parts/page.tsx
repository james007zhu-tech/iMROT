import { can } from "@/lib/caps";
import { currentEmployee } from "@/server/auth";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { btnGhost, inputCls, PAGE_SIZE, PageHeader, Pager, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Parts({ searchParams }: { searchParams: Promise<{ q?: string; movement?: string; order?: string; page?: string }> }) {
  const { q, movement, order, page } = await searchParams;
  const pg = Math.max(1, Number(page) || 1);
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  const seeCost = can.cost(me.role);
  const where = q ? { OR: [{ sku: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : undefined;
  const total = await prisma.part.count({ where });
  const qs = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(movement ? { movement } : {}), ...(order ? { order } : {}), page: String(n) })}`;
  const parts = await prisma.part.findMany({ where, skip: (pg - 1) * PAGE_SIZE, take: PAGE_SIZE, orderBy: { sku: "asc" }, include: { brand: true, movements: { select: { direction: true, qty: true, warehouse: true } }, _count: { select: { bomLines: true } } } });
  const onHand = (p: (typeof parts)[number]) => p.movements.reduce((s, m) => s + (m.direction === "IN" ? 1 : -1) * Number(m.qty), 0);
  // more than one warehouse holding the part: say where it lies (the figure itself is the sum — the same one every page shows)
  const where2 = (p: (typeof parts)[number]) => { const by = new Map<string, number>(); for (const m of p.movements) by.set(m.warehouse, (by.get(m.warehouse) ?? 0) + (m.direction === "IN" ? 1 : -1) * Number(m.qty)); const live = [...by].filter(([, n]) => Math.abs(n) > 1e-9); return live.length > 1 ? live.map(([w, n]) => `${w} ${n}`).join(" · ") : ""; };
  const mvHref = `/parts/movement${movement || order ? `?${new URLSearchParams({ ...(movement ? { direction: movement } : {}), ...(order ? { order } : {}) })}` : ""}`;
  return (
    <div className="space-y-4">
      <PageHeader title={t("parts")} badge={<Tag>{total}</Tag>} actions={<><Link href="/purchasing/inquiries" className="text-sm text-blue hover:underline">PRTH →</Link>{can.purchasing(me.role) && <><Link href="/purchasing/orders" className="text-sm text-blue hover:underline">POTH →</Link><Link href="/suppliers" className="text-sm text-blue hover:underline">{u("suppliers")} →</Link></>}<Link href={mvHref} className={btnGhost}>{u("newMovement")}</Link></>} newHref="/parts/new" newLabel={u("newPart")} />
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder={u("searchParts")} className={`${inputCls} max-w-sm`} /><button className={btnGhost}>{t("search")}</button></form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[t("sku"), t("name"), t("brand"), u("onHand"), t("inBoms"), ...(seeCost ? [t("lastCost")] : [])]}>
          {parts.map((p) => { const n = onHand(p); return <tr key={p.id}><td><Link href={`/parts/${p.sku}`} className="font-mono text-blue hover:underline">{p.sku}</Link></td><td>{p.name}{p.nameLocal ? <span className="block text-xs text-navy/70">{p.nameLocal}</span> : null}</td><td>{p.brand?.name ?? ""}</td><td>{p.safetyStock != null && n < p.safetyStock ? <Tag hot>{n}</Tag> : n}{where2(p) ? <span className="block text-xs text-navy/60">{where2(p)}</span> : null}</td><td>{p._count.bomLines}</td>{seeCost && <td>{p.lastCost != null ? `${p.lastCostCurrency} ${Number(p.lastCost).toFixed(2)}` : ""}</td>}</tr>; })}
          {parts.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-navy/60">{t("noParts")}</td></tr>}
        </Table>
        <Pager page={pg} total={total} href={qs} prev={u("prevPage")} next={u("nextPage")} />
      </div>
    </div>
  );
}
