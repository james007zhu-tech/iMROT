import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { can, type Who } from "@/lib/caps";
import { legacyKinds } from "@/lib/legacy";
import { Card, Table } from "@/components/ui";

/** 历史单据 of one machine or one customer (朱总 2026-11-23): the old system's papers, under their old numbers. */
export async function LegacyDocs({ me, where, more }: { me: Who; where: Prisma.LegacyDocWhereInput; more: string }) {
  const kinds = legacyKinds(me);
  if (!kinds.length) return null;
  const w: Prisma.LegacyDocWhereInput = { AND: [where, { kind: { in: kinds } }] };
  const [rows, total, l] = await Promise.all([prisma.legacyDoc.findMany({ where: w, orderBy: [{ docDate: { sort: "desc", nulls: "last" } }, { no: "desc" }], take: 20, select: { id: true, kind: true, no: true, docDate: true, title: true, amount: true, currency: true } }), prisma.legacyDoc.count({ where: w }), getTranslations("legacy")]);
  if (!total) return null;
  return (
    <Card title={`${l("title")} · ${total}`}>
      <p className="mb-2 text-xs text-navy/60">{l("hint")}</p>
      <Table head={[l("oldNo"), l("kind"), l("date"), l("what"), ...(can.price(me) ? [l("amount")] : [])]}>
        {rows.map((x) => (
          <tr key={x.id}>
            <td className="whitespace-nowrap font-mono"><Link href={`/documents/legacy/${x.id}`} className="text-blue hover:underline">{x.no ?? "—"}</Link></td>
            <td className="whitespace-nowrap">{l(`k_${x.kind}`)}</td>
            <td className="whitespace-nowrap">{x.docDate?.toISOString().slice(0, 10) ?? ""}</td>
            <td>{x.title}</td>
            {can.price(me) && <td className="whitespace-nowrap text-right tabular-nums">{x.amount ? `${Number(x.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${x.currency ?? ""}` : ""}</td>}
          </tr>
        ))}
      </Table>
      {total > rows.length && <Link href={more} className="mt-2 inline-block text-sm text-blue hover:underline">{l("all", { n: total })}</Link>}
    </Card>
  );
}
