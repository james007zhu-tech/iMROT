import { getTranslations } from "next-intl/server";
import { docRateAction } from "@/app/actions/fx-doc";

/**
 * The rate of one document (派修单 v4 B): a yellow line when it was set by hand — the rate, the Bank of China rate, who,
 * when, why — and, for finance, the pencil that opens the form: new rate, reason (bank's actual rate / agreed in the
 * contract / other, with a note).
 */
export async function FxDoc({ kind, no, back, canEdit, note, current, currency }: { kind: "order" | "po"; no: string; back: string; canEdit: boolean; current: number | null; currency: string; note: { rate: number; boc: number | null; before: number | null; by: string; why: string } | null }) {
  const u = await getTranslations("ui");
  if (currency === "CNY" || (!note && !canEdit)) return null;
  return (
    <div className="space-y-1">
      {note && <div className="rounded-lg border border-[#E6A23C] bg-[#FFF4E5] px-3 py-2 text-[13px] text-[#7A4A00]" role="status"><b>{u("fxDocBanner", { rate: note.rate.toFixed(4), boc: note.boc != null ? note.boc.toFixed(4) : "—" })}</b> · {note.by}{note.before != null ? ` · ${u("fxDocWas", { was: note.before.toFixed(4) })}` : ""}{note.why ? ` · ${u("fxWhy")}：${note.why}` : ""}</div>}
      {canEdit && <details className="text-[13px]"><summary className="inline-flex cursor-pointer items-center gap-1 text-blue hover:underline"><svg viewBox="0 0 24 24" aria-hidden className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>{u("fxDocEdit")}{current != null ? ` (@${current.toFixed(4)})` : ""}</summary>
        <form action={docRateAction.bind(null, kind, no, back)} className="mt-1 flex flex-wrap items-end gap-2 rounded-lg border bg-white p-2">
          <label className="text-xs text-navy/70">{u("fxRateIn")}<input name="rate" type="number" step="0.00000001" min="0.00000001" required defaultValue={current ?? ""} className="mt-0.5 block w-32 rounded-md border px-2 py-1 text-sm" /></label>
          <label className="text-xs text-navy/70">{u("fxWhy")}<select name="why" required defaultValue="" className="mt-0.5 block rounded-md border px-2 py-1 text-sm"><option value="" disabled>—</option>{(["bank", "contract", "other"] as const).map((k) => <option key={k} value={k}>{u(`fxWhy_${k}`)}</option>)}</select></label>
          {(["bank", "contract", "other"] as const).map((k) => <input key={k} type="hidden" name={`whyLabel_${k}`} value={u(`fxWhy_${k}`)} />)}
          <label className="min-w-0 flex-1 text-xs text-navy/70">{u("fxDocMore")}<input name="more" className="mt-0.5 block w-full rounded-md border px-2 py-1 text-sm" /></label>
          <button className="rounded-md bg-navy px-3 py-1.5 text-sm font-semibold text-white">{u("fxOverrideBtn")}</button>
        </form></details>}
    </div>
  );
}
