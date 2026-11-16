"use client";
/**
 * Pick the machine(s) a service order is about. Customer and plant follow from the first asset.
 * When the upload box recognises a serial number or a location, the matching asset is selected.
 */
import { useEffect, useState } from "react";

export type PickAsset = { code: string; serial: string; location: string; customer: string; plant: string; label: string };

export function AssetPicker({ formId, assets, initial = [], labels }: { formId: string; assets: PickAsset[]; initial?: string[]; labels: { asset: string; customer: string; plant: string; add: string; pickCustomer?: string; allCustomers?: string; find?: string } }) {
  const [codes, setCodes] = useState<string[]>(initial.length ? initial : [""]);
  const first = assets.find((a) => a.code === codes[0]);
  // 需求清单 v3 P1-03: the customer is chosen first, and the list below holds that customer's machines only —
  // grouped by plant, found by the last digits of a serial number, picked for you when there is just one.
  const customers = [...new Set(assets.map((a) => a.customer).filter(Boolean))].sort();
  const [cust, setCust] = useState(assets.find((a) => a.code === initial[0])?.customer ?? (customers.length === 1 ? customers[0] : ""));
  const [q, setQ] = useState("");
  const mine = assets.filter((a) => (!cust || a.customer === cust) && (!q.trim() || `${a.code} ${a.serial} ${a.location}`.toLowerCase().includes(q.trim().toLowerCase())));
  const chooseCustomer = (c: string) => { setCust(c); const own = assets.filter((a) => a.customer === c); setCodes(own.length === 1 ? [own[0].code] : [""]); };
  useEffect(() => { if (q.trim() && mine.length === 1 && codes[0] !== mine[0].code) setCodes((c) => [mine[0].code, ...c.slice(1)]); }, [q, mine, codes]);
  useEffect(() => { if (first && first.customer !== cust) setCust(first.customer); }, [first, cust]);
  const grouped = (list: PickAsset[]) => { const m = new Map<string, PickAsset[]>(); for (const a of list) m.set(a.plant || "—", [...(m.get(a.plant || "—") ?? []), a]); return [...m]; };

  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    const serial = form.elements.namedItem("serialNumber") as HTMLInputElement | null;
    const loc = form.elements.namedItem("location") as HTMLInputElement | null;
    const on = () => {
      const s = serial?.value.trim().toLowerCase();
      const l = loc?.value.trim().toLowerCase();
      const hit = assets.find((a) => (s && a.serial.toLowerCase() === s) || (l && a.location.toLowerCase().includes(l)));
      if (hit) setCodes((c) => [hit.code, ...c.slice(1).filter((x) => x !== hit.code)]);
    };
    serial?.addEventListener("change", on); loc?.addEventListener("change", on);
    return () => { serial?.removeEventListener("change", on); loc?.removeEventListener("change", on); };
  }, [formId, assets]);

  const box = "w-full rounded-md border px-2.5 py-2 text-sm";
  return (
    <div className="space-y-2">
      {labels.pickCustomer && <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.pickCustomer}</span>
          <select name="pickCustomer" value={cust} onChange={(e) => chooseCustomer(e.target.value)} className={box}><option value="">{labels.allCustomers ?? "—"}</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.find}</span><input value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" className={box} /></label>
      </div>}
      {codes.map((c, i) => (
        <div key={i} className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.asset}{i === 0 && <span className="text-alert"> *</span>}</span>
            <select name="assetCodes" required={i === 0} value={c} onChange={(e) => setCodes(codes.map((x, j) => (j === i ? e.target.value : x)))} className={box}>
              <option value="">—</option>
              {i === 0 && c && !mine.some((a) => a.code === c) && first && <option value={c}>{first.label}</option>}
              {cust
                ? grouped((i === 0 ? mine : assets.filter((a) => a.customer === cust))).map(([plant, list]) => <optgroup key={plant} label={plant}>{list.map((a) => <option key={a.code} value={a.code}>{`${a.code} · ${a.location || "—"} · S/N ${a.serial}`}</option>)}</optgroup>)
                : (i === 0 ? mine : assets.filter((a) => !first || a.customer === first.customer)).map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
            </select>
          </label>
          {i === 0 ? <>
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.customer}</span><div className={`${box} min-h-10 bg-white`}>{first?.customer ?? "—"}</div></label>
            <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.plant}</span><div className={`${box} min-h-10 bg-white`}>{first?.plant ?? "—"}</div></label>
          </> : <span className="hidden md:block" />}
        </div>
      ))}
      <input type="hidden" name="serialNumber" /><input type="hidden" name="location" />
      <button type="button" onClick={() => setCodes([...codes, ""])} className="min-h-10 rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold">＋ {labels.add}</button>
    </div>
  );
}
