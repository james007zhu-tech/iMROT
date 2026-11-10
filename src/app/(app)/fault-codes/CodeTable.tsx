import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Table, Tag, btnGhost, inputCls } from "@/components/ui";
import { SelectAll } from "@/components/SelectAll";
import { bulkReviewAction } from "./actions";

type Row = { id: string; code: string; title: string; kind: string; mustStop: string; status: string; isPublic: boolean; appliesTo: string | null; updatedAt: Date; series: { name: string; brand: { name: string } }; reviewedBy: { name: string } | null; published: { publishedAt: Date } | null };

export const STATUS_TONE: Record<string, string> = { DRAFT: "bg-navy/5 text-navy/70", REVIEW: "bg-alert/15 text-alert-ink", APPROVED: "bg-tint text-navy", RETIRED: "bg-navy/5 text-navy/40 line-through" };

/** A list of codes with checkboxes and the bulk review buttons (approve / make public … for MD and managers). */
export async function CodeTable({ rows, back, showSeries, canReview }: { rows: Row[]; back: string; showSeries: boolean; canReview: boolean }) {
  const u = await getTranslations("ui");
  const action = bulkReviewAction.bind(null, back, "");
  const op = (o: string) => bulkReviewAction.bind(null, back, o);
  return (
    <form action={action} className="space-y-2">
      <Table head={["", u("kbCode"), u("kbTitle"), u("kbKind"), ...(showSeries ? [u("kbSeries")] : []), u("kbStatus"), u("kbPublic"), u("kbUpdated")]}>
        {rows.map((c) => (
          <tr key={c.id}>
            <td><input type="checkbox" name="id" value={c.id} aria-label={c.code} /></td>
            <td className="font-mono font-semibold text-fault"><Link href={`/fault-codes/${c.id}`} className="hover:underline">{c.code}</Link></td>
            <td><Link href={`/fault-codes/${c.id}`} className="hover:underline">{c.title}</Link></td>
            <td>{u(`kbKind_${c.kind}`)}</td>
            {showSeries && <td>{c.series.brand.name} {c.series.name}</td>}
            <td><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[c.status]}`}>{u(`kbStatus_${c.status}`)}</span></td>
            <td>{c.isPublic && c.status === "APPROVED" ? <Tag>{c.published ? u("kbPublished") : u("kbPublicPending")}</Tag> : <span className="text-xs text-navy/50">{u("kbInternal")}</span>}</td>
            <td className="text-xs text-navy/70">{c.updatedAt.toISOString().slice(0, 10)}{c.reviewedBy ? ` · ${c.reviewedBy.name}` : ""}</td>
          </tr>
        ))}
        {rows.length === 0 && <tr><td colSpan={showSeries ? 8 : 7} className="py-6 text-center text-navy/60">{u("kbNoCodes")}</td></tr>}
      </Table>
      {canReview && rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-navy/15 bg-white p-2 text-sm">
          <SelectAll label={u("kbSelectAll")} />
          <span className="text-navy/70">{u("kbSelected")}</span>
          <button formAction={op("approve")} className={btnGhost}>{u("kbApprove")}</button>
          <button formAction={op("public")} className={btnGhost}>{u("kbMakePublic")}</button>
          <button formAction={op("internal")} className={btnGhost}>{u("kbMakeInternal")}</button>
          <input name="note" placeholder={u("kbRejectNote")} className={`${inputCls} max-w-56`} />
          <button formAction={op("reject")} className={btnGhost}>{u("kbReject")}</button>
          <button formAction={op("retire")} className={btnGhost}>{u("kbRetire")}</button>
        </div>
      )}
    </form>
  );
}
