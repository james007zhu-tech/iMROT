"use client";
/**
 * Brand → series → model as three fields (wireframe 2). Typing a known model code fills brand and series;
 * picking a brand narrows the series list, picking a series narrows the models. The server resolves `modelCode`.
 */
import { useEffect, useRef, useState } from "react";

type M = { brand: string; series: string; code: string };

export function ModelPicker({ models, labels, inputCls, defaults = {} }: {
  models: M[]; labels: { brand: string; series: string; model: string; unknown: string }; inputCls: string; defaults?: Partial<M>;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [brand, setBrand] = useState(defaults.brand ?? "");
  const [series, setSeries] = useState(defaults.series ?? "");
  const [code, setCode] = useState(defaults.code ?? "");
  const el = (n: string) => box.current?.querySelector<HTMLInputElement>(`input[name=${n}]`) ?? null;
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

  // Values written straight into the DOM (restored draft) are read back.
  useEffect(() => {
    const on = () => { setBrand(el("brand")?.value ?? ""); setSeries(el("series")?.value ?? ""); setCode(el("modelCode")?.value ?? ""); };
    window.addEventListener("draft-restored", on);
    return () => window.removeEventListener("draft-restored", on);
  }, []);

  const onCode = (v: string) => {
    setCode(v);
    const m = models.find((x) => same(x.code, v));
    if (m) {
      const b = el("brand"), s = el("series");
      if (b) b.value = m.brand;
      if (s) s.value = m.series;
      setBrand(m.brand); setSeries(m.series);
    }
  };
  const brands = [...new Set(models.map((m) => m.brand))];
  const seriesList = [...new Set(models.filter((m) => !brand || same(m.brand, brand)).map((m) => m.series))];
  const codes = models.filter((m) => (!brand || same(m.brand, brand)) && (!series || same(m.series, series)));
  const known = !code.trim() || models.some((m) => same(m.code, code));
  return (
    <div ref={box} className="contents">
      <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.brand}<span className="text-alert"> *</span></span>
        <input name="brand" list="mp-brands" required defaultValue={defaults.brand} onInput={(e) => setBrand(e.currentTarget.value)} className={inputCls} placeholder="SIEMENS" />
        <datalist id="mp-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.series}<span className="text-alert"> *</span></span>
        <input name="series" list="mp-series" required defaultValue={defaults.series} onInput={(e) => setSeries(e.currentTarget.value)} className={inputCls} placeholder="SINAMICS S120" />
        <datalist id="mp-series">{seriesList.map((s) => <option key={s} value={s} />)}</datalist>
      </label>
      <label className="flex flex-col gap-1 text-[13px]"><span className="text-navy/80">{labels.model}<span className="text-alert"> *</span></span>
        <input name="modelCode" list="mp-models" required defaultValue={defaults.code} onInput={(e) => onCode(e.currentTarget.value)} className={`${inputCls} font-mono`} placeholder="6SL3120-2TE41-0AA1" />
        <datalist id="mp-models">{codes.map((m) => <option key={m.code} value={m.code}>{m.brand} {m.series}</option>)}</datalist>
        {!known && <span className="text-xs text-alert-ink">{labels.unknown}</span>}
      </label>
    </div>
  );
}
