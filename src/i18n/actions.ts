"use server";
import { cookies } from "next/headers";
import { LOCALES, type Locale } from "./request";

export async function setLocale(locale: Locale) {
  if (!LOCALES.includes(locale)) return;
  (await cookies()).set("locale", locale, { path: "/", maxAge: 60 * 60 * 24 * 365 });
}
