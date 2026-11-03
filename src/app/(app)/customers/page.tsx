import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { PageHeader, Table, Tag, btnGhost, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const customers = await prisma.customer.findMany({
    where: q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { nameLocal: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { taxId: { contains: q } }] } : undefined,
    orderBy: { code: "asc" }, include: { entity: true, _count: { select: { assets: true, serviceOrders: true, plants: true } } },
  });
  return (
    <div className="space-y-4">
      <PageHeader title={u("customers")} badge={<Tag>{customers.length}</Tag>} newHref="/customers/new" newLabel={u("newCustomer")} />
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder={u("searchCustomers")} className={`${inputCls} max-w-sm`} /><button className={btnGhost}>{t("search")}</button></form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={["CTH", t("customer"), t("taxId"), u("legalEntity"), u("plants"), t("assets"), t("serviceOrders")]}>
          {customers.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/customers/${c.code}`} className="font-mono text-blue hover:underline">{c.code}</Link></td>
              <td>{c.name}{c.nameLocal ? <span className="block text-xs text-navy/70">{c.nameLocal}</span> : null}</td>
              <td className="font-mono">{c.taxId ?? ""}{c.branchCode ? ` · ${c.branchCode}` : ""}</td>
              <td>{c.entity.code}</td><td>{c._count.plants}</td><td>{c._count.assets}</td><td>{c._count.serviceOrders}</td>
            </tr>
          ))}
          {customers.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-navy/60">{t("none")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
