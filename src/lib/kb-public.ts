/**
 * Labels of the public fault-code pages (/faults). Visitors are not signed in and carry no locale cookie, so the
 * language comes from ?lang= or the browser; the words themselves live in messages/*.json under "kbPublic".
 */
import th from "../../messages/th.json";
import zh from "../../messages/zh.json";
import en from "../../messages/en.json";
import company from "../../docs/brand/company_master.json";

export const PUBLIC_LANGS = ["th", "zh", "en"] as const;
export type PublicLang = (typeof PUBLIC_LANGS)[number];
const ALL = { th, zh, en } as unknown as Record<PublicLang, { kbPublic: Record<string, string> }>;

export function publicLang(asked: string | undefined, acceptLanguage: string | null): PublicLang {
  if (asked && (PUBLIC_LANGS as readonly string[]).includes(asked)) return asked as PublicLang;
  const a = (acceptLanguage ?? "").toLowerCase();
  return a.startsWith("th") ? "th" : a.startsWith("zh") ? "zh" : a.includes("th") ? "th" : "en";
}

export function publicT(lang: PublicLang) {
  const m = ALL[lang].kbPublic ?? {};
  return (key: string, vars: Record<string, string | number> = {}) => (m[key] ?? ALL.en.kbPublic[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export const CONTACT = { phone: company.phone.split("/")[0].trim(), phoneHref: `tel:${company.phone.split("/")[0].replace(/[^+\d]/g, "").replace("+660", "+66")}`, email: company.email, website: company.website, name: company.name_en };
