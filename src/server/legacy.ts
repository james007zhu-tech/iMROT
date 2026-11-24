import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Who } from "@/lib/caps";
import { legacyKinds, legacyOwnOnly, type LegacyKindKey } from "@/lib/legacy";

/**
 * 历史单据 in the lists of today's papers (朱总 2026-11-24:「显示在现行列表里、和新单据排在一起」). Every record of the old
 * system is older than every paper of this one (the old system stopped on 2026-11-23, the day this one started), so a
 * list sorted newest first is: this system's rows, then the old system's. `legacyTail` returns the old rows that fall
 * on the asked page after `liveTotal` live rows, and how many old rows there are in all.
 */
export interface LegacyRow { id: string; kind: LegacyKindKey; no: string; date: string; customer: string; assetCode: string; serial: string; title: string; amount: number | null; currency: string; by: string; href: string; field: (...starts: string[]) => string }
export async function legacyTail(me: Who & { id: string }, kinds: LegacyKindKey[], o: { q?: string; page: number; size: number; liveTotal: number }): Promise<{ rows: LegacyRow[]; total: number }> {
  const mine = kinds.filter((k) => legacyKinds(me).includes(k));
  if (!mine.length) return { rows: [], total: 0 };
  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const where: Prisma.LegacyDocWhereInput = { AND: [
    { kind: { in: mine } },
    legacyOwnOnly(me) ? { customer: { salesId: me.id } } : {},
    o.q ? { OR: [{ no: like(o.q) }, { refs: { has: o.q } }, { title: like(o.q) }, { customer: { name: like(o.q) } }, { asset: { code: like(o.q) } }, { asset: { serialNumber: like(o.q) } }] } : {},
  ] };
  const total = await prisma.legacyDoc.count({ where });
  const from = (o.page - 1) * o.size, liveOnPage = Math.max(0, Math.min(o.size, o.liveTotal - from)), take = o.size - liveOnPage;
  if (take <= 0 || total === 0) return { rows: [], total };
  const list = await prisma.legacyDoc.findMany({ where, orderBy: [{ docDate: { sort: "desc", nulls: "last" } }, { no: "desc" }, { id: "asc" }], skip: Math.max(0, from - o.liveTotal), take, include: { customer: { select: { name: true } }, asset: { select: { code: true, serialNumber: true } } } });
  const names = can.customerNames(me), money = can.price(me);
  return { total, rows: list.map((x) => {
    const fields = ((x.data as { fields?: [string, string][] }).fields ?? []);
    return { id: x.id, kind: x.kind as LegacyKindKey, no: x.no ?? "—", date: x.docDate?.toISOString().slice(0, 10) ?? "", customer: names ? x.customer?.name ?? "" : "—", assetCode: x.asset?.code ?? "", serial: x.asset?.serialNumber ?? "",
      title: x.title ?? "", amount: money && x.amount != null ? Number(x.amount) : null, currency: x.currency ?? "", by: x.submittedBy ?? "", href: `/documents/legacy/${x.id}`,
      field: (...starts: string[]) => { for (const s of starts) { const f = fields.find(([k]) => k.startsWith(s)); if (f) return f[1]; } return ""; } };
  }) };
}
