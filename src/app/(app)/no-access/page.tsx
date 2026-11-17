import { getTranslations } from "next-intl/server";

/** 无权限，此功能属于 XX 角色 — what the middleware shows instead of a page this person may not open (no data behind it). */
export default async function NoAccess({ searchParams }: { searchParams: Promise<{ roles?: string }> }) {
  const c = await getTranslations("common");
  const roles = ((await searchParams).roles ?? "MD").replace(/[^A-Za-z /]/g, "").slice(0, 60) || "MD";
  return <div className="rounded-xl border bg-white p-8 text-center text-sm text-navy" data-no-access>{c("noAccess", { roles })}</div>;
}
