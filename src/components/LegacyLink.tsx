import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import type { Who } from "@/lib/caps";
import { legacyKinds, legacyOwnOnly, type LegacyKindKey } from "@/lib/legacy";

/**
 * On a list of today's papers: the way to the same kind of paper from the old system (朱总 2026-11-24 looked for the
 * imported quotes, reports and invoices in these lists and did not find them — they live under 历史单据).
 */
export async function LegacyLink({ me, kinds }: { me: Who & { id: string }; kinds: LegacyKindKey[] }) {
  const mine = kinds.filter((k) => legacyKinds(me).includes(k));
  if (!mine.length) return null;
  const [rows, l] = await Promise.all([prisma.legacyDoc.groupBy({ by: ["kind"], where: { kind: { in: mine }, ...(legacyOwnOnly(me) ? { customer: { salesId: me.id } } : {}) }, _count: true }), getTranslations("legacy")]);
  if (!rows.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue/30 bg-blue/5 px-3 py-2 text-sm">
      <span className="text-navy/70">{l("linkLead")}</span>
      {mine.map((k) => { const n = rows.find((r) => r.kind === k)?._count ?? 0; return n ? <Link key={k} href={`/documents/legacy?kind=${k}`} className="whitespace-nowrap font-medium text-blue hover:underline">{l(`k_${k}`)} {n} →</Link> : null; })}
    </p>
  );
}
