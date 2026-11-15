/**
 * 一个税号查全公司信息 (朱总 2026-11-14: "应该通过一个税号就能找到所有信息，这是我的基本要求").
 * Two sources, in this order:
 *   1. DBD, the registry: Thai and English name, registered address in Thai, status, capital, founding date.
 *   2. The public web through the assistant's search, for what the registry does not publish — the address in English,
 *      the switchboard number, the website — and for everything when the registry does not answer.
 * The registry wins wherever both speak. Every value says where it came from, and the pages read are kept.
 */
import { prisma } from "@/lib/db";
import { callClaude } from "@/server/ai";
import { isThaiTaxId, lookupDbd, type DbdCompany } from "@/server/dbd";

export type CompanyFacts = {
  nameTh?: string; nameEn?: string; addressTh?: string; addressEn?: string; phone?: string; website?: string;
  registeredCapital?: number; foundedAt?: string; status?: string;
  from: Record<string, "DBD" | "WEB">; sources: string[]; dbdRaw?: unknown; dbdAnswered: boolean; webAnswered: boolean;
};
const FIELDS = ["nameTh", "nameEn", "addressTh", "addressEn", "phone", "website"] as const;
export const WEB_SEARCH_TOOL = { type: "web_search_20250305", name: "web_search" } as const;

/** What the public web says about a Thai company, by tax ID. Null when there is no key or no usable answer. */
export async function lookupCompanyWeb(taxId: string, known: Partial<Record<(typeof FIELDS)[number], string>> = {}): Promise<{ values: Partial<Record<(typeof FIELDS)[number], string>>; sources: string[] } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const have = Object.entries(known).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join("\n");
  const res = await callClaude({
    max_tokens: 2000,
    tools: [{ ...WEB_SEARCH_TOOL, max_uses: 5 }],
    system: "You look up Thai companies for a business system. Use web search. Prefer registry-derived pages (DBD datawarehouse, Creden, Dataforthai) and the company's own website. Report only what a page states; leave a field out when you did not find it; never guess or compose an address. The English address is the company's own English wording when published, otherwise a faithful transliteration of the registered Thai address in the usual Thai style (No., Moo, Soi, Road, Sub-district, District, Province, postcode). End with one JSON object and nothing after it.",
    messages: [{ role: "user", content: `Thai juristic person, tax ID ${taxId}.${have ? `\nAlready known from the registry:\n${have}` : ""}\nFind: nameTh (registered Thai name), nameEn (registered English name), addressTh (registered head-office address in Thai), addressEn (the same address in English), phone (head office), website.\nAnswer with JSON: {"nameTh":…,"nameEn":…,"addressTh":…,"addressEn":…,"phone":…,"website":…,"sources":[urls you relied on]}` }],
  });
  if (!res.ok) { console.warn(`[company-lookup] web search failed: ${res.status} ${(await res.text()).slice(0, 200)}`); return null; }
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Record<string, unknown>;
  try { j = JSON.parse(m[0]); } catch { return null; }
  const values: Partial<Record<(typeof FIELDS)[number], string>> = {};
  for (const k of FIELDS) { const v = j[k]; if (typeof v === "string" && v.trim() && !/^(unknown|n\/?a|not found|-|—)$/i.test(v.trim())) values[k] = v.trim(); }
  return { values, sources: Array.isArray(j.sources) ? j.sources.filter((s): s is string => typeof s === "string" && /^https?:\/\//.test(s)).slice(0, 8) : [] };
}

export async function lookupCompany(taxId: string, opts: { web?: boolean } = {}): Promise<CompanyFacts> {
  if (!isThaiTaxId(taxId)) throw new Error("TAX_ID_INVALID");
  let dbd: DbdCompany | null = null, dbdAnswered = false;
  try { dbd = await lookupDbd(taxId); dbdAnswered = true; } catch (e) { console.warn(`[company-lookup] DBD: ${(e as Error).message}`); }
  const out: CompanyFacts = { from: {}, sources: [], dbdRaw: dbd?.raw, dbdAnswered, webAnswered: false, registeredCapital: dbd?.registeredCapital, foundedAt: dbd?.foundedAt, status: dbd?.status };
  for (const k of ["nameTh", "nameEn", "addressTh", "addressEn", "phone"] as const) if (dbd?.[k]) { out[k] = dbd[k]; out.from[k] = "DBD"; }
  // a tax ID the registry answers "no such company" for is not searched further
  if (opts.web !== false && !(dbdAnswered && !dbd) && FIELDS.some((k) => !out[k])) {
    const web = await lookupCompanyWeb(taxId, { nameTh: out.nameTh, nameEn: out.nameEn, addressTh: out.addressTh }).catch((e) => { console.warn(`[company-lookup] web: ${(e as Error).message}`); return null; });
    if (web) {
      out.webAnswered = true; out.sources = web.sources;
      for (const k of FIELDS) if (!out[k] && web.values[k]) { out[k] = web.values[k]; out.from[k] = "WEB"; }
    }
  }
  return out;
}

/**
 * Fill what a customer's file is missing from its tax ID. Never overwrites what a person or the registry already put
 * there; the billing address starts as the registered one (a Thai tax invoice carries the registered address).
 */
export async function completeCustomer(customerCode: string, actorId?: string) {
  const c = await prisma.customer.findUniqueOrThrow({ where: { code: customerCode } });
  if (!c.taxId || !isThaiTaxId(c.taxId)) throw new Error(`TAX_ID_INVALID:${c.taxId ?? ""}`);
  const f = await lookupCompany(c.taxId);
  const data: Record<string, unknown> = {};
  const filled: string[] = [];
  const put = (field: "nameLocal" | "addressLocal" | "addressEn" | "phone" | "billingAddress", v?: string) => { if (v && !(c[field] ?? "").trim()) { data[field] = v; filled.push(field); } };
  put("nameLocal", f.nameTh); put("addressLocal", f.addressTh); put("addressEn", f.addressEn); put("phone", f.phone);
  put("billingAddress", c.addressLocal?.trim() || f.addressTh);
  if (f.registeredCapital && c.registeredCapital == null) data.registeredCapital = f.registeredCapital;
  if (f.foundedAt && !c.foundedAt && !Number.isNaN(Date.parse(f.foundedAt))) data.foundedAt = new Date(f.foundedAt);
  if (f.status && f.dbdAnswered) { data.dbdStatus = f.status; data.dbdFetchedAt = new Date(); if (f.dbdRaw) data.dbdData = f.dbdRaw as object; }
  if (Object.keys(data).length) await prisma.customer.update({ where: { id: c.id }, data });
  if (actorId) await prisma.auditLog.create({ data: { actorId, action: "CUSTOMER_COMPLETE", target: c.code, detail: { filled, from: f.from, sources: f.sources, dbd: f.dbdAnswered, web: f.webAnswered } } });
  return { filled, facts: f };
}
