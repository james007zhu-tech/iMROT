import { getTranslations } from "next-intl/server";

/** Marks a row that comes from the old system (简道云): read-only, under its old number. */
export async function OldTag() {
  const l = await getTranslations("legacy");
  return <span className="ml-1.5 whitespace-nowrap rounded bg-navy/8 px-1.5 py-0.5 font-sans text-[11px] text-navy/70">{l("oldTag")}</span>;
}
