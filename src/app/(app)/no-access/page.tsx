import { getTranslations } from "next-intl/server";

export default async function NoAccess() {
  const c = await getTranslations("common");
  return <div className="rounded-xl border bg-white p-8 text-center text-sm text-navy" data-no-access>{c("noAccess", { roles: "MD" })}</div>;
}
