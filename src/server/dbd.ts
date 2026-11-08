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

// The DBD API sits behind a WAF: answers are cached for a day so repeated look-ups of one company do not get us blocked.
const cache = new Map<string, { at: number; value: DbdCompany | null }>();

export async function lookupDbd(taxId: string): Promise<DbdCompany | null> {
  if (!/^\d{13}$/.test(taxId)) throw new Error("tax ID must be 13 digits");
  const hit = cache.get(taxId);
  if (hit && Date.now() - hit.at < 86400000) return hit.value;
  // One request, 12 s: the form says "fill in by hand" quickly instead of hanging (trial 2026-11-05 waited ~24 s).
  const res = await fetch(`${BASE}/${taxId}`, { headers: { accept: "application/json", "user-agent": "DCiT-OS/1.0 (+https://www.ducheng-industrial.com)" }, signal: AbortSignal.timeout(12000) });
  if (res.status === 404) return null;
  if (res.status === 403 || res.status === 429) throw new Error(`DBD blocked the request (${res.status}); try again in a few minutes`);
  if (!res.ok) throw new Error(`DBD ${res.status}`);
  // DBD labels its JSON as text/html; an HTML body is the WAF's challenge page.
  const body = await res.text();
  let json: unknown;
  try { json = JSON.parse(body); } catch { throw new Error("DBD answered with a web page instead of data (rate limit); try again in a few minutes"); }
  const value = parseDbdResponse(json);
  cache.set(taxId, { at: Date.now(), value });
  return value;
}

/**
 * The DBD answer: { status: { code: "1000" | "1004" … }, data: [ { "cd:OrganizationJuristicPerson": { … } } ] }.
 * 1004 / empty data = no such company (the generic walk would otherwise read status.description as the company status).
 * Known namespaced fields are read directly; any other shape falls back to the generic walk.
 */
export function parseDbdResponse(json: unknown): DbdCompany | null {
  const b = json as { status?: { code?: string }; data?: Record<string, unknown>[] } | null;
  if (b && typeof b === "object" && b.status && typeof b.status === "object" && "code" in b.status) {
    if (String(b.status.code) !== "1000" || !Array.isArray(b.data) || b.data.length === 0) return null;
    const p = (b.data[0]["cd:OrganizationJuristicPerson"] ?? b.data[0]) as Record<string, unknown>;
    if ("cd:OrganizationJuristicNameTH" in p || "cd:OrganizationJuristicNameEN" in p) return fromNamespaced(p, json);
  }
  return parseDbd(json);
}

function fromNamespaced(p: Record<string, unknown>, raw: unknown): DbdCompany {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
  const sub = (v: unknown, k: string) => (v && typeof v === "object" ? s((v as Record<string, unknown>)[k]) : undefined);
  const a = ((p["cd:OrganizationJuristicAddress"] as Record<string, unknown> | undefined)?.["cr:AddressType"] ?? {}) as Record<string, unknown>;
  const parts = [s(a["cd:AddressNo"]), s(a["cd:Building"]), s(a["cd:Moo"]) && `หมู่ ${s(a["cd:Moo"])}`, s(a["cd:Soi"]) && `ซอย${s(a["cd:Soi"])}`, s(a["cd:Road"]) && `ถนน${s(a["cd:Road"])}`,
    sub(a["cd:CitySubDivision"], "cr:CitySubDivisionTextTH"), sub(a["cd:City"], "cr:CityTextTH"), sub(a["cd:CountrySubDivision"], "cr:CountrySubDivisionTextTH"), s(a["cd:PostCode"])].filter(Boolean);
  const capital = Number(String(p["cd:OrganizationJuristicRegisterCapital"] ?? "").replace(/[^\d.]/g, ""));
  const reg = s(p["cd:OrganizationJuristicRegisterDate"]);
  return {
    nameTh: s(p["cd:OrganizationJuristicNameTH"]),
    nameEn: s(p["cd:OrganizationJuristicNameEN"]),
    addressTh: s(a["cd:Address"]) ?? (parts.join(" ") || undefined),
    addressEn: undefined,
    phone: undefined, // DBD does not publish phone numbers; the customer's billing info or PP20 has it
    registeredCapital: Number.isFinite(capital) && capital > 0 ? capital : undefined,
    foundedAt: reg && /^\d{8}$/.test(reg) ? `${reg.slice(0, 4)}-${reg.slice(4, 6)}-${reg.slice(6, 8)}` : reg,
    status: s(p["cd:OrganizationJuristicStatus"]),
    raw,
  };
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
