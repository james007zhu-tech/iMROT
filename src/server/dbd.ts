/**
 * DBD (กรมพัฒนาธุรกิจการค้า) lookup by 13-digit tax ID → company name, registered address, phone, capital, status.
 * Uses the DBD open-data API (configurable with DBD_API_URL). The response shape is read defensively because
 * it is not ours; whatever cannot be found stays empty and the person fills it in.
 * NOTE: not verified against the live service from the build environment (no network there).
 */
export interface DbdCompany { nameTh?: string; nameEn?: string; addressTh?: string; addressEn?: string; phone?: string; registeredCapital?: number; foundedAt?: string; status?: string; raw: unknown }

const BASE = process.env.DBD_API_URL ?? "https://openapi.dbd.go.th/api/v1/juristic_person";

export function isThaiTaxId(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const d = id.split("").map(Number);
  const sum = d.slice(0, 12).reduce((s, x, i) => s + x * (13 - i), 0);
  return (11 - (sum % 11)) % 10 === d[12];
}

export async function lookupDbd(taxId: string): Promise<DbdCompany | null> {
  if (!/^\d{13}$/.test(taxId)) throw new Error("tax ID must be 13 digits");
  const res = await fetch(`${BASE}/${taxId}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DBD ${res.status}`);
  return parseDbd(await res.json());
}

/** Walk the JSON and pick values by key name, whatever the nesting. Exported for tests. */
export function parseDbd(raw: unknown): DbdCompany {
  const flat: [string, unknown][] = [];
  const walk = (v: unknown, path: string) => {
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, `${path}/${k}`);
    else flat.push([path, v]);
  };
  walk(raw, "");
  const pick = (re: RegExp, not?: RegExp) => flat.find(([k, v]) => re.test(k) && !(not && not.test(k)) && v != null && String(v).trim() !== "")?.[1];
  const str = (v: unknown) => (v == null ? undefined : String(v).trim());
  const addrParts = (lang: RegExp) => flat.filter(([k, v]) => /address/i.test(k) && !/(type|code)$/i.test(k.split("/").pop() ?? "") && lang.test(k) && v != null && String(v).trim()).map(([, v]) => String(v).trim());
  const addressTh = addrParts(/./).filter((s) => /[฀-๿]/.test(s)).join(" ") || undefined;
  const capital = Number(String(pick(/capital/i) ?? "").replace(/[^\d.]/g, ""));
  return {
    nameTh: str(pick(/name.?th/i)),
    nameEn: str(pick(/name.?en/i)),
    addressTh,
    addressEn: addrParts(/./).filter((s) => /^[\x20-\x7E]+$/.test(s) && /[A-Za-z]/.test(s)).join(" ") || undefined,
    phone: str(pick(/phone|tel/i)),
    registeredCapital: Number.isFinite(capital) && capital > 0 ? capital : undefined,
    foundedAt: str(pick(/register.?date|registration.?date/i)),
    status: str(pick(/status/i)),
    raw,
  };
}

/** Closed companies must not be saved as customers. */
export function isClosedStatus(status?: string): boolean {
  return !!status && /เลิก|ร้าง|ล้มละลาย|closed|dissolved|deregistered|bankrupt/i.test(status);
}
