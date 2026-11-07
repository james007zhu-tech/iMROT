import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { catchUpOrder } from "@/server/slm";
import { setQuoteLines } from "@/server/slm-docs";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { RevealRows } from "@/components/RevealRows";
import { Alert, Card, inputCls } from "@/components/ui";
import { MIN_MARGIN_PCT } from "@/lib/margin";
import { StepPage, loadOrder, num, str } from "../_shell";

export const dynamic = "force-dynamic";
const ROWS = 12;

/** 报价 (lines on the QTTH). Saving moves DIAGNOSING → QUOTE_PENDING; the customer then confirms with a PO. */
export default async function Quote({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ no }, { error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const parts = await prisma.part.findMany({ orderBy: { sku: "asc" }, take: 500 });
  const lines = order.lines;
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const rows = Array.from({ length: ROWS }, (_, i) => ({ assetCode: str(f, `a${i}`), partSku: str(f, `s${i}`), description: str(f, `d${i}`) ?? "", descriptionLocal: str(f, `l${i}`), qty: num(f, `q${i}`) ?? 0, unit: str(f, `u${i}`) ?? "pcs", unitPrice: num(f, `p${i}`) ?? 0, unitCost: num(f, `c${i}`) })).filter((l) => l.description && l.qty > 0);
      if (!rows.length) throw new Error("QUOTE_NEEDS_LINE");
      await setQuoteLines({ serviceOrderNo: no, actorCode: me.code, lines: rows });
      const cur = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, select: { status: true } });
      if (["RECEIVED", "ASSIGNED", "DIAGNOSING"].includes(cur.status)) await catchUpOrder(no, "QUOTE_PENDING", me.code);
      return { ok: no, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/quote`);
  }
  return (
    <StepPage order={order} title={u("step_quote")} error={error} kind="quote" uploadTitle={u("upQuoteTitle")} uploadHint={u("upQuoteHint")} lineFields={{ description: "d", qty: "q", unit: "u", unitPrice: "c" }} saveLabel={u("saveQuote")}>
      <form id="f" action={save}>
        <Card title={u("quoteLines")}>
          {order.marginPct != null && Number(order.marginPct) < MIN_MARGIN_PCT && <Alert>{u("marginBelowFloor", { pct: (Number(order.marginPct) * 100).toFixed(1), floor: MIN_MARGIN_PCT * 100 })}</Alert>}
          <div className="hidden grid-cols-[120px_150px_2fr_2fr_70px_60px_100px_100px] gap-2 text-xs text-navy/70 md:grid"><span>{t("asset")}</span><span>{u("partSku")}</span><span>{u("descEn")}</span><span>{u("descTh")}</span><span>{t("qty")}</span><span>{u("uom")}</span><span>{t("price")}</span><span>{u("unitCost")}</span></div>
          <RevealRows initial={Math.max(lines.length, 2)} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => { const l = lines[i]; return (
              <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-[120px_150px_2fr_2fr_70px_60px_100px_100px]">
                <select name={`a${i}`} defaultValue={l?.assetCode ?? order.assets[0]?.asset.code} className={inputCls}><option value="">—</option>{order.assets.map((x) => <option key={x.assetId} value={x.asset.code}>{x.asset.code}</option>)}</select>
                <input name={`s${i}`} list="parts" defaultValue={parts.find((p) => p.id === l?.partId)?.sku ?? ""} className={inputCls} />
                <input name={`d${i}`} defaultValue={l?.description ?? ""} className={inputCls} />
                <input name={`l${i}`} defaultValue={l?.descriptionLocal ?? ""} className={inputCls} placeholder="ภาษาไทย" />
                <input name={`q${i}`} type="number" step="0.001" defaultValue={l ? Number(l.qty) : ""} className={inputCls} />
                <input name={`u${i}`} defaultValue={l?.unit ?? "pcs"} className={inputCls} />
                <input name={`p${i}`} type="number" step="0.01" defaultValue={l ? Number(l.unitPrice) : ""} className={inputCls} />
                <input name={`c${i}`} type="number" step="0.01" defaultValue={l?.unitCost != null ? Number(l.unitCost) : l?.costRef != null ? Number(l.costRef) : ""} placeholder={u("costPh")} className={inputCls} />
              </div>); })}
          </RevealRows>
          <datalist id="parts">{parts.map((p) => <option key={p.id} value={p.sku}>{p.name}</option>)}</datalist>
          <p className="text-xs text-navy/70">{u("quoteVatNote")} {u("marginRuleNote", { floor: MIN_MARGIN_PCT * 100 })}</p>
        </Card>
      </form>
    </StepPage>
  );
}
