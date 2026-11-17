import { currentEmployee } from "@/server/auth";
import { customerScope } from "@/server/scope";
import { can } from "@/lib/caps";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { btnGhost, inputCls, PAGE_SIZE, PageHeader, Pager, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Customers({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const me = await currentEmployee();
  const where = { AND: [await customerScope(me), q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { nameLocal: { contains: q, mode: "insensitive" as const } }, { code: { contains: q, mode: "insensitive" as const } }, { taxId: { contains: q } }] } : {}] };
  const [customers, total] = await Promise.all([
    prisma.customer.findMany({ where, orderBy: { code: "asc" }, include: { entity: true, _count: { select: { assets: true, serviceOrders: true, plants: true } } }, skip: (p - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.customer.count({ where }),
  ]);
  const full = can.customersAll(me); // 税号、开票信息 are not for the shop floor
  const qs = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), page: String(n) })}`;
  return (
    <div className="space-y-4">
      <PageHeader title={u("customers")} badge={<Tag>{total}</Tag>} newHref={can.customers(me) ? "/customers/new" : undefined} newLabel={u("newCustomer")} />
      <form className="flex gap-2"><input name="q" defaultValue={q} placeholder={u("searchCustomers")} className={`${inputCls} max-w-sm`} /><button className={btnGhost}>{t("search")}</button></form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={["CTH", t("customer"), ...(full ? [t("taxId")] : []), u("legalEntity"), u("plants"), t("assets"), t("serviceOrders")]}>
          {customers.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/customers/${c.code}`} className="font-mono text-blue hover:underline">{c.code}</Link></td>
              <td>{c.name}{c.nameLocal ? <span className="block text-xs text-navy/70">{c.nameLocal}</span> : null}</td>
              {full && <td className="font-mono">{c.taxId ?? ""}{c.branchCode ? ` · ${c.branchCode}` : ""}</td>}
              <td>{c.entity.code}</td><td>{c._count.plants}</td><td>{c._count.assets}</td><td>{c._count.serviceOrders}</td>
            </tr>
          ))}
          {customers.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-navy/60">{t("none")}</td></tr>}
        </Table>
        <Pager page={p} total={total} href={qs} prev={u("prevPage")} next={u("nextPage")} />
      </div>
    </div>
  );
}
