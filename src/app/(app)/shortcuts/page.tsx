import Link from "next/link";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { PageHeader, Card, btnPrimary } from "@/components/ui";
import { NAV, SHORTCUTS, shortcutsOf } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** 常用功能: each person pins the entries they use; the pins show here and under the conversation on the home page. */
export default async function Shortcuts() {
  const me = await currentEmployee();
  const t = await getTranslations("home");
  const s = await getTranslations("shortcut");
  const n = await getTranslations("nav");
  const pins = shortcutsOf(me.shortcuts, me.role);
  const on = new Set(pins.map((p) => p.key));
  async function save(f: FormData) {
    "use server";
    const who = await currentEmployee();
    const keys = SHORTCUTS.map((x) => x.key).filter((k) => f.get(k) === "on");
    await prisma.employee.update({ where: { id: who.id }, data: { shortcuts: keys as Prisma.InputJsonValue } });
    revalidatePath("/shortcuts"); revalidatePath("/home");
  }
  return (
    <div className="space-y-4">
      <PageHeader title={n("shortcuts")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {pins.map((p) => <Link key={p.key} href={p.href} className="flex min-h-20 items-center rounded-xl border border-hair bg-white px-4 text-[15px] font-semibold text-navy hover:border-blue hover:text-blue">{s(p.key)}</Link>)}
        {pins.length === 0 && <p className="col-span-full text-sm text-navy/60">{t("noPins")}</p>}
      </div>
      <Card title={t("choosePins")}>
        <form action={save} className="space-y-3">
          {NAV.filter((g) => SHORTCUTS.some((x) => x.group === g.key)).map((g) => (
            <div key={g.key} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
              <b className="w-24 text-navy/70">{n(g.key)}</b>
              {SHORTCUTS.filter((x) => x.group === g.key).map((x) => <label key={x.key} className="flex items-center gap-1.5"><input type="checkbox" name={x.key} defaultChecked={on.has(x.key)} />{s(x.key)}</label>)}
            </div>
          ))}
          <button className={btnPrimary}>{t("savePins")}</button>
        </form>
      </Card>
    </div>
  );
}
