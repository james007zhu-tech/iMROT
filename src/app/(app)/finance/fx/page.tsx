import { getTranslations } from "next-intl/server";
import { localIso } from "@/lib/dates";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { Flash } from "@/components/Flash";
import { PageHeader, Table, Tag, btnBlue, btnGhost, inputCls } from "@/components/ui";
import { overrideAction, removeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * 记账汇率 (MD 2026-11-17 18:29): 中国银行价, fetched every day. Finance may set the rate of a day by hand — with a
 * reason; it then stands in front of the Bank of China rate of that day, and who, when, why and the rate it replaced are
 * kept. Documents already written keep their rate.
 */
export default async function FxPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  await currentEmployee();
  const [rates, log] = await Promise.all([
    prisma.fxRate.findMany({ orderBy: [{ rateDate: "desc" }, { currency: "asc" }, { source: "desc" }], take: 80 }),
    prisma.auditLog.findMany({ where: { action: { in: ["FX_OVERRIDE", "FX_OVERRIDE_REMOVED", "FX_DOC_OVERRIDE"] } }, orderBy: { at: "desc" }, take: 30, include: { actor: { select: { code: true, name: true } } } }),
  ]);
  const manual = new Set(rates.filter((r) => r.source === "MANUAL").map((r) => `${r.currency}|${r.rateDate.getTime()}`));
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/finance", label: t("nav_fin") }} title={u("fxTitle")} badge={<Tag>{u("fxBoc")}</Tag>} />
      <Flash ok={ok} error={error} />
      <p className="text-sm text-navy/80">{u("fxRule")}</p>
      <form action={overrideAction} className="grid max-w-3xl grid-cols-2 gap-2 rounded-xl border bg-white p-4 sm:grid-cols-4">
        <h2 className="col-span-full font-semibold">{u("fxOverride")}</h2>
        <label className="text-xs">{t("currency")}<input name="currency" required maxLength={3} placeholder="THB" className={`${inputCls} mt-1 w-full uppercase`} /></label>
        <label className="text-xs">{t("date")}<input name="rateDate" type="date" required defaultValue={today} max={today} className={`${inputCls} mt-1 w-full`} /></label>
        <label className="text-xs">{u("fxRateIn")}<input name="rate" type="number" step="0.00000001" min="0.00000001" required className={`${inputCls} mt-1 w-full`} /></label>
        <label className="col-span-2 text-xs sm:col-span-1">{u("fxWhy")}<input name="note" required className={`${inputCls} mt-1 w-full`} /></label>
        <button className={`${btnBlue} col-span-full justify-self-start`}>{u("fxOverrideBtn")}</button>
      </form>
      <div className="rounded-xl border bg-white p-2">
        <Table head={[t("date"), t("currency"), u("fxRateIn"), u("fxSourceCol"), u("fxWhy"), ""]}>
          {rates.map((r) => {
            const hidden = r.source !== "MANUAL" && manual.has(`${r.currency}|${r.rateDate.getTime()}`); // a hand-set rate stands in front of it
            return <tr key={r.id} className={hidden ? "text-navy/40" : ""}>
              <td>{localIso(r.rateDate)!.slice(0, 10)}</td><td className="font-mono">{r.currency}</td><td className="font-mono">{Number(r.rateToCny).toFixed(6)}</td>
              <td>{r.source === "MANUAL" ? <Tag hot>{u("fxManual")}</Tag> : u("fxBoc")}{hidden ? ` · ${u("fxCovered")}` : ""}{r.setBy ? <span className="block text-xs text-navy/60">{r.setBy} · {localIso(r.fetchedAt)!.slice(0, 16).replace("T", " ")}</span> : null}</td>
              <td className="text-xs">{r.note ?? ""}</td>
              <td>{r.source === "MANUAL" && <details><summary className="cursor-pointer text-xs text-blue">{u("fxRemove")}</summary><form action={removeAction} className="mt-1 flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="note" required placeholder={u("fxWhy")} className={`${inputCls} w-40`} /><button className={btnGhost}>{u("fxRemove")}</button></form></details>}</td>
            </tr>;
          })}
          {rates.length === 0 && <tr><td colSpan={6} className="py-4 text-alert-ink">{t("noRates")}</td></tr>}
        </Table>
      </div>
      <div className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-semibold">{u("fxLog")}</h2>
        {log.length === 0 ? <p className="text-sm text-navy/60">{u("fxLogNone")}</p> : <ul className="space-y-1 text-sm">
          {log.map((a) => { const d = (a.detail ?? {}) as { rate?: number; boc?: number | null; bocDate?: string | null; before?: number | null; note?: string };
            return <li key={a.id}>{localIso(a.at)!.slice(0, 16).replace("T", " ")} · {a.actor?.code} {a.actor?.name} · <b>{u(a.action === "FX_OVERRIDE" ? "fxLogSet" : a.action === "FX_DOC_OVERRIDE" ? "fxLogDoc" : "fxLogRemoved")}</b> {a.target} → {d.rate}{a.action !== "FX_OVERRIDE_REMOVED" && d.boc != null ? ` · ${u("fxBoc")} ${d.bocDate} ${d.boc}` : ""}{d.before != null ? ` · ${u("fxLogBefore")} ${d.before}` : ""} · {d.note}</li>; })}
        </ul>}
      </div>
    </div>
  );
}
