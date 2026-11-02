import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Phase 1 slice: the invoices and payments that belong to service orders. Full module in Phase 2. */
export default async function Page() {
  const invoices = await prisma.invoice.findMany({ orderBy: { issuedAt: "desc" }, take: 100, include: { serviceOrder: { include: { customer: true } }, taxInvoice: true } });
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">T__TITLE__O · Invoices</h1>
      <div className="rounded-lg border bg-white"><table className="w-full text-sm"><thead className="bg-slate-100 text-left"><tr><th className="px-3 py-2">IVTH</th><th className="px-3 py-2">TITH</th><th className="px-3 py-2">QTTH</th><th className="px-3 py-2">Customer</th><th className="px-3 py-2">Due</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Paid</th><th className="px-3 py-2 text-right">WHT</th><th className="px-3 py-2 text-right">CNY</th></tr></thead>
        <tbody>{invoices.map((i) => <tr key={i.id} className="border-t"><td className="px-3 py-2 font-mono">{i.no}</td><td className="px-3 py-2 font-mono">{i.taxInvoice?.no ?? ""}</td><td className="px-3 py-2 font-mono"><Link href={`/service-orders/${i.serviceOrder.no}`} className="text-blue underline">{i.serviceOrder.no}</Link></td><td className="px-3 py-2">{i.serviceOrder.customer.name}</td><td className="px-3 py-2">{i.dueAt?.toISOString().slice(0, 10) ?? ""}</td><td className="px-3 py-2 text-right">{i.currency} {Number(i.amountDue).toFixed(2)}</td><td className="px-3 py-2 text-right">{Number(i.paidAmount ?? 0).toFixed(2)}</td><td className="px-3 py-2 text-right">{Number(i.whtAmount ?? 0).toFixed(2)}</td><td className="px-3 py-2 text-right">{i.taxInvoice ? Number(i.taxInvoice.totalCny).toFixed(2) : ""}</td></tr>)}{invoices.length === 0 && <tr><td colSpan={9} className="px-3 py-4 text-slate-500">no invoices yet</td></tr>}</tbody></table></div>
    </div>
  );
}
