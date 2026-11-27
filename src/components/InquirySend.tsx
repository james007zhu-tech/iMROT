"use client";
import { useState } from "react";
import { btnBlue, btnGhost, inputCls } from "@/components/ui";

type Sup = { id: string; name: string; email: string | null; contactName: string | null };
type Line = { lineNo: number; part: string; description: string; qty: number; unit: string };

/**
 * PRTH header actions (朱总 2026-11-27): pick a supplier, then download the inquiry addressed to it, or open an e-mail
 * to it. The system has no mail account of its own, so the e-mail opens in the sender's own mail program with the
 * supplier's address, the subject and the item list filled in; the PDF is attached by hand. No customer data goes in.
 */
export function InquirySend({ no, suppliers, lines, neededBy, sender, labels }: {
  no: string; suppliers: Sup[]; lines: Line[]; neededBy: string | null; sender: string;
  labels: { download: string; email: string; supplier: string; any: string; noEmail: string; attachHint: string };
}) {
  const [id, setId] = useState("");
  const sup = suppliers.find((s) => s.id === id);
  const pdf = `/api/documents/${no}/render?format=pdf&template=24${id ? `&supplier=${id}` : ""}`;
  const body = [
    `Dear ${sup?.contactName || sup?.name || "Sir / Madam"},`, "",
    `Please quote the following items (our inquiry ${no}):`, "",
    ...lines.map((l) => `${l.lineNo}. ${l.part ? l.part + " — " : ""}${l.description} × ${l.qty} ${l.unit}`), "",
    "Please state: unit price excluding VAT, VAT rate, lead time, validity, payment terms and brand / origin for each line.",
    ...(neededBy ? [`Quotation needed by: ${neededBy}`] : []),
    `Please reply by e-mail quoting ${no}.`, "",
    "กรุณาเสนอราคาต่อหน่วยไม่รวม VAT อัตรา VAT ระยะเวลาส่งมอบ ระยะเวลายืนราคา และเงื่อนไขการชำระเงิน โดยอ้างอิงเลขที่ " + no, "",
    "Best regards,", sender, "DUCHENG INDUSTRIAL (THAILAND) CO., LTD.",
  ].join("\r\n");
  const mail = `mailto:${sup?.email ? encodeURIComponent(sup.email) : ""}?subject=${encodeURIComponent(`Request for quotation ${no} — DUCHENG INDUSTRIAL (THAILAND)`)}&body=${encodeURIComponent(body)}`;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label={labels.supplier} value={id} onChange={(e) => setId(e.target.value)} className={inputCls} style={{ width: "15rem" }}>
        <option value="">{labels.any}</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <a href={pdf} className={`${btnGhost} whitespace-nowrap`}>{labels.download}</a>
      <a href={mail} className={`${btnBlue} whitespace-nowrap`} title={labels.attachHint}>{labels.email}</a>
      {sup && !sup.email && <span className="w-full text-right text-xs text-[#C0392B]">{labels.noEmail}</span>}
    </div>
  );
}
