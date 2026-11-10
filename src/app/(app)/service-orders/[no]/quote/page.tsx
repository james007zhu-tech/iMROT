import { PartDropdown } from "@/components/PartDropdown";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { latestRate, refreshIfStale } from "@/server/fx";
import { catchUpOrder } from "@/server/slm";
import { partnerCostByAsset, setQuoteLines } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { RevealRows } from "@/components/RevealRows";
import { Alert, Card, Field, inputCls } from "@/components/ui";
import { marginFloor } from "@/server/modes";
import { StepPage, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";
const ROWS = 12;

/** 报价 (lines on the QTTH). Saving moves DIAGNOSING → QUOTE_PENDING; the customer then confirms with a PO. */
export default async function Quote({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [parts, rate] = await Promise.all([prisma.part.findMany({ orderBy: { sku: "asc" }, take: 500 }), latestRate(order.currency)]);
  refreshIfStale(rate?.ageDays); // a missing or day-old BoC rate is fetched again in the background
  // No quote yet → start from what the inspections said the repair needs (parts with their last cost, labour in hours).
  type Row = { assetCode?: string | null; partId?: string | null; partSku?: string; description: string; descriptionLocal?: string | null; qty: number | { toString(): string }; unit: string; unitPrice?: number | { toString(): string }; unitCost?: number | { toString(): string } | null; costRef?: number | { toString(): string } | null; fromInth?: boolean };
  let lines: Row[] = order.lines;
  if (!lines.length && Array.isArray(order.requestLines)) {
    // 贸易: the customer's inquiry lines, cost = the part's last purchase price (a PRTH comparison updates it later)
    for (const r of order.requestLines as { sku?: string; description: string; qty: number; unit: string }[]) {
      const part = r.sku ? parts.find((p) => p.sku === r.sku) : undefined;
      lines.push({ partSku: r.sku, description: r.description || part?.name || "", descriptionLocal: part?.nameLocal, qty: r.qty, unit: r.unit, unitCost: part?.lastCost ?? null });
    }
  }
  if (order.mode === "AUTOMATION_PROJECT" && !order.lines.length) {
    // 自动化项目: the BOM above, then the labour from the plan (hours × internal cost per hour)
    for (const l of ((order.project as { labour?: { description: string; hours: number; costPerHour?: number }[] } | null)?.labour ?? [])) lines.push({ description: l.description, descriptionLocal: "ค่าแรงงานวิศวกรรม", qty: l.hours, unit: "h", unitCost: l.costPerHour ?? null });
  }
  if (!lines.length) {
    const insps = await prisma.inspection.findMany({ where: { serviceOrderId: order.id, draft: false }, orderBy: { no: "asc" }, include: { asset: { select: { code: true } } } });
    for (const insp of insps) for (const n of ((insp.needs as { kind: string; partSku?: string; description: string; descriptionLocal?: string; qty: number; unit?: string }[] | null) ?? [])) {
      const part = n.partSku ? parts.find((p) => p.sku === n.partSku) : undefined;
      lines.push({ assetCode: insp.asset.code, partSku: n.partSku, description: n.description, descriptionLocal: n.descriptionLocal, qty: n.qty, unit: n.unit ?? (n.kind === "LABOUR" ? "h" : "pcs"), unitCost: part?.lastCost ?? null, fromInth: true });
    }
  }
  const partner = order.mode === "PARTNER_REPAIR";
  const floor = await marginFloor(order.mode);
  const partnerCosts = partner ? await partnerCostByAsset(prisma, order.id) : new Map<string, number>();
  if (partner && !lines.length) {
    // 合作维修: one repair line per machine, its cost = the selected partner quote
    for (const l of order.assets) lines.push({ assetCode: l.asset.code, description: "Repair", descriptionLocal: "ค่าซ่อม", qty: 1, unit: "set", unitCost: partnerCosts.get(l.asset.code) ?? null });
  }
  const fromInth = lines.some((l) => l.fromInth);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const rows = Array.from({ length: ROWS }, (_, i) => ({ assetCode: str(f, `a${i}`), partSku: str(f, `s${i}`), description: str(f, `d${i}`) ?? "", descriptionLocal: str(f, `l${i}`), qty: num(f, `q${i}`) ?? 0, unit: str(f, `u${i}`) ?? "pcs", unitPrice: num(f, `p${i}`) ?? 0, unitCost: num(f, `c${i}`) })).filter((l) => l.description && l.qty > 0);
      if (!rows.length) throw new Error("QUOTE_NEEDS_LINE");
      await setQuoteLines({ serviceOrderNo: no, actorCode: me.code, lines: rows, warrantyDays: num(f, "warrantyDays") });
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } });
      if (["RECEIVED", "ASSIGNED", "DIAGNOSING"].includes(cur.status)) await catchUpOrder(no, "QUOTE_PENDING", me.code);
      return { ok: no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/quote`);
  }
  return (
    <StepPage order={order} title={u("step_quote")} error={error} kind="quote" uploadTitle={u("upQuoteTitle")} uploadHint={u("upQuoteHint")} lineFields={{ description: "d", qty: "q", unit: "u", unitPrice: "c" }} saveLabel={u("saveQuote")}>
      <form id="f" action={save}>
        <Card title={u("quoteLines")}>
          {fromInth && <Alert>{u("quoteFromInth")}</Alert>}
          {order.marginPct != null && Number(order.marginPct) < floor && <Alert>{u("marginBelowFloor", { pct: (Number(order.marginPct) * 100).toFixed(1), floor: Math.round(floor * 100) })}</Alert>}
          {partner && <p className="mb-2 text-xs text-navy/70">{u("partnerQuoteNote")}{[...partnerCosts].map(([a, c]) => ` · ${a}: ${c.toFixed(2)}`).join("")}</p>}
          <div className="hidden grid-cols-[120px_150px_2fr_2fr_70px_60px_100px_100px] gap-2 text-xs text-navy/70 md:grid"><span>{t("asset")}</span><span>{u("partSku")}</span><span>{u("descEn")}</span><span>{u("descTh")}</span><span>{t("qty")}</span><span>{u("uom")}</span><span>{t("price")}</span><span>{u("unitCost")}</span></div>
          <RevealRows initial={Math.max(lines.length, 2)} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => { const l = lines[i]; return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[120px_150px_2fr_2fr_70px_60px_100px_100px]">
                <select name={`a${i}`} defaultValue={l?.assetCode ?? order.assets[0]?.asset.code} className={inputCls}><option value="">—</option>{order.assets.map((x) => <option key={x.assetId} value={x.asset.code}>{x.asset.code}</option>)}</select>
                <input name={`s${i}`} list="parts" defaultValue={l?.partSku ?? parts.find((p) => p.id === l?.partId)?.sku ?? ""} className={inputCls} />
                <input name={`d${i}`} defaultValue={l?.description ?? ""} className={inputCls} />
                <input name={`l${i}`} defaultValue={l?.descriptionLocal ?? ""} className={inputCls} placeholder="ภาษาไทย" />
                <input name={`q${i}`} type="number" step="0.001" defaultValue={l ? Number(l.qty) : ""} className={inputCls} />
                <input name={`u${i}`} defaultValue={l?.unit ?? "pcs"} className={inputCls} />
                <input name={`p${i}`} type="number" step="0.01" defaultValue={l?.unitPrice != null ? Number(l.unitPrice) : ""} className={inputCls} />
                <input name={`c${i}`} type="number" step="0.01" defaultValue={l?.unitCost != null ? Number(l.unitCost) : l?.costRef != null ? Number(l.costRef) : ""} placeholder={u("costPh")} className={inputCls} />
              </div>); })}
          </RevealRows>
          <PartDropdown formId="f" sku="s" name="d" local="l" unit="u" labels={{ none: u("partNotListed"), onHand: u("briefOnHand"), own: u("partOfModel") }} parts={parts.map((p) => ({ sku: p.sku, vendorPartNo: p.vendorPartNo, name: p.name, nameLocal: p.nameLocal, unit: p.unit }))} />
          <p className="text-xs text-navy/70">{u("quoteVatNote")} {u("marginRuleNote", { floor: Math.round(floor * 100) })}</p>
          <div className="mt-2 max-w-xs"><Field label={u("customerWarrantyDays")}><input name="warrantyDays" type="number" min="0" defaultValue={order.warrantyDays ?? ""} placeholder={partner ? u("warrantyBackToBack") : ""} className={inputCls} /></Field></div>
          {!rate ? (
            <Alert>{u("fxMissing", { ccy: order.currency })} <Link href="/admin" className="underline">{u("fxGoAdmin")}</Link></Alert>
          ) : order.currency !== "CNY" && (
            <p className={`text-xs ${rate.ageDays > 3 ? "font-semibold text-alert-ink" : "text-navy/70"}`}>
              {u("fxLine", { ccy: order.currency, rate: rate.rateToCny.toFixed(6), date: rate.rateDate.toISOString().slice(0, 10) })}
              {order.totalCny != null && ` · ${u("fxTotal", { amount: Number(order.totalCny).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}`}
              {rate.ageDays > 3 && ` · ${u("fxStale", { days: rate.ageDays })}`}
            </p>
          )}
        </Card>
      </form>
    </StepPage>
  );
}
