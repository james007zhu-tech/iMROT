import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { currentEmployee } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function Customers() {
  const t = await getTranslations("common");
  const customers = await prisma.customer.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { assets: true, serviceOrders: true } } } });
  async function create(form: FormData) {
    "use server";
    const me = await currentEmployee();
    const c = await prisma.$transaction(async (tx) => {
      const code = await allocateNumber(tx, { prefix: "C", createdByEmployeeCode: me.code, entityId: me.entityId });
      return tx.customer.create({ data: { code, entityId: me.entityId, name: String(form.get("name")), nameLocal: String(form.get("nameLocal") || "") || undefined, taxId: String(form.get("taxId") || "") || undefined, branchCode: String(form.get("branchCode") || "") || undefined, addressLocal: String(form.get("addressLocal") || "") || undefined, paymentTermDays: Number(form.get("paymentTermDays") || 30), monthlyStatement: form.get("monthlyStatement") === "on" } });
    });
    redirect(`/customers/${c.code}`);
  }
  const input = "rounded border px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">CRM · {t("customer")}</h1>
      <form action={create} className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3">
        <input name="name" placeholder="Name (EN)" className={input} required /><input name="nameLocal" placeholder="ชื่อ (TH)" className={input} /><input name="taxId" placeholder="Tax ID" className={input} /><input name="branchCode" placeholder="Branch 00000" className={input} /><input name="addressLocal" placeholder="Address" className={`${input} w-64`} /><input name="paymentTermDays" type="number" placeholder="Term days" className={`${input} w-24`} /><label className="text-sm"><input type="checkbox" name="monthlyStatement" /> BLTH 月结</label>
        <button className="rounded bg-navy px-3 py-1.5 text-sm text-white">{t("new")}</button>
      </form>
      <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">CTH</th><th className="px-3 py-2">{t("customer")}</th><th className="px-3 py-2">Tax ID</th><th className="px-3 py-2">{t("assets")}</th><th className="px-3 py-2">{t("serviceOrders")}</th></tr></thead>
        <tbody>{customers.map((c) => <tr key={c.id} className="border-t"><td className="px-3 py-2 font-mono"><Link href={`/customers/${c.code}`} className="text-blue underline">{c.code}</Link></td><td className="px-3 py-2">{c.name}{c.nameLocal ? <span className="block text-xs text-slate-500">{c.nameLocal}</span> : null}</td><td className="px-3 py-2 font-mono">{c.taxId ?? ""}</td><td className="px-3 py-2">{c._count.assets}</td><td className="px-3 py-2">{c._count.serviceOrders}</td></tr>)}</tbody></table></div>
    </div>
  );
}
