/**
 * Rated power as the nameplate gives it. A double-axis module reads "2x4.0 kW": two axes of 4 kW each — it is
 * recorded as 2×4 kW (朱总 2026-11-15), neither 24 nor 4 nor 8.
 */
export function parsePower(text: string | null | undefined): { kw?: number; axes?: number } {
  const s = (text ?? "").trim().replace(/,/g, ".").replace(/\s*kw\s*$/i, "");
  if (!s) return {};
  const m = s.match(/^(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)$/i);
  if (m && Number(m[1]) >= 2 && Number(m[1]) <= 12) return { kw: Number(m[2]), axes: Number(m[1]) };
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? { kw: n } : {};
}
export function powerLabel(kw: number | string | null | undefined, axes?: number | null): string {
  if (kw == null || kw === "") return "—";
  const n = Number(kw);
  return `${axes && axes > 1 ? `${axes}×` : ""}${Number.isFinite(n) ? String(n) : kw} kW`;
}
