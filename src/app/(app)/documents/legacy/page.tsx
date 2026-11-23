import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { currentEmployee } from "@/server/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/caps";
import { legacyKinds, legacyOwnOnly, type LegacyKindKey } from "@/lib/legacy";
import { PageHeader, Table, Pager, PAGE_SIZE, inputCls, btnGhost } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * /documents/legacy  历史单据 — the records of the old system (简道云), read-only, under their old numbers (朱总 2026-11-23).
 * ?kind= one kind · ?q= old number, any number the record names, customer, title · ?customer= / ?asset= one customer / machine
 */
export default async function LegacyList({ searchParams }: { searchParams: Promise<{ kind?: string; q?: string; page?: string; customer?: string; asset?: string }> }) {
  const sp = await searchParams;
  const me = await currentEmployee();
  const [l, u] = await Promise.all([getTranslations("legacy"), getTranslations("common")]);
  const kinds = legacyKinds(me);
  const kind = kinds.includes(sp.kind as LegacyKindKey) ? (sp.kind as LegacyKindKey) : undefined;
  const q = sp.q?.trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const where: Prisma.LegacyDocWhereInput = { AND: [
    { kind: kind ?? { in: kinds } },
    legacyOwnOnly(me) ? { customer: { salesId: me.id } } : {},
    sp.customer ? { customer: { code: sp.customer } } : {},
    sp.asset ? { asset: { code: sp.asset } } : {},
    q ? { OR: [{ no: like(q) }, { refs: { has: q } }, { title: like(q) }, { customer: { name: like(q) } }, { asset: { code: like(q) } }, { asset: { serialNumber: like(q) } }] } : {},
  ] };
  const [rows, total, counts] = await Promise.all([
    prisma.legacyDoc.findMany({ where, orderBy: [{ docDate: { sort: "desc", nulls: "last" } }, { no: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { customer: { select: { code: true, name: true } }, asset: { select: { code: true } } } }),
    prisma.legacyDoc.count({ where }),
    prisma.legacyDoc.groupBy({ by: ["kind"], where: { AND: [{ kind: { in: kinds } }, legacyOwnOnly(me) ? { customer: { salesId: me.id } } : {}] }, _count: true }),
  ]);
  const href = (o: { kind?: string | null; page?: number }) => `/documents/legacy?${new URLSearchParams({ ...((o.kind === null ? undefined : o.kind ?? kind) ? { kind: (o.kind ?? kind)! } : {}), ...(q ? { q } : {}), ...(sp.customer ? { customer: sp.customer } : {}), ...(sp.asset ? { asset: sp.asset } : {}), ...(o.page ? { page: String(o.page) } : {}) })}`;
  const n = (k: string) => counts.find((c) => c.kind === k)?._count ?? 0;
  const money = can.price(me);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/documents", label: u("back") }} title={l("title")} />
      <p className="text-sm text-navy/70">{l("hint")}</p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={href({ kind: null })} className={`rounded-full border px-3 py-1 ${!kind ? "border-blue bg-blue/10 text-blue" : "border-navy/20"}`}>{l("allKinds")} · {counts.reduce((s, c) => s + c._count, 0)}</Link>
        {kinds.map((k) => <Link key={k} href={href({ kind: k })} className={`whitespace-nowrap rounded-full border px-3 py-1 ${kind === k ? "border-blue bg-blue/10 text-blue" : "border-navy/20"}`}>{l(`k_${k}`)} · {n(k)}</Link>)}
      </div>
      <form className="flex gap-2" action="/documents/legacy">
        {kind && <input type="hidden" name="kind" value={kind} />}
        <input name="q" defaultValue={q} placeholder={l("search")} className={`${inputCls} max-w-md`} />
        <button className={btnGhost}>{u("search")}</button>
      </form>
      <Table head={[l("oldNo"), l("kind"), l("date"), l("customer"), l("asset"), l("what"), ...(money ? [l("amount")] : [])]}>
        {rows.map((x) => (
          <tr key={x.id}>
            <td className="whitespace-nowrap font-mono"><Link href={`/documents/legacy/${x.id}`} className="text-blue hover:underline">{x.no ?? "—"}</Link></td>
            <td className="whitespace-nowrap">{l(`k_${x.kind}`)}</td>
            <td className="whitespace-nowrap">{x.docDate?.toISOString().slice(0, 10) ?? ""}</td>
            <td>{can.customerNames(me) ? x.customer?.name ?? "" : "—"}</td>
            <td className="whitespace-nowrap font-mono">{x.asset ? <Link href={`/assets/${x.asset.code}`} className="hover:underline">{x.asset.code}</Link> : ""}</td>
            <td>{x.title}</td>
            {money && <td className="whitespace-nowrap text-right tabular-nums">{x.amount ? `${Number(x.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${x.currency ?? ""}` : ""}</td>}
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-navy/60">{l("none")}</td></tr>}
      </Table>
      <Pager page={page} total={total} href={(p) => href({ page: p })} prev={l("prevPage")} next={l("nextPage")} />
    </div>
  );
}
