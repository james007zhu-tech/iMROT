import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { looksLikeSerial } from "@/lib/asset-pick";
import { btnBlue, btnGhost, btnPrimary, inputCls } from "@/components/ui";

/**
 * 设备优先 (朱总 2026-11-11): QTTH, ERTH and INTH all start by naming the machine. Search by ATH, serial number,
 * customer or location; tick one or several; or file a new machine when the search finds none.
 * `to` is the form the chosen ATH numbers are handed to (as ?a=ATH…,ATH… or ?asset=ATH…).
 */
export async function AssetPick({ to, param, multi, q, title, hint }: { to: string; param: "a" | "asset"; multi?: boolean; q?: string; title: string; hint: string }) {
  const u = await getTranslations("ui");
  const like = (v: string) => ({ contains: v, mode: "insensitive" as const });
  const rows = await prisma.asset.findMany({
    where: { status: { not: "RETIRED" }, ...(q ? { OR: [{ code: like(q) }, { serialNumber: like(q) }, { customerAssetNo: like(q) }, { location: like(q) }, { customer: { name: like(q) } }] } : {}) },
    orderBy: { createdAt: "desc" }, take: 30,
    include: { customer: { select: { name: true } }, model: { include: { series: { include: { brand: true } } } }, orderLinks: { where: { serviceOrder: { status: { notIn: ["CLOSED", "CANCELLED"] } } }, select: { serviceOrder: { select: { no: true } } }, take: 1 } },
  });
  const self = to.split("?")[0];
  const newHref = `/assets/new?next=${encodeURIComponent(to)}&param=${param}${q && looksLikeSerial(q) ? `&serial=${encodeURIComponent(q)}` : ""}`;
  return (
    <div className="space-y-3">
      <div className="rounded-xl border bg-white p-4">
        <h2 className="text-[15px] font-bold text-navy">{title}</h2>
        <p className="mt-0.5 text-xs text-navy/70">{hint}</p>
        <form action={self} className="mt-3 flex gap-2">
          <input name="q" defaultValue={q} autoFocus placeholder={u("pickSearchPh")} aria-label={u("pickSearchPh")} className={inputCls} />
          <button className={btnGhost}>{u("pickSearch")}</button>
        </form>
      </div>
      <form action={to.split("?")[0]} className="space-y-2">
        {Array.from(new URLSearchParams(to.split("?")[1] ?? "").entries()).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {rows.map((a) => (
          <label key={a.id} className="flex cursor-pointer items-center gap-3 rounded-xl border bg-white px-3 py-2.5 text-sm hover:bg-tint">
            <input type={multi ? "checkbox" : "radio"} name={param} value={a.code} required={!multi} className="h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2"><b className="font-mono text-navy">{a.code}</b><span className="font-mono text-xs">S/N {a.serialNumber}</span>{!a.serialVerifiedAt && <span className="rounded-full bg-[#FFF4E5] px-2 py-0.5 text-[11px] font-semibold text-[#9A5B00]">{u("serialUnverified")}</span>}{a.orderLinks[0] && <span className="rounded-full bg-blue/12 px-2 py-0.5 font-mono text-[11px] text-navy">{a.orderLinks[0].serviceOrder.no}</span>}</span>
              <span className="block truncate text-xs text-navy/70">{a.model ? `${a.model.series.brand.name} ${a.model.code}` : a.type} · {a.customer?.name ?? "—"}{a.location ? ` · ${a.location}` : ""}</span>
            </span>
          </label>
        ))}
        {rows.length === 0 && <p className="rounded-xl border bg-white p-6 text-center text-sm text-navy/70">{u("pickNone")}</p>}
        <div className="sticky bottom-3 flex flex-wrap justify-end gap-2 pr-20">
          <Link href={newHref} className={rows.length ? btnGhost : btnBlue}>＋ {u("pickNewAsset")}</Link>
          {rows.length > 0 && <button className={`${btnPrimary} shadow-lg`}>{u("pickContinue")}</button>}
        </div>
      </form>
    </div>
  );
}
