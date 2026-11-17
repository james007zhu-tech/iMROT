import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";

export const dynamic = "force-dynamic";

/**
 * 50 ทวิ — หนังสือรับรองการหักภาษี ณ ที่จ่าย (withholding tax certificate) of one payment: who withheld, from whom, on what
 * amount, how much. A page to print (Ctrl/⌘ P). The figures are the payment's; the layout is not the Revenue Department's
 * printed form — the accountant copies them onto it, or files from this page, until the official layout is built.
 */
export default async function WhtCertificate({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const p = await prisma.supplierPayment.findUnique({ where: { id }, include: { supplierInvoice: { include: { supplier: true } } } });
  if (!p || !p.whtCertNo) notFound();
  const inv = p.supplierInvoice, s = inv.supplier;
  const e = await prisma.legalEntity.findUniqueOrThrow({ where: { id: p.entityId } });
  const base = Number(inv.whtRate) > 0 ? Number(p.whtAmount) / Number(inv.whtRate) : 0;
  const row = (k: string, v: string) => <tr><td className="w-56 border px-2 py-1 text-navy/70">{k}</td><td className="border px-2 py-1">{v}</td></tr>;
  return (
    <div className="mx-auto max-w-3xl space-y-4 rounded-xl border bg-white p-6 text-sm text-navy print:border-0">
      <div className="flex items-start justify-between">{/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/dcit-logo.png" alt="DCiT" className="h-10 w-auto" />
        <div className="text-right"><div className="text-base font-bold">หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)</div><div>Withholding Tax Certificate · 预扣税凭证</div><div className="font-mono">{p.whtCertNo}</div></div>
      </div>
      <table className="w-full border-collapse"><tbody>
        {row("ผู้มีหน้าที่หักภาษี ณ ที่จ่าย / Payer", `${e.nameLocal ?? e.nameEn}`)}
        {row("เลขประจำตัวผู้เสียภาษี / Tax ID", `${e.taxId ?? ""}${e.branchCode ? ` · ${e.branchCode}` : ""}`)}
        {row("ที่อยู่ / Address", e.addressLocal ?? e.addressEn ?? "")}
        {row("ผู้ถูกหักภาษี ณ ที่จ่าย / Payee", s.nameLocal ?? s.name)}
        {row("เลขประจำตัวผู้เสียภาษี / Tax ID", `${s.taxId ?? ""}${s.branchCode ? ` · ${s.branchCode}` : ""}`)}
        {row("ที่อยู่ / Address", s.address ?? "")}
        {row("ประเภทเงินได้ / Income", "ค่าบริการ / ค่าจ้างทำของ (มาตรา 3 เตรส) · service / hire of work")}
        {row("ใบแจ้งหนี้ / Invoice", `${inv.invoiceNo} · ${localIso(inv.invoiceDate)!.slice(0, 10)}`)}
        {row("วันที่จ่าย / Date paid", localIso(p.paidAt ?? p.payDate)!.slice(0, 10))}
        {row("จำนวนเงินที่จ่าย / Amount paid (before tax)", `${inv.currency} ${base.toFixed(2)}`)}
        {row("อัตรา / Rate", `${(Number(inv.whtRate) * 100).toFixed(0)} %`)}
        {row("ภาษีที่หักและนำส่ง / Tax withheld", `${inv.currency} ${Number(p.whtAmount).toFixed(2)}`)}
        {row("เลขที่ใบสำคัญจ่าย / Payment voucher", p.no)}
      </tbody></table>
      <p className="text-xs text-navy/70">ผู้จ่ายเงิน: ออกให้ครั้งเดียว หัก ณ ที่จ่าย · สถานะการจ่าย: {p.status}</p>
      <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs"><div className="border-t pt-1">ผู้จ่ายเงิน / Payer</div><div className="border-t pt-1">วันที่ / Date</div></div>
    </div>
  );
}
