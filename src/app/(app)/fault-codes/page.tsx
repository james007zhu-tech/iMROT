import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { listFaultCodes, publishPending, publishRuns } from "@/server/knowledge";
import { canApprove, canPublish, KINDS, STATUSES } from "@/lib/knowledge";
import { Flash } from "@/components/Flash";
import { Card, PageHeader, Pager, Tag, btnGhost, btnPrimary, filterCls } from "@/components/ui";
import { CodeTable } from "./CodeTable";
import { publishAction } from "./actions";

export const dynamic = "force-dynamic";
const SIZE = 100;

/** 故障代码库 — every series' codes in one list: search, filter, bulk review; the MD publishes from here. */
export default async function FaultCodes({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const me = await currentEmployee();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const page = Math.max(1, Number(sp.page) || 1);
  const [{ rows, total }, series, runs, pending] = await Promise.all([
    listFaultCodes({ seriesId: sp.series, q: sp.q, kind: sp.kind, status: sp.status, pub: sp.pub as never, take: SIZE, skip: (page - 1) * SIZE }),
    prisma.series.findMany({ where: { faultCodes: { some: {} } }, include: { brand: true }, orderBy: { name: "asc" } }),
    publishRuns(),
    publishPending(),
  ]);
  const qs = (o: Record<string, string | number | undefined>) => `/fault-codes?${new URLSearchParams(Object.entries({ ...sp, ok: undefined, error: undefined, ...o }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]))}`;
  const back = qs({});
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/series", label: u("kbSeriesTitle") }} title={u("kbLibrary")} badge={<Tag>{total}</Tag>}
        actions={<><Link href="/fault-codes/import" className={btnGhost}>{u("kbImport")}</Link><Link href="/faults" className={btnGhost} target="_blank">{u("kbPublicSite")}</Link></>}
        newHref="/fault-codes/new" newLabel={u("kbNewCode")} />
      <Flash ok={sp.ok} error={sp.error} />
      <form className="flex flex-wrap gap-2 rounded-xl border bg-white p-3">
        <input name="q" defaultValue={sp.q} placeholder={u("kbSearchPh")} className={`${filterCls} min-w-64 flex-1`} />
        <select name="series" defaultValue={sp.series ?? ""} className={filterCls}><option value="">{u("kbAllSeries")}</option>{series.map((s) => <option key={s.id} value={s.id}>{s.brand.name} {s.name}</option>)}</select>
        <select name="kind" defaultValue={sp.kind ?? ""} className={filterCls}><option value="">{u("kbAllKinds")}</option>{KINDS.map((k) => <option key={k} value={k}>{u(`kbKind_${k}`)}</option>)}</select>
        <select name="status" defaultValue={sp.status ?? ""} className={filterCls}><option value="">{u("kbAllStatus")}</option>{STATUSES.map((k) => <option key={k} value={k}>{u(`kbStatus_${k}`)}</option>)}</select>
        <select name="pub" defaultValue={sp.pub ?? ""} className={filterCls}><option value="">{u("kbPublicAny")}</option><option value="public">{u("kbPublic")}</option><option value="internal">{u("kbInternal")}</option></select>
        <button className={btnPrimary}>{t("search")}</button>
      </form>
      {canPublish(me.role) && (
        <Card title={u("kbPublishTitle")} accent={pending > 0}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>{u("kbPublishPending", { n: pending })}</span>
            <form id="publish" action={publishAction.bind(null, back)}><button className={pending ? btnPrimary : btnGhost}>{u("kbPublish")}</button></form>
            {runs[0] && <span className="text-xs text-navy/60">{u("kbLastPublish", { date: runs[0].createdAt.toLocaleString("sv-SE", { timeZone: "Asia/Bangkok" }).slice(0, 16), name: runs[0].actor.name, added: runs[0].added, updated: runs[0].updated, removed: runs[0].removed })}</span>}
          </div>
        </Card>
      )}
      <div className="rounded-xl border bg-white p-2">
        <CodeTable rows={rows} back={back} showSeries={!sp.series} canReview={canApprove(me.role)} />
      </div>
      <Pager page={page} total={total} size={SIZE} href={(n) => qs({ page: n })} prev={u("prevPage")} next={u("nextPage")} />
    </div>
  );
}
