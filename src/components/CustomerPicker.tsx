"use client";
/**
 * Customer and contact on a new order without a machine (trade, project) — 朱总 2026-11-10:
 *  - the customer is found by typing (fuzzy: any part of the code, the English or the local name, company suffixes
 *    ignored); when the uploaded inquiry names the buyer, the recognised name lands in the same box and the match
 *    is picked automatically; no match → "+ new customer" opens the onboarding form and comes back here;
 *  - the contact is one of that customer's contacts, or a new one typed here (name, phone, e-mail — also filled from
 *    the upload) which is added to the customer when the order is saved.
 * The text box is uncontrolled and listens to the native `input` event, because the upload box writes into the DOM.
 */
import { useEffect, useMemo, useRef, useState } from "react";

export type PickCustomer = { id: string; code: string; name: string; nameLocal: string | null };
export type PickContact = { id: string; customerId: string; label: string };

const SUFFIX = /\b(co\.?,?\s*ltd\.?|company|limited|ltd\.?|inc\.?|corp(oration)?\.?|plc|pcl|pt\.?|sdn\.?\s*bhd\.?|gmbh)\b|บริษัท|จำกัด|มหาชน|有限公司|股份/gi;
export const normName = (s: string) => s.toLowerCase().replace(SUFFIX, " ").replace(/[^\p{L}\p{M}\p{N}]+/gu, " ").trim();

/** Customers whose code or names contain every word typed; exact name first. */
export function matchCustomers(q: string, all: PickCustomer[]): PickCustomer[] {
  const n = normName(q);
  if (!n) return all.slice(0, 8);
  const words = n.split(" ");
  const hay = (c: PickCustomer) => `${c.code.toLowerCase()} ${normName(c.name)} ${normName(c.nameLocal ?? "")}`;
  return all.filter((c) => { const h = hay(c); return words.every((w) => h.includes(w)); })
    .sort((a, b) => Number(normName(b.name) === n || normName(b.nameLocal ?? "") === n) - Number(normName(a.name) === n || normName(a.nameLocal ?? "") === n)).slice(0, 8);
}

export function CustomerPicker({ customers, contacts, initialId, newHref, inputCls, labels }: {
  customers: PickCustomer[]; contacts: PickContact[]; initialId?: string; newHref: string; inputCls: string;
  labels: { customer: string; searchPh: string; contact: string; none: string; newCustomer: string; notFound: string; newContact: string; contactName: string; phone: string; email: string; newContactHint: string; pickFirst: string };
}) {
  const box = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [id, setId] = useState(initialId ?? "");
  const [open, setOpen] = useState(false);
  const chosen = customers.find((c) => c.id === id);
  const found = useMemo(() => matchCustomers(q, customers), [q, customers]);

  useEffect(() => {
    const el = box.current!;
    if (chosen && !el.value) el.value = `${chosen.code} · ${chosen.name}`;
    const onInput = () => {
      const v = el.value; setQ(v);
      const m = matchCustomers(v, customers);
      const n = normName(v);
      const exact = m.filter((c) => normName(c.name) === n || normName(c.nameLocal ?? "") === n || c.code.toLowerCase() === v.trim().toLowerCase());
      // typed or recognised: one exact hit, or a single candidate for a name of some length, is the customer
      const hit = exact.length === 1 ? exact[0] : m.length === 1 && n.length >= 4 ? m[0] : undefined;
      setId(hit?.id ?? "");
      setOpen(!hit);
    };
    el.addEventListener("input", onInput);
    return () => el.removeEventListener("input", onInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

  const pick = (c: PickCustomer) => { setId(c.id); setOpen(false); box.current!.value = `${c.code} · ${c.name}`; box.current!.classList.remove("ai-filled", "ai-uncertain"); };
  const mine = contacts.filter((k) => !id || k.customerId === id);
  const typed = q.trim() && !chosen;
  return (
    <>
      <div className="relative flex flex-col gap-1 text-[13px]">
        <span className="text-navy/80">{labels.customer}<span className="text-alert"> *</span></span>
        <input ref={box} name="customerName" autoComplete="off" placeholder={labels.searchPh} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          className={`${inputCls} ${chosen ? "font-semibold" : ""}`} />
        <input type="hidden" name="customerId" value={id} readOnly />
        {open && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-lg border bg-white p-1 text-sm shadow-lg">
            {found.map((c) => (
              <button type="button" key={c.id} onMouseDown={(e) => { e.preventDefault(); pick(c); }} className={`block w-full rounded px-2 py-1.5 text-left hover:bg-tint ${c.id === id ? "bg-tint font-semibold" : ""}`}>
                <span className="font-mono text-xs text-navy/60">{c.code}</span> {c.name}{c.nameLocal && c.nameLocal !== c.name ? <span className="text-navy/60"> · {c.nameLocal}</span> : null}
              </button>
            ))}
            {!found.length && <p className="px-2 py-1.5 text-xs text-alert-ink">{labels.notFound}</p>}
            <a href={`${newHref}${q.trim() ? `&name=${encodeURIComponent(q.trim())}` : ""}`} className="mt-1 block rounded border-t px-2 py-1.5 font-semibold text-blue hover:bg-tint">＋ {labels.newCustomer}{q.trim() ? `「${q.trim()}」` : ""}</a>
          </div>
        )}
        {typed && !open && <span className="text-xs text-alert-ink">{labels.pickFirst}</span>}
      </div>
      <label className="flex flex-col gap-1 text-[13px]">
        <span className="text-navy/80">{labels.contact}</span>
        <select name="reportedById" key={id} className={inputCls} defaultValue="">
          <option value="">{labels.none}</option>
          {mine.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
      </label>
      <div className="flex flex-col gap-1 text-[13px] md:col-span-2">
        <span className="text-navy/80">{labels.newContact}</span>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          <input name="contactName" placeholder={labels.contactName} className={inputCls} />
          <input name="contactPhone" placeholder={labels.phone} className={inputCls} />
          <input name="contactEmail" type="email" placeholder={labels.email} className={inputCls} />
        </div>
        <span className="text-xs text-navy/60">{labels.newContactHint}</span>
      </div>
    </>
  );
}
