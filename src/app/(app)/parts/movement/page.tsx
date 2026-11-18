import { can } from "@/lib/caps";
import { orderScope } from "@/server/scope";
import { issueNeeds } from "@/server/scm";
import { PartDropdown } from "@/components/PartDropdown";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { recordStockDoc } from "@/server/scm";
import { dayNow, localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { RevealRows } from "@/components/RevealRows";
import { SkuNames } from "@/components/SkuNames";
import { ScopedSelect } from "@/components/ScopedSelect";
import { PoFill, type PoChoice } from "@/components/PoFill";
import { Alert, Card, Field, Grid, PageHeader, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
const ROWS = 10;

/** 出入库 IBTH / OBTH — wireframe 10. Each line gets its own IBTH/OBTH number; OUT lines must name the asset or the order. */
export default async function Movement({ searchParams }: { searchParams: Promise<{ direction?: string; order?: string; ref?: string; error?: string; ok?: string }> }) {
  const { direction, order, ref, error, ok } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const me = await currentEmployee();
  const seeCost = can.cost(me);
  const [parts, orders, whs] = await Promise.all([
    prisma.part.findMany({ orderBy: { sku: "asc" }, select: { sku: true, vendorPartNo: true, name: true, unit: true } }),
    prisma.serviceOrder.findMany({ where: { AND: [await orderScope(me), { status: { in: ["ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING"] } }] }, include: { customer: true }, orderBy: { reportedAt: "desc" } }),
    prisma.stockMovement.groupBy({ by: ["warehouse"] }),
  ]);
  const warehouses = [...new Set(["RAYONG", ...whs.map((w) => w.warehouse)])];
  // 从工单出库: the order's part lines not yet issued are already on the form — part, quantity, the order's machine (需求清单 v3 P0-08)
  const fromOrder = order && direction === "OUT" && orders.some((o) => o.no === order) ? await issueNeeds(order) : null; // only an order this person may see
  // N-40: stock on hand per part, so an issue for more than there is turns red in its row before it is sent
  const moved = await prisma.stockMovement.groupBy({ by: ["partId", "direction"], where: { partId: { not: null } }, _sum: { qty: true } });
  const idSku = new Map((await prisma.part.findMany({ select: { id: true, sku: true } })).map((x) => [x.id, x.sku]));
  const onHand: Record<string, number> = {};
  for (const r of moved) { const k = idSku.get(r.partId!); if (k) onHand[k] = (onHand[k] ?? 0) + (r.direction === "IN" ? 1 : -1) * Number(r._sum.qty ?? 0); }
  // N-42 退料选原出库单: the order's issues still standing, each with what has not come back yet
  const mayOrder = !!order && orders.some((o) => o.no === order);
  const obRows = mayOrder && direction !== "OUT" ? await prisma.stockMovement.findMany({ where: { serviceOrder: { no: order }, direction: "OUT", kind: "PART", reversedBy: null, reversalOf: null }, orderBy: [{ movedAt: "desc" }, { lineNo: "asc" }], select: { no: true, partId: true, qty: true, movedAt: true } }) : [];
  const backRows = obRows.length ? await prisma.stockMovement.findMany({ where: { refNo: { in: obRows.map((r) => r.no) }, direction: "IN", kind: "PART", reversedBy: null, reversalOf: null }, select: { refNo: true, partId: true, qty: true } }) : [];
  const obs = [...new Set(obRows.map((r) => r.no))].map((n) => ({ no: n, date: localIso(obRows.find((r) => r.no === n)!.movedAt)!.slice(0, 10),
    lines: obRows.filter((r) => r.no === n).map((r) => ({ sku: idSku.get(r.partId!) ?? "", qty: Number(r.qty) - backRows.filter((b) => b.refNo === n && b.partId === r.partId).reduce((a, b) => a + Number(b.qty), 0), onHand: 0 })).filter((l) => l.sku && l.qty > 1e-9) })).filter((o) => o.lines.length);
  const refOb = obs.find((o) => o.no === ref);
  const pre = refOb ? refOb.lines.map((l) => ({ ...l, onHand: Infinity })) : fromOrder?.lines ?? [];
  // 维修出库: only the machines of the order's own customer (测试报告 P0-03); 贸易出库 picks no machine at all
  const custIds = [...new Set(orders.map((o) => o.customerId))];
  const custAssets = await prisma.asset.findMany({ where: { customerId: { in: custIds } }, select: { code: true, customerId: true, serialNumber: true, location: true }, orderBy: { code: "desc" }, take: 3000 });
  const assetOptions = custAssets.map((a) => ({ value: a.code, label: `${a.code}${a.serialNumber ? ` · S/N ${a.serialNumber}` : ""}${a.location ? ` · ${a.location}` : ""}`, scope: a.customerId ?? "" }));
  const orderCustomer = Object.fromEntries(orders.map((o) => [o.no, o.customerId]));
  // 贸易出库从采购单带出: POTHs of trade orders with goods received
  const names = can.customerNames(me); // PUR works by order number; who the customer is is not theirs to see
  const pos = !can.purchase(me) ? [] : await prisma.purchaseOrder.findMany({ where: { kind: "PARTS", status: { in: ["PARTIAL", "RECEIVED"] }, serviceOrder: { mode: { in: ["DOMESTIC_TRADE", "INTERNATIONAL_TRADE"] }, status: { in: ["QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING"] } } }, include: { serviceOrder: { select: { no: true, customer: { select: { name: true, code: true } } } }, supplier: { select: { name: true } } }, orderBy: { orderedAt: "desc" }, take: 60 });
  const poChoices: PoChoice[] = pos.map((p) => ({ no: p.no, orderNo: p.serviceOrder!.no, customer: names ? p.serviceOrder!.customer.name : p.serviceOrder!.customer.code, label: `${p.no} · ${names ? p.serviceOrder!.customer.name : p.serviceOrder!.customer.code} · ${p.serviceOrder!.no}`,
    lines: ((p.lines as { partSku?: string; receivedQty?: number }[] | null) ?? []).filter((l) => l.partSku && Number(l.receivedQty ?? 0) > 0).map((l) => ({ sku: l.partSku!, qty: Number(l.receivedQty) })) })).filter((c) => c.lines.length > 0);
  const backTo = order ? `/service-orders/${order}` : "/parts";
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const dir = f.get("direction") as "IN" | "OUT";
      const rows = Array.from({ length: ROWS }, (_, i) => ({ partSku: String(f.get(`s${i}`) ?? "").trim(), qty: Number(f.get(`q${i}`) || 0), batch: String(f.get(`b${i}`) ?? "").trim() || undefined, unitCost: dir === "IN" && f.get(`c${i}`) ? Number(f.get(`c${i}`)) : undefined, oldPartDisposition: dir === "OUT" ? String(f.get(`o${i}`) ?? "") || undefined : undefined })).filter((r) => r.partSku && r.qty > 0);
      // N-42: parts handed back to an order that has issues must say which issue they come from
      const so0 = String(f.get("serviceOrderNo") || ""), ref0 = String(f.get("refNo") || "");
      if (dir === "IN" && so0 && !ref0 && (await prisma.stockMovement.count({ where: { serviceOrder: { no: so0 }, direction: "OUT", kind: "PART", reversedBy: null, reversalOf: null } })) > 0) throw new Error("RETURN_NEEDS_OB");
      const doc = await recordStockDoc({ actorCode: me.code, direction: dir, warehouse: String(f.get("warehouse") || "RAYONG"), assetCode: String(f.get("assetCode") || "") || undefined, serviceOrderNo: String(f.get("serviceOrderNo") || "") || undefined, supplierRef: String(f.get("supplierRef") || "") || undefined, refNo: dir === "IN" ? String(f.get("refNo") || "") || undefined : undefined, costCurrency: "THB", movedAt: dayNow(String(f.get("movedAt") || "") || undefined), lines: rows });
      const nos = [`${doc.no} · ${doc.lines.length}`];
      const so = String(f.get("serviceOrderNo") || "");
      return { ok: nos.join(", "), to: so ? `/service-orders/${so}` : "/parts" };
    }, `/parts/movement?direction=${f.get("direction") === "OUT" ? "OUT" : "IN"}${String(f.get("serviceOrderNo") || order || "") ? `&order=${String(f.get("serviceOrderNo") || order)}` : ""}`); // N-40: a refused issue comes back as an issue, with its order — never as a receipt
  }
  const [code, list] = (error ?? "").split(":");
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: backTo, label: order ?? u("backToParts") }} title={u("stockMovement")} actions={<><Link href={backTo} className={btnGhost}>{t("cancel")}</Link><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      <Flash ok={ok} error={code === "UNKNOWN_SKU" ? undefined : error} />
      {code === "UNKNOWN_SKU" && <Alert>{u("unknownSku", { list })} {u("newPartInList")}</Alert>}
      <FormMemory formId="f" />
      <UploadRecognize kind="stock" formId="f" title={u("upStockTitle")} hint={u("upStockHint")} />
      <form id="f" action={save} className="space-y-4">
        <Card title={u("movementDoc")}>
          <PoFill formId="f" choices={poChoices} sku="s" qty="q" orderField="serviceOrderNo" assetWrap="assetWrap" labels={{ pick: u("poFillPick"), none: u("poFillNone"), filled: u("poFillDone", { order: "{order}", customer: "{customer}", n: "{n}" }) }} />
          <Grid>
            <Field label={u("direction")} required><select name="direction" defaultValue={direction === "OUT" ? "OUT" : "IN"} className={inputCls}><option value="IN">{u("dirIn")}</option><option value="OUT">{u("dirOut")}</option></select></Field>
            <Field label={u("warehouse")}><select name="warehouse" defaultValue="RAYONG" className={inputCls}>{warehouses.map((w) => <option key={w} value={w}>{w}</option>)}</select></Field>
            <Field label={u("date")}><input name="movedAt" type="date" defaultValue={localIso(new Date())!.slice(0, 10)} className={inputCls} /></Field>
            <Field label={u("relatedOrder")}><select name="serviceOrderNo" defaultValue={order ?? ""} className={inputCls}><option value="">—</option>{orders.map((o) => <option key={o.id} value={o.no}>{o.no}{names ? ` · ${o.customer.name}` : ""}</option>)}</select></Field>
            <div id="assetWrap"><Field label={u("relatedAssetRepair")}><ScopedSelect name="assetCode" options={assetOptions} follow="serviceOrderNo" via={orderCustomer} defaultValue={fromOrder?.assetCode} className={inputCls} /></Field></div>
            {obs.length > 0 && <Field label={u("returnOb")}><select name="refNo" title={u("returnObHint")} defaultValue={refOb?.no ?? ""} className={inputCls}><option value="">—</option>{obs.map((o) => <option key={o.no} value={o.no}>{o.no} · {o.date} · {o.lines.map((l) => `${l.sku} ×${l.qty}`).join(", ")}</option>)}</select><span className="mt-1 block text-xs text-navy/60">{u("returnObHint")}</span></Field>}
            <Field label={u("supplierRef")}><input name="supplierRef" className={inputCls} /></Field>
            <Field label={u("handler")}><div className="min-h-10 rounded-md border bg-white px-2.5 py-2 text-sm">{me.code} {me.name}</div></Field>
          </Grid>
        </Card>
        <Card title={u("lines")}>
          {fromOrder && pre.length === 0 && <Alert>{u(fromOrder.hadParts ? "issueAllDone" : "issueNoParts")}</Alert>}
          {pre.length > 0 && <p className="mb-2 text-[13px] text-navy">{refOb ? u("returnPrefilled", { no: refOb.no }) : u("issuePrefilled", { n: pre.length })}</p>}
          {pre.some((l) => l.onHand < l.qty) && <Alert>{u("issueShort")}：{pre.filter((l) => l.onHand < l.qty).map((l) => `${l.sku} ${u("issueShortBy", { n: l.qty - l.onHand })}`).join("；")}。 {fromOrder!.openInquiry ? <span>{u("issueBuying", { no: fromOrder!.openInquiry })}</span> : <Link href={`/purchasing/inquiries/new?order=${order}`} className="font-semibold underline">{u("issueBuy")} →</Link>}</Alert>}
          <div className={`hidden gap-2 text-xs text-navy/70 md:grid ${seeCost ? "grid-cols-[2fr_80px_1fr_1fr_1.4fr]" : "grid-cols-[2fr_80px_1fr_1.4fr]"}`}><span>{t("sku")}</span><span>{t("qty")}</span><span>{u("batch")}</span>{seeCost && <span>{u("unitCostThb")}</span>}<span>{u("oldPartOut")}</span></div>
          <RevealRows initial={Math.max(2, pre.length)} addLabel={u("addLine")}>
            {Array.from({ length: ROWS }, (_, i) => <div key={i} className={`grid grid-cols-2 gap-2 ${seeCost ? "md:grid-cols-[2fr_80px_1fr_1fr_1.4fr]" : "md:grid-cols-[2fr_80px_1fr_1.4fr]"}`}><span><input name={`s${i}`} list="skus" data-sku defaultValue={pre[i]?.sku ?? ""} className={`${inputCls} font-mono ${pre[i] && pre[i].onHand < pre[i].qty ? "field-bad" : ""}`} /><span data-sku-name={`s${i}`} />{pre[i] && !refOb ? <span className={`block text-xs ${pre[i].onHand < pre[i].qty ? "font-semibold text-alert-ink" : "text-navy/60"}`}>{u("briefOnHand")} {pre[i].onHand}</span> : null}</span><input name={`q${i}`} type="number" step="1" defaultValue={pre[i]?.qty ?? ""} className={inputCls} /><input name={`b${i}`} className={inputCls} />{seeCost && <input name={`c${i}`} type="number" step="0.01" className={inputCls} />}<select name={`o${i}`} className={inputCls}><option value="">—</option><option value="SCRAP">{u("dispScrap")}</option><option value="RETURN_TO_CUSTOMER">{u("dispReturn")}</option><option value="KEEP_FOR_ANALYSIS">{u("dispKeep")}</option></select></div>)}
          </RevealRows>
          <PartDropdown formId="f" sku="s" labels={{ none: u("partNotListed"), onHand: u("briefOnHand"), own: u("partOfModel") }} parts={parts.map((p) => ({ sku: p.sku, vendorPartNo: p.vendorPartNo, name: p.name, unit: p.unit }))} />
          <SkuNames names={Object.fromEntries(parts.map((p) => [p.sku, p.name ?? ""]))} unknown={u("skuUnknown")} stock={onHand} stockLabels={{ onHand: u("briefOnHand"), over: u("issueOver") }} />
          <p className="text-xs text-navy/70">{u("newPartInList")}</p>
        </Card>
      </form>
    </div>
  );
}
