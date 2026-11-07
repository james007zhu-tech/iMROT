import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Suppliers — master data behind PRTH / POTH. */
export default async function Suppliers({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const suppliers = await prisma.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { orders: true, quotes: true } } } });
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/parts", label: t("nav_scm") }} title={u("suppliers")} badge={<Tag>{suppliers.length}</Tag>} newHref="/suppliers/new" newLabel={u("newSupplier")} />
      <Flash ok={ok} error={error} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[t("name"), t("taxId"), t("currency"), u("paymentTerms"), u("leadTime"), "POTH", u("contactName")]}>
          {suppliers.map((s) => <tr key={s.id}><td><Link href={`/suppliers/new?id=${s.id}`} className="font-semibold text-blue hover:underline">{s.name}</Link>{s.nameLocal ? <span className="block text-xs text-navy/70">{s.nameLocal}</span> : null}</td><td className="font-mono">{s.taxId ?? ""}</td><td>{s.currency}</td><td>{s.paymentTerms ?? ""}</td><td>{s.leadTimeDays != null ? `${s.leadTimeDays} d` : ""}</td><td>{s._count.orders}</td><td>{s.contactName ?? ""}{s.phone ? ` · ${s.phone}` : ""}</td></tr>)}
          {suppliers.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-navy/60">{u("noSuppliers")}</td></tr>}
        </Table>
      </div>
    </div>
  );
}
