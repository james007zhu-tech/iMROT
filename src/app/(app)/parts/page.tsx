import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { btnGhost, inputCls, PAGE_SIZE, PageHeader, Pager, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Parts({ searchParams }: { searchParams: Promise<{ q?: string; movement?: string; order?: string; page?: string }> }) {
  const { q, movement, order, page } = await searchParams;
  const pg = Math.max(1, Number(page) || 1);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const where = q ? { OR: [{ sku: { contains: q, mode: "insensitive" as const } }, { name: { contains: q, mode: "insensitive" as const } }] } : undefined;
  const total = await prisma.part.count({ where });
  const qs = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(movement ? { movement } : {}), ...(order ? { order } : {}), page: String(n) })}`;
  const parts = await prisma.part.findMany({ where, skip: (pg - 1) * PAGE_SIZE, take: PAGE_SIZE, orderBy: { sku: "asc" }, include: { brand: true, movements: { select: { direction: true, qty: true } }, _count: { select: { bomLines: true } } } });
  const onHand = (p: (typeof parts)[number]) => p.movements.reduce((s, m) => s + (m.direction === "IN" ? 1 : -1) * Number(m.qty), 0);
  const mvHref = `/parts/movement${movement || order ? `?${new URLSearchParams({ ...(movement ? { direction: movement } : {}), ...(order ? { order } : {}) })}` : ""}`;
  return (
    <div className="space-y-4">
      <PageHeader title={t("parts")} badge={<Tag>{total}</Tag>} actions={<><Link href="/purchasing/inquiries" className="text-sm text-blue hover:underline">PRTH →</Link><Link href="/purchasing/orders" className="text-sm text-blue hover:underline">POTH →</Link><Link href="/suppliers" className="text-sm text-blue hover:underline">{u("suppliers")} →</Link><Link href="/parts/new" className={btnGhost}>＋ {u("newPart")}</Link></>} newHref={mvHref} newLabel={u("newMovement")} />
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder={u("searchParts")} className={`${inputCls} max-w-sm`} /><button className={btnGhost}>{t("search")}</button></form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[t("sku"), t("name"), t("brand"), u("onHand"), t("inBoms"), t("lastCost")]}>
          {parts.map((p) => { const n = onHand(p); return <tr key={p.id}><td><Link href={`/parts/${p.sku}`} className="font-mono text-blue hover:underline">{p.sku}</Link></td><td>{p.name}{p.nameLocal ? <span className="block text-xs text-navy/70">{p.nameLocal}</span> : null}</td><td>{p.brand?.name ?? ""}</td><td>{p.safetyStock != null && n < p.safetyStock ? <Tag hot>{n}</Tag> : n}</td><td>{p._count.bomLines}</td><td>{p.lastCost != null ? `${p.lastCostCurrency} ${Number(p.lastCost).toFixed(2)}` : ""}</td></tr>; })}
          {parts.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-navy/60">{t("noParts")}</td></tr>}
        </Table>
        <Pager page={pg} total={total} href={qs} prev={u("prevPage")} next={u("nextPage")} />
      </div>
    </div>
  );
}
