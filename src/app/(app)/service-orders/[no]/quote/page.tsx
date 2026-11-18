import { assertOrderAccess } from "@/server/scope";
import { fxMark } from "@/lib/fx-label";
import { can, hasRole } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import { PartDropdown } from "@/components/PartDropdown";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { latestRate, refreshIfStale } from "@/server/fx";
import { catchUpOrder } from "@/server/slm";
import { partnerCostByAsset, setQuoteLines, suggestPrice } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { QuoteSum } from "@/components/QuoteSum";
import { RevealRows } from "@/components/RevealRows";
import { Alert, Card, Field, btnGhost, inputCls } from "@/components/ui";
import { marginFloor } from "@/server/modes";
import { StepPage, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";
const ROWS = 12;

/** 报价 (lines on the QTTH). Saving moves DIAGNOSING → QUOTE_PENDING; the customer then confirms with a PO. */
export default async function Quote({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u, me] = await Promise.all([getTranslations("common"), getTranslations("ui"), currentEmployee()]);
  // 统一角色权限表: sales and the MD set the price; 内勤 and finance see it; the shop floor works on parts, quantities and wording only
  const seePrice = can.price(me), seeCost = can.margin(me), edit = can.editPrice(me);
  const seeHist = can.cost(me) || seeCost; // cost and what we paid before: MD, FIN (and PUR where it has the page). Sales sees neither (派修单 v4 第 2 条)
  const badCost = error?.startsWith("QUOTE_COST_REQUIRED:") || error?.startsWith("QUOTE_COST_PENDING:") ? error.split(":")[1].split("、").map(Number) : [];
  const items = !edit && hasRole(me, "ENGINEER") && ["RECEIVED", "ASSIGNED", "DIAGNOSING"].includes(order.status);
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
  const vatRate = Number((await prisma.legalEntity.findUnique({ where: { id: order.entityId }, select: { vatRate: true } }))?.vatRate ?? 0.07);
  const partnerCosts = partner ? await partnerCostByAsset(prisma, order.id) : new Map<string, number>();
  if (partner && !lines.length) {
    // 合作维修: one repair line per machine, its cost = the selected partner quote
    for (const l of order.assets) lines.push({ assetCode: l.asset.code, description: "Repair", descriptionLocal: "ค่าซ่อม", qty: 1, unit: "set", unitCost: partnerCosts.get(l.asset.code) ?? null });
  }
  const fromInth = lines.some((l) => l.fromInth);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee(); await assertOrderAccess(me, no);
      const rows = Array.from({ length: ROWS }, (_, i) => ({ assetCode: str(f, `a${i}`), partSku: str(f, `s${i}`), description: str(f, `d${i}`) ?? "", descriptionLocal: str(f, `l${i}`), qty: num(f, `q${i}`) ?? 0, unit: str(f, `u${i}`) ?? "pcs", unitPrice: num(f, `p${i}`) ?? 0, unitCost: num(f, `c${i}`) })).filter((l) => l.description && l.qty > 0);
      if (!rows.length) throw new Error("QUOTE_NEEDS_LINE");
      const r = await setQuoteLines({ serviceOrderNo: no, actorCode: me.code, lines: rows, warrantyDays: num(f, "warrantyDays") });
      if (r.costPending.length) throw new Error(`QUOTE_COST_PENDING:${r.costPending.join("、")}`); // the lines are saved; the quote waits for the cost
      if (!can.editPrice(me)) return { ok: "quoteItemsSaved", to: `/service-orders/${no}/quote` }; // saved for sales to price; the order does not move
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } });
      if (["RECEIVED", "ASSIGNED", "DIAGNOSING"].includes(cur.status)) await catchUpOrder(no, "QUOTE_PENDING", me.code);
      return { ok: no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/quote`);
  }
  async function hint(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await assertOrderAccess(me, no); await suggestPrice({ no, actorCode: me.code, note: String(f.get("note") ?? "") }); return { ok: "priceHintSent", to: `/service-orders/${no}/quote` }; }, `/service-orders/${no}/quote`);
  }
  // Sales does not see what we paid; the system turns it into two prices to quote by (MD 2026-11-17 18:29):
  // 最低售价 = cost ÷ (1 − margin floor of this business), 建议售价 = 10 % above it.
  const saved = order.lines.length > 0;
  const byPrice = new Map<number, { min: number; suggest: number }>();
  lines.forEach((l, i) => { const part = parts.find((p) => (l.partId && p.id === l.partId) || (l.partSku && p.sku === l.partSku)); const c = Number(l.unitCost ?? 0) || Number(part?.lastCost ?? 0); if (c > 0 && floor < 1) { const min = c / (1 - floor); byPrice.set(i, { min, suggest: min * 1.1 }); } });
  const partnerMode = order.mode === "PARTNER_REPAIR";
  const cols = seeCost ? "md:grid-cols-[120px_150px_2fr_2fr_70px_60px_100px_100px]" : seePrice ? "md:grid-cols-[120px_150px_2fr_2fr_70px_60px_100px]" : "md:grid-cols-[120px_150px_2fr_2fr_70px_60px]";
  return (
    <StepPage order={order} title={u("step_quote")} ok={ok === "quoteItemsSaved" ? u("quoteItemsSaved") : ok === "priceHintSent" ? u("priceHintSent") : ok} error={error} kind="quote" uploadTitle={u("upQuoteTitle")} uploadHint={u("upQuoteHint")} lineFields={{ description: "d", qty: "q", unit: "u", unitPrice: "c" }} saveLabel={edit ? u("saveQuote") : items ? u("saveQuoteItems") : ""}>
      <form id="f" action={save}>
        <Card title={u("quoteLines")}>
          {fromInth && <Alert>{u("quoteFromInth")}</Alert>}
          <p className="mb-2 text-xs text-navy/70">{u("quoteSkuOptional")}</p>
          {!edit && <Alert>{u(items ? "quoteItemsNote" : "quoteReadOnly")}</Alert>}
          {edit && order.priceHint && <Alert>{u("priceHintFrom")}：{order.priceHint}</Alert>}
          {seeCost && order.marginPct != null && Number(order.marginPct) < floor && <Alert>{u("marginBelowFloor", { pct: (Number(order.marginPct) * 100).toFixed(1), floor: Math.round(floor * 100) })}</Alert>}
          {partner && seeHist && <p className="mb-2 text-xs text-navy/70">{u("partnerQuoteNote")}{[...partnerCosts].map(([a, c]) => ` · ${a}: ${c.toFixed(2)}`).join("")}</p>}
          <div className={`hidden gap-2 text-xs text-navy/70 md:grid ${cols}`}><span>{t("asset")}</span><span>{u("partSku")}</span><span>{u("descEn")}</span><span>{u("descTh")}</span><span>{t("qty")}</span><span>{u("uom")}</span>{seePrice && <span>{t("price")}</span>}{seeCost && <span>{u("unitCost")}</span>}</div>
          <RevealRows initial={Math.max(lines.length, 2)} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => { const l = lines[i]; return (
              <div key={i} className={`grid grid-cols-2 gap-2 ${cols}`}>
                <select name={`a${i}`} defaultValue={l?.assetCode ?? order.assets[0]?.asset.code} className={inputCls}><option value="">—</option>{order.assets.map((x) => <option key={x.assetId} value={x.asset.code}>{x.asset.code}</option>)}</select>
                <input name={`s${i}`} list="parts" defaultValue={l?.partSku ?? parts.find((p) => p.id === l?.partId)?.sku ?? ""} className={inputCls} />
                <input name={`d${i}`} defaultValue={l?.description ?? ""} className={inputCls} />
                <input name={`l${i}`} defaultValue={l?.descriptionLocal ?? ""} className={inputCls} placeholder="ภาษาไทย" />
                <input name={`q${i}`} type="number" step="0.001" defaultValue={l ? Number(l.qty) : ""} className={inputCls} />
                <input name={`u${i}`} defaultValue={l?.unit ?? "pcs"} className={inputCls} />
                {seePrice && <input name={`p${i}`} type="number" step="0.01" readOnly={!edit} defaultValue={l?.unitPrice != null ? Number(l.unitPrice) : ""} className={`${inputCls} ${edit ? "" : "bg-[#F1F4F8] text-navy/70"}`} />}
                {seeCost && <input name={`c${i}`} type="number" step="0.01" readOnly={!edit} defaultValue={l?.unitCost != null ? Number(l.unitCost) : l?.costRef != null ? Number(l.costRef) : ""} placeholder={u("costPh")} className={`${inputCls} ${edit ? "" : "bg-[#F1F4F8] text-navy/70"} ${l && Number(l.qty) > 0 && l.unitCost == null && l.costRef == null && !partnerMode || badCost.includes(i + 1) ? "field-bad" : ""}`} />}
                {seeCost && l && Number(l.qty) > 0 && l.unitCost == null && l.costRef == null && !partnerMode && <span className="text-[11px] font-semibold text-alert-ink col-span-full [grid-column:1/-1]">{u("costMissingRow", { n: i + 1 })}</span>}
                {edit && !seeCost && l && Number(l.qty) > 0 && !partnerMode && (byPrice.get(i)
                  ? <span className={`text-[11px] col-span-full [grid-column:1/-1] ${Number(l.unitPrice ?? 0) > 0 && Number(l.unitPrice) < byPrice.get(i)!.min - 0.005 ? "font-semibold text-alert-ink" : "text-navy/70"}`}>{u("priceHint", { n: i + 1, suggest: byPrice.get(i)!.suggest.toFixed(2), min: byPrice.get(i)!.min.toFixed(2) })}{Number(l.unitPrice ?? 0) > 0 && Number(l.unitPrice) < byPrice.get(i)!.min - 0.005 ? ` ${u("priceBelowMin")}` : ""}</span>
                  : <span className="text-[11px] font-semibold text-alert-ink col-span-full [grid-column:1/-1]">{u("costPendingRow", { n: i + 1 })}</span>)}
              </div>); })}
          </RevealRows>
          <PartDropdown formId="f" sku="s" name="d" local="l" unit="u" labels={{ none: u("partNotListed"), onHand: u("briefOnHand"), own: u("partOfModel") }} parts={parts.map((p) => ({ sku: p.sku, vendorPartNo: p.vendorPartNo, name: p.name, nameLocal: p.nameLocal, unit: p.unit }))} />
          {seePrice && <QuoteSum plain={!seeCost} rows={ROWS} vatRate={vatRate} floor={floor} currency={order.currency} labels={{ subtotal: u("quoteSubtotal"), vat: t("vat"), total: u("quoteTotal"), cost: u("quoteCost"), margin: u("quoteMargin"), below: u("quoteBelowFloor", { floor: Math.round(floor * 100) }), noCost: u("quoteNoCost") }} />}
          {seeCost && <p className="text-xs text-navy/70">{u("quoteVatNote")} {u("marginRuleNote", { floor: Math.round(floor * 100) })}</p>}
          <div className="mt-2 max-w-xs"><Field label={u("customerWarrantyDays")}><input name="warrantyDays" type="number" min="0" defaultValue={order.warrantyDays ?? ""} placeholder={partner ? u("warrantyBackToBack") : ""} className={inputCls} /></Field></div>
          {!seePrice ? null : !rate ? (
            <Alert>{u("fxMissing", { ccy: order.currency })} <Link href="/admin" className="underline">{u("fxGoAdmin")}</Link></Alert>
          ) : order.currency !== "CNY" && (
            <p className={`text-xs ${rate.ageDays > 3 ? "font-semibold text-alert-ink" : "text-navy/70"}`}>
              {u("fxLine", { ccy: order.currency, rate: rate.rateToCny.toFixed(6), mark: fxMark(u, rate.source, rate.rateDate) })}
              {order.totalCny != null && ` · ${u("fxTotal", { amount: Number(order.totalCny).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) })}`}
              {rate.ageDays > 3 && ` · ${u("fxStale", { days: rate.ageDays })}`}
            </p>
          )}
        </Card>
      </form>
      {!seePrice && <Card title={u("priceHintTitle")}>
        <form action={hint} className="flex flex-wrap gap-2"><input name="note" required defaultValue={order.priceHint ?? ""} placeholder={u("priceHintPh")} className={`${inputCls} min-w-0 flex-1`} /><button className={btnGhost}>{u("priceHintSend")}</button></form>
        <p className="mt-1 text-xs text-navy/70">{u("priceHintNote")}</p>
      </Card>}
    </StepPage>
  );
}
