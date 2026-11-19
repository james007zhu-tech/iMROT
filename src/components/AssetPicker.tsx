"use client";
/**
 * Pick the machine(s) a service order is about. Customer and plant follow from the first asset.
 * When the upload box recognises a serial number or a location, the matching asset is selected.
 * 2026-11-19 (real data, 14,839 machines): the form carries the customer list only; a customer's machines are fetched
 * when it is chosen (/api/assets/pick), at most 300 at a time — the last digits of a serial number find the rest.
 */
import { useEffect, useRef, useState } from "react";
import type { PickAsset } from "@/lib/asset-pick-row";

export type PickCustomer = { id: string; name: string; n: number };

export function AssetPicker({ formId, customers, initial, labels }: { formId: string; customers: PickCustomer[]; initial?: PickAsset | null; labels: { asset: string; customer: string; plant: string; add: string; pickCustomer?: string; allCustomers?: string; find?: string; more?: string; loading?: string } }) {
  const [codes, setCodes] = useState<string[]>(initial ? [initial.code] : [""]);
  const [cust, setCust] = useState(initial?.customerId ?? (customers.length === 1 ? customers[0].id : ""));
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<PickAsset[]>(initial ? [initial] : []);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const known = useRef(new Map<string, PickAsset>(initial ? [[initial.code, initial]] : []));
  const first = codes[0] ? known.current.get(codes[0]) : undefined;

  // fetch the chosen customer's machines (or, without a customer, what a search of 3+ characters finds)
  useEffect(() => {
    if (!cust && q.trim().length < 3) { setRows([]); setTotal(0); return; }
    const ctl = new AbortController(); setBusy(true);
    const t = setTimeout(() => {
      fetch(`/api/assets/pick?customer=${encodeURIComponent(cust)}&q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal }).then((r) => r.json()).then((j: { total: number; rows: PickAsset[] }) => {
        for (const a of j.rows) known.current.set(a.code, a);
        setRows(j.rows); setTotal(j.total); setBusy(false);
        if (j.rows.length === 1 && (q.trim() || j.total === 1)) setCodes((c) => (c[0] === j.rows[0].code ? c : [j.rows[0].code, ...c.slice(1)]));
      }).catch(() => setBusy(false));
    }, q ? 250 : 0);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [cust, q]);
  useEffect(() => { if (first && first.customerId && first.customerId !== cust) setCust(first.customerId); }, [first, cust]);
  const chooseCustomer = (c: string) => { setCust(c); setQ(""); setCodes([""]); };
  const grouped = (list: PickAsset[]) => { const m = new Map<string, PickAsset[]>(); for (const a of list) m.set(a.plant || "—", [...(m.get(a.plant || "—") ?? []), a]); return [...m]; };

  // the upload box writes a serial number or a location: find that machine
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const serial = form.elements.namedItem("serialNumber") as HTMLInputElement | null;
    const loc = form.elements.namedItem("location") as HTMLInputElement | null;
    const on = () => { const v = serial?.value.trim() || loc?.value.trim(); if (v) setQ(v); };
    serial?.addEventListener("change", on); loc?.addEventListener("change", on);
    return () => { serial?.removeEventListener("change", on); loc?.removeEventListener("change", on); };
  }, [formId]);

  const box = "w-full rounded-md border px-2.5 py-2 text-sm";
  const opt = (a: PickAsset) => <option key={a.code} value={a.code}>{cust ? `${a.code} · ${a.model || "—"} · ${a.location || "—"} · S/N ${a.serial}` : a.label}</option>;
  return (
    <div className="space-y-2">
      {labels.pickCustomer && <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.pickCustomer}</span>
          <select name="pickCustomer" value={cust} onChange={(e) => chooseCustomer(e.target.value)} className={box}><option value="">{labels.allCustomers ?? "—"}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.n})</option>)}</select></label>
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.find}</span><input value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" className={box} /></label>
        <p className="self-end pb-2 text-xs text-navy/60">{busy ? labels.loading ?? "…" : total > rows.length ? (labels.more ?? "{shown} / {total}").replace("{shown}", String(rows.length)).replace("{total}", String(total)) : ""}</p>
      </div>}
      {codes.map((c, i) => {
        const list = i === 0 ? rows : rows.filter((a) => !first || a.customerId === first.customerId);
        const chosen = c ? known.current.get(c) : undefined;
        return (
        <div key={i} className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.asset}{i === 0 && <span className="text-alert"> *</span>}</span>
            <select name="assetCodes" required={i === 0} value={c} onChange={(e) => setCodes(codes.map((x, j) => (j === i ? e.target.value : x)))} className={box}>
              <option value="">—</option>
              {chosen && !list.some((a) => a.code === c) && <option value={c}>{chosen.label}</option>}
              {cust ? grouped(list).map(([plant, l]) => <optgroup key={plant} label={plant}>{l.map(opt)}</optgroup>) : list.map(opt)}
            </select>
          </label>
          {i === 0 ? <>
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.customer}</span><div className={`${box} min-h-10 bg-white`}>{first?.customer ?? "—"}</div></label>
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.plant}</span><div className={`${box} min-h-10 bg-white`}>{first?.plant ?? "—"}</div></label>
          </> : <span className="hidden md:block" />}
        </div>
      ); })}
      <input type="hidden" name="serialNumber" /><input type="hidden" name="location" />
      <button type="button" onClick={() => setCodes([...codes, ""])} className="min-h-10 rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold">＋ {labels.add}</button>
    </div>
  );
}
