import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { localIso } from "@/lib/dates";
import { thaiAmount } from "@/lib/amount-words";
import { WHT_TH, pndOf, taxId13, type WhtType } from "@/lib/wht";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/**
 * 50 ทวิ — หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร, laid out after the Revenue Department's form:
 * payer, payee, the P.N.D. form it is filed on, the table of income kinds (the payment sits on line 5 — มาตรา 3 เตรส),
 * totals, the tax in words, who bears the tax, the signature. It can be looked at as soon as finance asks for the
 * payment (ฉบับร่าง — before the MD approves) and printed or saved as PDF once the payment is confirmed (派修单 v4 A).
 */
export default async function WhtCertificate({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ inv?: string; gross?: string; rate?: string; type?: string }> }) {
  const { id } = await params, q = await searchParams;
  const u = await getTranslations("ui");
  // 财神爷 2026-11-18: the certificate can be looked at before the payment is even asked for — as soon as the income kind
  // and the rate are chosen. /wht/preview?inv=…&gross=…&rate=…&type=… builds the same page from the form's figures:
  // no number is taken, nothing is stored, the watermark says ฉบับร่าง.
  let p = id === "preview" ? null : await prisma.supplierPayment.findUnique({ where: { id }, include: { supplierInvoice: { include: { supplier: true } } } });
  if (id === "preview") {
    const inv = q.inv ? await prisma.supplierInvoice.findUnique({ where: { id: q.inv }, include: { supplier: true } }) : null;
    if (!inv) notFound();
    const gross = Math.min(Number(q.gross) || 0, Number(inv.total)), rate = Math.max(0, Math.min(0.15, Number(q.rate) || 0));
    const wht = Math.round(gross * (Number(inv.total) > 0 ? Number(inv.subtotal) / Number(inv.total) : 1) * rate * 100) / 100;
    p = { id: "preview", no: inv.invoiceNo, entityId: inv.entityId, status: "REQUESTED", whtCertNo: "—", whtRate: rate, whtAmount: wht, gross, whtType: q.type || "SERVICE", paidAt: null, payDate: new Date(), supplierInvoice: inv } as unknown as typeof p;
  }
  if (!p || !p.whtCertNo) notFound();
  const inv = p.supplierInvoice, s = inv.supplier;
  const e = await prisma.legalEntity.findUniqueOrThrow({ where: { id: p.entityId } });
  const rate = Number(p.whtRate ?? inv.whtRate), wht = Number(p.whtAmount), base = Number(p.gross ?? 0) > 0 ? Math.round((Number(p.gross) * (Number(inv.total) > 0 ? Number(inv.subtotal) / Number(inv.total) : 1)) * 100) / 100 : rate > 0 ? Math.round((wht / rate) * 100) / 100 : 0;
  const type = (p.whtType ?? "SERVICE") as WhtType, pnd = pndOf(s.nameLocal ?? s.name);
  const state = p.status === "PAID" ? "issued" : p.status === "VOID" || p.status === "REJECTED" ? "void" : "draft";
  const paidOn = localIso(p.paidAt ?? p.payDate)!.slice(0, 10), [yy, mm, dd] = paidOn.split("-");
  const thDate = `${dd}/${mm}/${Number(yy) + 543}`;
  const m = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const digits = (t: string) => <span className="font-mono tracking-[0.18em]">{taxId13(t) || "—"}</span>;
  const box = (on: boolean, label: string) => <span className="mr-3 whitespace-nowrap"><span className="mr-1 inline-block h-3 w-3 border border-black text-center align-[-1px] text-[10px] leading-[10px]">{on ? "✕" : ""}</span>{label}</span>;
  const kinds: [string, boolean][] = [["1. เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40 (1)", false], ["2. ค่าธรรมเนียม ค่านายหน้า ฯลฯ ตามมาตรา 40 (2)", false], ["3. ค่าแห่งลิขสิทธิ์ ฯลฯ ตามมาตรา 40 (3)", false], ["4. (ก) ดอกเบี้ย ฯลฯ ตามมาตรา 40 (4) (ก)", false], ["   (ข) เงินปันผล เงินส่วนแบ่งกำไร ฯลฯ ตามมาตรา 40 (4) (ข)", false], [`5. การจ่ายเงินได้ที่ต้องหักภาษี ณ ที่จ่าย ตามคำสั่งกรมสรรพากรที่ออกตามมาตรา 3 เตรส — ${WHT_TH[type]}`, type !== "OTHER"], ["6. อื่น ๆ (ระบุ)", type === "OTHER"]];
  return (
    <div className="mx-auto max-w-[210mm] space-y-3">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={id === "preview" ? "/finance/payables" : `/finance/payables?all=1#${p.no}`} className="text-sm text-blue hover:underline">← {p.no}</Link>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${state === "issued" ? "border-navy text-navy" : state === "void" ? "border-alert text-alert-ink" : "border-[#E6A23C] bg-[#FFF4E5] text-[#7A4A00]"}`}>{u(`whtState_${state}`)}</span>
        {state === "draft" && <span className="text-xs text-navy/70">{u("whtDraftHelp")}</span>}
        <span className="ml-auto" />{state !== "void" && <PrintButton label={u(state === "issued" ? "whtPdf" : "whtPdfDraft")} />}
      </div>
      <div className="relative border border-black bg-white p-5 text-[12px] leading-relaxed text-black print:border-0 print:p-0">
        {state !== "issued" && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-bold text-black/10" style={{ transform: "rotate(-24deg)" }}>{state === "void" ? "ยกเลิก VOID" : "ฉบับร่าง DRAFT"}</div>}
        <div className="flex items-start justify-between"><div className="text-[11px]">ฉบับที่ 1 (สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี)</div><div className="text-right text-[11px]">เล่มที่ <b>{p.whtCertNo.slice(4, 8)}</b>　เลขที่ <b className="font-mono">{p.whtCertNo}</b></div></div>
        <h1 className="mt-1 text-center text-[15px] font-bold">หนังสือรับรองการหักภาษี ณ ที่จ่าย</h1>
        <div className="text-center">ตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร</div>
        <div className="mt-2 border border-black p-2">
          <div className="flex justify-between gap-2"><b>ผู้มีหน้าที่หักภาษี ณ ที่จ่าย :</b><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) {digits(e.taxId ?? "")}</span></div>
          <div>ชื่อ <b>{e.nameLocal ?? e.nameEn}</b>{e.branchCode ? `　สาขา ${e.branchCode}` : ""}</div><div>ที่อยู่ {e.addressLocal ?? e.addressEn ?? ""}</div>
        </div>
        <div className="mt-1 border border-black p-2">
          <div className="flex justify-between gap-2"><b>ผู้ถูกหักภาษี ณ ที่จ่าย :</b><span>เลขประจำตัวผู้เสียภาษีอากร (13 หลัก) {digits(s.taxId ?? "")}</span></div>
          <div>ชื่อ <b>{s.nameLocal ?? s.name}</b>{s.branchCode ? `　สาขา ${s.branchCode}` : ""}</div><div>ที่อยู่ {s.address ?? ""}</div>
        </div>
        <div className="mt-1 border border-black p-2">ลำดับที่ ____ ในแบบ　{box(false, "ภ.ง.ด.1ก")}{box(false, "ภ.ง.ด.1ก พิเศษ")}{box(false, "ภ.ง.ด.2")}{box(pnd === "3", "ภ.ง.ด.3")}{box(false, "ภ.ง.ด.2ก")}{box(false, "ภ.ง.ด.3ก")}{box(pnd === "53", "ภ.ง.ด.53")}</div>
        <table className="mt-1 w-full border-collapse border border-black">
          <thead><tr className="text-center"><th className="border border-black px-1 py-1 font-semibold">ประเภทเงินได้พึงประเมินที่จ่าย</th><th className="w-24 border border-black px-1 font-semibold">วัน เดือน ปี ที่จ่าย</th><th className="w-28 border border-black px-1 font-semibold">จำนวนเงินที่จ่าย</th><th className="w-28 border border-black px-1 font-semibold">ภาษีที่หักและนำส่งไว้</th></tr></thead>
          <tbody>
            {kinds.map(([label, on]) => <tr key={label}><td className="whitespace-pre-wrap border-x border-black px-1.5 py-0.5">{label}{on && rate > 0 ? `　(${(rate * 100).toFixed((rate * 100) % 1 ? 2 : 0)}%)` : ""}</td><td className="border-x border-black px-1 text-center">{on ? thDate : ""}</td><td className="border-x border-black px-1.5 text-right font-mono">{on ? m(base) : ""}</td><td className="border-x border-black px-1.5 text-right font-mono">{on ? m(wht) : ""}</td></tr>)}
            <tr className="font-semibold"><td colSpan={2} className="border border-black px-1.5 py-1 text-right">รวมเงินที่จ่ายและภาษีที่หักนำส่ง</td><td className="border border-black px-1.5 text-right font-mono">{m(base)}</td><td className="border border-black px-1.5 text-right font-mono">{m(wht)}</td></tr>
            <tr><td colSpan={4} className="border border-black px-1.5 py-1">รวมเงินภาษีที่หักนำส่ง (ตัวอักษร)　<b>{thaiAmount(wht, "THB")}</b></td></tr>
          </tbody>
        </table>
        <div className="mt-1 border border-black p-2">ผู้จ่ายเงิน　{box(true, "(1) หัก ณ ที่จ่าย")}{box(false, "(2) ออกให้ตลอดไป")}{box(false, "(3) ออกให้ครั้งเดียว")}{box(false, "(4) อื่น ๆ")}</div>
        <div className="mt-1 grid grid-cols-[1fr_1.3fr] border border-black">
          <div className="border-r border-black p-2 text-[11px]"><b>คำเตือน</b> ผู้มีหน้าที่ออกหนังสือรับรองการหักภาษี ณ ที่จ่าย ฝ่าฝืนไม่ปฏิบัติตามมาตรา 50 ทวิ แห่งประมวลรัษฎากร ต้องรับโทษทางอาญาตามมาตรา 35 แห่งประมวลรัษฎากร</div>
          <div className="p-2 text-center">ขอรับรองว่าข้อความและตัวเลขดังกล่าวข้างต้นถูกต้องตรงกับความจริงทุกประการ<div className="mt-8">ลงชื่อ ................................................ ผู้จ่ายเงิน</div><div className="mt-1">{thDate}　(วัน เดือน ปี ที่ออกหนังสือรับรอง)</div></div>
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-black/70"><span>{u("whtRefs")}: {p.no} · {inv.invoiceNo}</span><span>DCiT OS · {p.whtCertNo}</span></div>
      </div>
    </div>
  );
}
