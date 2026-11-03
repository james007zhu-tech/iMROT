import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui";

/** Shown instead of a page the current role may not open (no hint of what is behind it). */
export async function Forbidden() {
  const t = await getTranslations("ui");
  return <div className="max-w-xl"><Alert>{t("forbidden")}</Alert></div>;
}
