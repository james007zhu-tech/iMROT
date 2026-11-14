import { localIso } from "@/lib/dates";
import { getLocale, getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { trainingFor } from "@/server/training";
import { dictMap } from "@/server/dict";
import { Flash } from "@/components/Flash";
import { Card, PageHeader, Tag, btnGhost } from "@/components/ui";
import { removeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 培训 (the T of iMROT, inside the company): each person's training record and the level they reached. Courses
 * themselves live in iMROT-T; this page keeps who learned what, with what result, and which certificates run out.
 */
export default async function Training({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string; who?: string }> }) {
  const { ok, error, who } = await searchParams;
  const [t, me, locale] = await Promise.all([getTranslations("ops"), currentEmployee(), getLocale()]);
  const [{ rows, staff, all }, kinds] = await Promise.all([trainingFor(me.code), dictMap("trainingKind", locale)]);
  const soon = new Date(Date.now() + 60 * 86_400_000);
  const year = new Date().getFullYear();
  // per person: hours this year, highest level passed, certificates running out
  const board = staff.map((s) => {
    const mine = rows.filter((r) => r.employee.code === s.code);
    const done = mine.filter((r) => r.result === "ATTENDED" || r.result === "PASSED");
    return {
      ...s, count: done.length, hours: done.filter((r) => r.startedOn.getFullYear() === year).reduce((h, r) => h + Number(r.hours ?? 0), 0),
      level: mine.filter((r) => r.result === "PASSED" && r.level).map((r) => r.level!).sort().at(-1) ?? null,
      expiring: mine.filter((r) => r.expiresAt && r.expiresAt < soon).length,
    };
  });
  const shown = who ? rows.filter((r) => r.employee.code === who) : rows;
  return (
    <div className="space-y-4">
      <PageHeader title={t("trTitle")} newHref="/people/training/new" newLabel={t("trNew")} />
      <Flash ok={ok} error={error} />
      <Card title={t("trBoard", { year })}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {board.map((b) => (
            <a key={b.code} href={who === b.code ? "/people/training" : `/people/training?who=${b.code}`} className={`rounded-lg border px-3 py-2 text-sm hover:bg-tint ${who === b.code ? "border-blue ring-1 ring-blue" : ""}`}>
              <div className="flex items-baseline gap-2"><span className="font-semibold text-navy">{b.name}</span><span className="font-mono text-xs text-navy/60">{b.code}</span>{b.level && <span className="ml-auto rounded-full bg-navy px-2 py-0.5 text-xs font-semibold text-white">{b.level}</span>}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-navy/70"><span>{t("trHours", { n: b.hours })}</span><span>{t("trCount", { n: b.count })}</span>{b.expiring > 0 && <span className="font-semibold text-[#9A5B00]">{t("trExpiring", { n: b.expiring })}</span>}{b.count === 0 && <span className="text-[#9A5B00]">{t("trNone")}</span>}</div>
            </a>
          ))}
        </div>
      </Card>
      <ul className="space-y-2">
        {shown.map((r) => {
          const files = (r.attachments as { name: string; url: string }[] | null) ?? [];
          return (
            <li key={r.id} className="rounded-xl border bg-white p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-mono text-navy/70">{localIso(r.startedOn)!.slice(0, 10)}</span>
                <span className="min-w-0 flex-1 font-semibold text-navy">{r.title}</span>
                {r.level && <Tag>{r.level}</Tag>}
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${r.result === "FAILED" ? "bg-alert/10 text-alert-ink" : r.result === "PLANNED" ? "bg-[#FFF4E5] text-[#9A5B00]" : r.result === "PASSED" ? "bg-navy text-white" : "bg-blue/12 text-navy"}`}>{t(`tr_${r.result}`)}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-navy/70">
                {all && <span>{r.employee.code} {r.employee.name}</span>}
                <span>{kinds.get(r.kind) ?? r.kind}</span>
                {r.provider && <span>{r.provider}</span>}
                {r.hours != null && <span>{t("trHours", { n: Number(r.hours) })}</span>}
                {r.score != null && <span>{t("trScore", { n: Number(r.score) })}</span>}
                {r.certificateNo && <span className="font-mono">{r.certificateNo}</span>}
                {r.expiresAt && <span className={r.expiresAt < soon ? "font-semibold text-[#9A5B00]" : ""}>{t("trValidTo", { date: localIso(r.expiresAt)!.slice(0, 10) })}</span>}
                {files.map((a) => <a key={a.url} href={a.url} target="_blank" className="text-blue hover:underline">📄 {a.name}</a>)}
              </div>
              {r.note && <p className="mt-1 text-xs text-navy/80">{r.note}</p>}
              {(me.role === "MD" || r.createdById === me.id) && <form action={removeAction.bind(null, r.id)} className="mt-2"><button className={`${btnGhost} !min-h-8 !px-3 text-xs`}>{t("remove")}</button></form>}
            </li>
          );
        })}
        {shown.length === 0 && <li className="rounded-xl border bg-white p-6 text-center text-sm text-navy/60">{t("trEmpty")}</li>}
      </ul>
    </div>
  );
}
