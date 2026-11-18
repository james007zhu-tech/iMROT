import { getTranslations } from "next-intl/server";
import { docRateAction, docRateDecideAction } from "@/app/actions/fx-doc";
import { bocFor, FX_MD_THRESHOLD, type FxPending } from "@/server/fx";
import { FxInput } from "@/components/FxInput";

/**
 * The rate of one document (派修单 v4 B): a yellow line when it was set by hand — the rate, the Bank of China rate, who,
 * when, why — and, for finance, the pencil that opens the form: new rate, reason (bank's actual rate / agreed in the
 * contract / other, with a note).
 */
export async function FxDoc({ kind, no, back, canEdit, note, current, currency, pending, isMd }: { kind: "order" | "po"; no: string; back: string; canEdit: boolean; current: number | null; currency: string; pending?: FxPending | null; isMd?: boolean; note: { rate: number; boc: number | null; before: number | null; by: string; why: string } | null }) {
  const u = await getTranslations("ui");
  if (currency === "CNY" || (!note && !canEdit && !pending)) return null;
  const boc = await bocFor(currency);
  return (
    <div className="space-y-1">
      {note && <div className="rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-3 py-2 text-[13px] text-[#7A4A00]" role="status"><b>{u("fxDocBanner", { rate: note.rate.toFixed(4), boc: note.boc != null ? note.boc.toFixed(4) : "—" })}</b> · {note.by}{note.before != null ? ` · ${u("fxDocWas", { was: note.before.toFixed(4) })}` : ""}{note.why ? ` · ${u("fxWhy")}：${note.why}` : ""}</div>}
      {pending && <div className="rounded-lg border border-[#C0392B] bg-[#FDECEC] px-3 py-2 text-[13px] text-[#7A1F14]" role="status"><b>{u("fxPendingBanner", { rate: pending.rate, boc: pending.boc, date: pending.bocDate, diff: pending.diffPct.toFixed(2) })}</b> · {pending.by} · {u("fxWhy")}：{pending.reason}
        {isMd && <form action={docRateDecideAction.bind(null, no, back)} className="mt-1 flex flex-wrap items-center gap-2"><button name="decision" value="yes" className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">{u("poApprove")}</button><input name="note" placeholder={u("poDecideNotePh")} className="rounded-md border px-2 py-1 text-sm" /><button name="decision" value="no" className="rounded-md border border-navy/40 bg-white px-3 py-1.5 text-sm">{u("poRefuse")}</button></form>}</div>}
      {canEdit && <details className="text-[13px]"><summary className="inline-flex cursor-pointer items-center gap-1 text-blue hover:underline"><svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>{u("fxDocEdit")}{current != null ? ` (@${current.toFixed(4)})` : ""}</summary>
        <form action={docRateAction.bind(null, kind, no, back)} className="mt-1 flex flex-wrap items-end gap-2 rounded-lg border bg-white p-2">
          <FxInput name="rate" reasonName="why" boc={boc} start={current} threshold={kind === "order" ? FX_MD_THRESHOLD : Infinity} cls="rounded-md border px-2 py-1 text-sm" labels={{ rate: u("fxRateIn"), reason: u("fxWhy"), boc: u("fxBocName"), diff: u("fxDiff"), needsMd: u("fxNeedsMd"), edit: u("fxEditRate"), noBoc: u("fxNoBoc") }} reasons={(["bank", "contract", "other"] as const).map((k) => ({ value: k, label: u(`fxWhy_${k}`) }))} />
          {(["bank", "contract", "other"] as const).map((k) => <input key={k} type="hidden" name={`whyLabel_${k}`} value={u(`fxWhy_${k}`)} />)}
          <label className="min-w-0 flex-1 text-xs text-navy/70">{u("fxDocMore")}<input name="more" className="mt-0.5 block w-full rounded-md border px-2 py-1 text-sm" /></label>
          <button className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">{kind === "order" ? u("fxSaveOrAsk") : u("fxOverrideBtn")}</button>
        </form></details>}
    </div>
  );
}
