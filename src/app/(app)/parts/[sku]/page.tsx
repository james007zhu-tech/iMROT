import { fifoOf } from "@/server/fifo";
import { pathAllows } from "@/lib/caps";
import { can } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { assetsUsingPart, stockByWarehouse } from "@/server/scm";
import { AssetStatusBadge } from "@/components/StatusBadge";
import { recordMovement } from "@/server/scm";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { Table } from "@/components/ui";

export const dynamic = "force-dynamic";

/** The shared-spare view: one part, its stock, and every asset across all customers that uses it. */
export default async function PartPage({ params, searchParams }: { params: Promise<{ sku: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { sku } = await params;
  const { ok, error } = await searchParams;
  const t = await getTranslations("common"), u = await getTranslations("ui");
  const part = await prisma.part.findUnique({ where: { sku }, include: { brand: true, movements: { orderBy: { movedAt: "desc" }, take: 30, include: { asset: { select: { code: true } } } } } });
  if (!part) notFound();
  const [byWh, assets, me] = await Promise.all([stockByWarehouse(sku), assetsUsingPart(sku), currentEmployee()]);
  const onHand = [...byWh.values()].reduce((a, b) => a + b, 0), seeCost = can.cost(me);
  // N-41 / N-42: the batches still in stock (先进先出) and the ledger with its running balance — quantity for everyone,
  // amounts for those who see cost. The balance is replayed from the first movement, so each line shows what was left after it.
  const f = (await fifoOf([part.id])).get(part.id);
  const all = await prisma.stockMovement.findMany({ where: { partId: part.id, kind: "PART" }, orderBy: [{ movedAt: "asc" }, { no: "asc" }, { lineNo: "asc" }], select: { id: true, no: true, direction: true, qty: true, unitCost: true, movedAt: true, reversalOf: true, reversedBy: true, refNo: true, serviceOrder: { select: { no: true } }, asset: { select: { code: true } }, oldPartDisposition: true } });
  let bal = 0, val = 0;
  const ledger = all.map((m) => { const dead = !!(m.reversalOf || m.reversedBy); const q = (m.direction === "IN" ? 1 : -1) * Number(m.qty);
    const amt = dead ? (m.unitCost != null ? Number(m.unitCost) * Number(m.qty) : 0) : m.direction === "OUT" ? f?.out.get(m.id)?.amount ?? 0 : f?.back.get(m.id)?.amount ?? Number(m.unitCost ?? f?.fallback ?? 0) * Number(m.qty);
    bal += q; if (!dead) val += (m.direction === "IN" ? 1 : -1) * amt;
    return { ...m, q, amt: Math.round(amt * 100) / 100, bal: Math.round(bal * 1000) / 1000, val: Math.round(val * 100) / 100, dead }; }).reverse();
  async function move(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); const mv = await recordMovement({ actorCode: me.code, direction: f.get("direction") as "IN", partSku: sku, qty: Number(f.get("qty")), batch: String(f.get("batch") || "") || undefined, assetCode: String(f.get("assetCode") || "") || undefined, serviceOrderNo: String(f.get("serviceOrderNo") || "") || undefined, oldPartDisposition: String(f.get("old") || "") || undefined, unitCost: f.get("unitCost") ? Number(f.get("unitCost")) : undefined, costCurrency: "THB" }); return mv.no; }, `/parts/${sku}`);
  }
  const input = "rounded border px-2 py-1.5 text-sm";
  return (
    <div className="space-y-4">
      <Flash ok={ok} error={error} />
      <div className="flex items-center gap-3"><Link href="/parts" className="text-sm text-blue">← {t("nav_scm")}</Link><h1 className="font-mono text-2xl font-bold">{part.sku}</h1><span>{part.name}</span><span className="rounded bg-blue/8 px-2 py-0.5 text-sm">{t("onHand")} {onHand}{byWh.size > 1 ? `（${[...byWh].map(([w, n]) => `${w} ${n}`).join(" · ")}）` : ""}</span>{seeCost && part.lastCost != null && <span className="text-sm text-navy/70">{t("lastCost")} {part.lastCostCurrency} {Number(part.lastCost).toFixed(2)}</span>}{seeCost && f && <span className="text-sm font-semibold text-navy">{u("stockValue")} {f.value.toFixed(2)}</span>}</div>
      {seeCost && f && f.batches.some((b) => b.left > 1e-9) && <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{u("fifoBatches")}</h2>
        <Table head={[u("fifoBatch"), u("time"), u("fifoLeft"), u("unitCost"), t("amount")]}>{f.batches.filter((b) => b.left > 1e-9).map((b, i) => <tr key={b.inId + i}><td><Link href={`/parts/movement/${b.inNo}`} className="font-mono text-blue hover:underline">{b.inNo}</Link>{i === 0 ? <span className="ml-2 rounded bg-tint px-1.5 py-0.5 text-[11px] text-navy">{u("fifoNext")}</span> : null}</td><td className="whitespace-nowrap">{localIso(b.date)!.slice(0, 10)}</td><td className="tabular-nums">{b.left} / {b.qty}</td><td className="tabular-nums">{b.cost.toFixed(2)}</td><td className="text-right tabular-nums">{(b.left * b.cost).toFixed(2)}</td></tr>)}</Table></section>}
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{t("usedBy")} ({assets.length})</h2>
        <ul className="grid gap-1 text-sm md:grid-cols-2">{assets.map((a) => <li key={a.code} className="flex items-center gap-2"><Link href={`/assets/${a.code}`} className="font-mono text-blue underline">{a.code}</Link><span>{a.customer?.name}</span><span className="text-navy/70">{a.model?.code}</span><AssetStatusBadge status={a.status} /></li>)}</ul>
      </section>
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{t("stockIn")} / {t("stockOut")}</h2>
        <form action={move} className="flex flex-wrap gap-1"><select name="direction" className={input}><option value="IN">{t("stockIn")}</option><option value="OUT">{t("stockOut")}</option></select><input name="qty" type="number" step="0.001" placeholder={t("qty")} className={`${input} w-20`} required /><input name="batch" placeholder={t("batch")} className={`${input} w-24`} />{seeCost && <input name="unitCost" type="number" step="0.01" placeholder={t("unitCostIn")} className={`${input} w-36`} />}<input name="assetCode" placeholder={t("athOut")} className={`${input} w-32`} /><input name="serviceOrderNo" placeholder={t("qtthOut")} className={`${input} w-32`} /><input name="old" placeholder={t("oldPart")} className={input} /><button className="rounded bg-navy px-3 text-sm text-white">{"+"}</button></form>
      </section>
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{t("movements")}</h2>
        <Table head={[u("document"), u("time"), u("dirIn"), u("dirOut"), u("ledgerBal"), ...(seeCost ? [t("amount"), u("ledgerVal")] : []), ""]}>
          {ledger.slice(0, 60).map((m) => <tr key={m.id} className={m.dead ? "text-navy/45 line-through decoration-navy/30" : ""}>
            <td className="whitespace-nowrap">{pathAllows(me, `/parts/movement/${m.no}`) ? <Link href={`/parts/movement/${m.no}`} className="font-mono text-blue hover:underline">{m.no}</Link> : <span className="font-mono">{m.no}</span>}</td>
            <td className="whitespace-nowrap">{localIso(m.movedAt)!.slice(0, 10)}</td><td className="tabular-nums">{m.q > 0 ? Number(m.qty) : ""}</td><td className="tabular-nums">{m.q < 0 ? Number(m.qty) : ""}</td><td className="font-semibold tabular-nums">{m.bal}</td>
            {seeCost && <td className="text-right tabular-nums">{m.amt ? (m.q > 0 ? "" : "−") + m.amt.toFixed(2) : ""}</td>}{seeCost && <td className="text-right tabular-nums">{m.val.toFixed(2)}</td>}
            <td className="text-xs text-navy/70 no-underline">{m.serviceOrder?.no ?? ""}{m.asset ? ` → ${m.asset.code}` : ""}{m.refNo ? ` ↩ ${m.refNo}` : ""}{m.reversedBy ? ` ${u("voidedBy")} ${m.reversedBy}` : ""}{m.reversalOf ? ` ${u("voidOf")} ${m.reversalOf}` : ""}{m.oldPartDisposition ? ` · ${t("oldPart")}: ${m.oldPartDisposition}` : ""}</td></tr>)}
        </Table>
      </section>
    </div>
  );
}
