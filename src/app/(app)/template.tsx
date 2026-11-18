import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { hiddenFor, menuKeyOf, ownersOf } from "@/server/perm";
import { pathAllows, hasRole } from "@/lib/caps";

/**
 * 权限在服务端 (需求清单 v3 第 1 节): a template runs again on every move inside the app, so a page a role may not
 * open is never rendered for it — its data is not fetched and not sent, whether the address was typed or clicked.
 */
export default async function AppTemplate({ children }: { children: React.ReactNode }) {
  const me = await currentEmployee();
  const here = (await headers()).get("x-dcit-path");
  if (!hasRole(me, "MD") && here) {
    const hidden = await hiddenFor(me).catch(() => new Set<string>());
    if (hidden.has(menuKeyOf(here) ?? "") || !pathAllows(me, here)) {
      const c = await getTranslations("common");
      return <div className="rounded-xl border bg-white p-8 text-center text-sm text-navy" data-no-access>{c("noAccess", { roles: ownersOf(here) })}</div>;
    }
  }
  return <>{children}</>;
}
