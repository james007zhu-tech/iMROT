import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";

export const LOCALES = ["th", "zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "th";

/** Locale comes from a cookie (set by the switcher in the top-right corner); no URL prefix. */
export default getRequestConfig(async () => {
  const c = (await cookies()).get("locale")?.value as Locale | undefined;
  const locale = c && LOCALES.includes(c) ? c : DEFAULT_LOCALE;
  return { locale, messages: (await import(`../../messages/${locale}.json`)).default };
});
