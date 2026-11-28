import Link from "next/link";
import { can, hasRole } from "@/lib/caps";
import { fxFields, rateFor } from "@/server/fx";
import { fxMark } from "@/lib/fx-label";
import { assertOrderAccess } from "@/server/scope";
import { localIso } from "@/lib/dates";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { decideTaxInvoiceVoid, issueCreditNote, issueInvoice, issueTaxInvoice, requestTaxInvoiceVoid, voidCreditNote, withdrawVoidRequest } from "@/server/to";
import { liveNumbers } from "@/lib/numbering";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { businessClosureOn } from "@/lib/closure";
import { Alert, Card, Field, Grid, Table, Tag, Value, btnGhost, inputCls } from "@/components/ui";
import { StepPage, dayNow, loadOrder, str } from "../_shell";
import { confirmOrderCost, costChoices, isSettled, lineCosts, openCostItems, orderCost, type LineCost, type OrderCost } from "@/server/job-cost";
import { declineInvoiceLines } from "@/server/decline";
import { totals } from "@/lib/money";

export const dynamic = "force-dynamic";

/** 开票 — wireframe 9 (top half): TITH tax invoice in THB with Thai item names and VAT shown separately, then IVTH. */
export default async function Invoice({ params, searchParams }: { params: Promise<{ no: string }>; searchParams: Promise<{ ok?: string; error?: string }> }) {
  const [{ no }, { ok, error }] = await Promise.all([params, searchParams]);
  const order = await loadOrder(no);
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const me = await currentEmployee(); await assertOrderAccess(me, no);
  const fx = await rateFor(order.currency); // what the tax invoice will be booked at: 中国银行价, or 财务手工价 of the day
  const taxInvoices = await prisma.taxInvoice.findMany({ where: { serviceOrderId: order.id }, orderBy: { issuedAt: "asc" }, include: { invoices: { select: { no: true, cancelledAt: true, paidAmount: true } }, creditNotes: { orderBy: { issuedAt: "asc" } } } });
  const mayCredit = can.invoice(me);
  const active = taxInvoices.find((x) => !x.voidedAt);
  const mayIssue = can.invoice(me); // 开票 is finance's (and the MD's); sales and 内勤 see the state
  // 需求清单 v4 V4-P0-06: an invoice is issued only for an accepted order worth more than zero (or the inspection fee of
  // a refused quote), and only after finance has checked it — the button is not offered otherwise, and says why.
  const reissue = order.status === "INVOICED" && taxInvoices.length > 0 && taxInvoices.every((x) => x.voidedAt);
  const stage = order.decline ? order.status === "DECLINED" : order.status === "ACCEPTED" || reissue;
  const canIssue0 = !active && mayIssue;
  // 客户拒绝报价: the tax invoice carries the inspection fee, one line per charged machine, instead of the declined quote
  const feeLines = order.decline ? await declineInvoiceLines(no) : null;
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { id: order.entityId } });
  const shown = feeLines ? feeLines.map((l, i) => ({ id: `fee${i}`, lineNo: i + 1, descriptionLocal: l.descriptionLocal, description: l.descriptionEn, qty: 1, unitPrice: l.unitPrice, amount: l.unitPrice }))
    : order.lines.map((l) => ({ id: l.id, lineNo: l.lineNo, descriptionLocal: l.descriptionLocal, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice), amount: Number(l.amount) }));
  const sum = feeLines ? totals(feeLines, Number(entity.vatRate)) : { subtotal: Number(order.subtotal ?? 0), vatAmount: Number(order.vatAmount ?? 0), total: Number(order.total ?? 0) };
  const whyNot = !stage ? "notAccepted" : sum.total <= 0 ? "zero" : null;
  const canIssue = canIssue0 && !whyNot; // first issue, or re-issue after every earlier TITH was voided
  const today = localIso(new Date())!.slice(0, 10);
  const due = localIso(new Date(Date.now() + order.customer.paymentTermDays * 86400000))!.slice(0, 10);
  async function save(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee(); await assertOrderAccess(me, no);
      if (f.get("checked") !== "on") throw new Error("INVOICE_NOT_CHECKED");
      const o = await prisma.serviceOrder.findUniqueOrThrow({ where: { no }, include: { lines: { orderBy: { lineNo: "asc" } }, decline: { select: { id: true } } } });
      const fees = o.decline ? await declineInvoiceLines(no) : null;
      const lines = fees ? fees.map((l, i) => ({ ...l, descriptionLocal: str(f, `th${i}`) ?? l.descriptionLocal }))
        : o.lines.map((l, i) => ({ descriptionLocal: str(f, `th${i}`) ?? l.descriptionLocal ?? "", descriptionEn: l.description, qty: Number(l.qty), unit: l.unit, unitPrice: Number(l.unitPrice) }));
      const missing = lines.findIndex((l) => !l.descriptionLocal);
      if (missing >= 0) throw new Error(`THAI_NAME_REQUIRED:${missing + 1}`);
      const issuedAt = dayNow(str(f, "issuedAt"));
      const ti = await issueTaxInvoice({ serviceOrderNo: no, actorCode: me.code, issuedAt, lines });
      const iv = await issueInvoice({ serviceOrderNo: no, actorCode: me.code, taxInvoiceNo: ti.no, issuedAt });
      return { ok: `${ti.no} · ${iv.no}`, to: `/service-orders/${no}` };
    }, `/service-orders/${no}/invoice`);
  }
  // 开票前成本认可 (朱总 2026-11-18)
  const seeCost = can.invoice(me);
  // 开票即结算 (朱总 2026-11-18 11:59): with a tax invoice standing, what was recognised is frozen and shown as it was
  const frozen = seeCost && !!order.costDetail && (await isSettled(order.id));
  const snap = order.costDetail as unknown as (OrderCost & { lines?: LineCost[]; map?: Record<string, string>; note?: string | null }) | null;
  const cost: OrderCost | null = !seeCost ? null : frozen ? snap : await orderCost(order.id);
  const costOk = frozen || (!!order.costConfirmedAt && !!cost && Math.abs(cost.total - Number(order.costActual ?? 0)) <= 0.005);
  const costLines: LineCost[] = !cost ? [] : frozen || costOk ? snap?.lines ?? [] : await lineCosts(order.id, cost, snap?.map ?? {});
  const choices = cost ? costChoices(cost) : [];
  const openItems = cost && !frozen ? await openCostItems(order) : [];
  async function okCost(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee(); await assertOrderAccess(me, no);
      const map: Record<string, string> = {}; for (const [k, v] of f.entries()) if (k.startsWith("m") && typeof v === "string" && v) map[k.slice(1)] = v;
      await confirmOrderCost({ no, actorCode: me.code, map, note: str(f, "note") }); return "costConfirmed";
    }, `/service-orders/${no}/invoice`);
  }
  async function requestVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await assertOrderAccess(me, no); await requestTaxInvoiceVoid({ taxInvoiceNo: String(f.get("ti")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return "voidRequested"; }, `/service-orders/${no}/invoice`);
  }
  async function decideVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await assertOrderAccess(me, no); await decideTaxInvoiceVoid({ taxInvoiceNo: String(f.get("ti")), actorCode: me.code, decision: f.get("decision") as "APPROVED", note: str(f, "note") }); return f.get("decision") === "APPROVED" ? "voidApproved" : "voidRejected"; }, `/service-orders/${no}/invoice`);
  }
  async function credit(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await assertOrderAccess(me, no); const cn = await issueCreditNote({ taxInvoiceNo: String(f.get("ti")), actorCode: me.code, reason: String(f.get("reason") ?? ""), subtotal: Number(f.get("subtotal")) }); return { ok: cn.no, to: `/service-orders/${no}/invoice` }; }, `/service-orders/${no}/invoice`);
  }
  async function voidCredit(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await assertOrderAccess(me, no); await voidCreditNote({ no: String(f.get("cn")), actorCode: me.code, reason: String(f.get("reason") ?? "") }); return { ok: String(f.get("cn")), to: `/service-orders/${no}/invoice` }; }, `/service-orders/${no}/invoice`);
  }
  async function withdrawVoid(f: FormData) {
    "use server";
    await guarded(async () => { const me = await currentEmployee(); await assertOrderAccess(me, no); await withdrawVoidRequest({ no: String(f.get("docNo")), actorCode: me.code }); return "voidWithdrawn"; }, `/service-orders/${no}/invoice`);
  }
  const voidTag = (x: (typeof taxInvoices)[number]) => x.voidedAt ? <Tag hot>{u("tiVoided")}</Tag> : x.voidStatus === "REQUESTED" ? <Tag hot>{u("tiVoidRequested")}</Tag> : x.voidStatus === "REJECTED" ? <Tag>{u("tiVoidRejected")}</Tag> : <Tag>{u("tiValid")}</Tag>;
  return (
    <StepPage order={order} title={feeLines ? u("step_invoiceFee") : u("step_invoice")} ok={ok === "costConfirmed" ? u("costConfirmed") : ok === "voidWithdrawn" ? u("voidWithdrawn") : ok === "voidRequested" ? u("tiVoidRequested") : ok === "voidApproved" ? u("tiVoided") : ok === "voidRejected" ? u("tiVoidRejected") : ok} error={error} saveLabel={businessClosureOn() && canIssue && costOk ? u("issueTiIv") : ""} notice={businessClosureOn() ? undefined : u("closureOffNotice")}>
      {taxInvoices.length > 0 && (
        <Card title={<>{u("taxInvoicesIssued")} <Tag>{taxInvoices.length}</Tag></>}>
          <Table head={["TITH", u("bookNo"), u("issueDate"), t("total"), "IVTH", t("status"), u("voidReason"), ""]}>
            {taxInvoices.map((x) => (
              <tr key={x.id} className={x.voidedAt ? "text-navy/50 line-through" : ""}>
                <td className="font-mono"><a className="text-blue hover:underline" href={`/api/documents/${x.no}/render?format=pdf`}>{x.no}</a></td>
                <td className="font-mono text-xs">{x.bookNo ? `${x.bookNo} / ${x.bookSeq}` : "—"}</td>
                <td>{localIso(x.issuedAt)!.slice(0, 10)}</td><td>{x.currency} {Number(x.total).toFixed(2)}</td>
                <td className="font-mono text-xs">{x.invoices.map((i) => <span key={i.no} className={`block ${i.cancelledAt ? "line-through" : ""}`}>{i.no}</span>)}</td>
                <td className="no-underline">{voidTag(x)}</td>
                <td className="text-xs">{x.voidRequestReason ?? ""}{x.voidDecisionNote ? <span className="block text-navy/60">MD: {x.voidDecisionNote}</span> : null}</td>
                <td className="space-y-1 text-xs no-underline">
                  {!x.voidedAt && x.voidStatus !== "REQUESTED" && <details><summary className={`${btnGhost} inline-flex cursor-pointer items-center whitespace-nowrap`}>{u("voidBtn")}</summary>
                    <form action={requestVoid} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="ti" value={x.no} /><input name="reason" required placeholder={u("voidReason")} className={`${inputCls} w-44`} /><button className={`${btnGhost} whitespace-nowrap`}>{u("requestVoid")}</button></form></details>}
                  {!x.voidedAt && mayCredit && <details><summary className={`${btnGhost} inline-flex cursor-pointer items-center whitespace-nowrap`}>{u("creditBtn")}</summary>
                    <form action={credit} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="ti" value={x.no} /><input name="subtotal" type="number" step="0.01" min="0.01" inputMode="decimal" required placeholder={u("creditAmountPh")} className={`${inputCls} w-40`} /><input name="reason" required placeholder={u("creditReason")} className={`${inputCls} w-44`} /><button className={`${btnGhost} whitespace-nowrap`}>{u("creditIssue")}</button></form></details>}
                  {x.voidStatus === "REQUESTED" && hasRole(me, "MD") && <form action={decideVoid} className="flex flex-wrap gap-1"><input type="hidden" name="ti" value={x.no} /><input name="note" placeholder={t("note")} className={`${inputCls} w-36`} /><button name="decision" value="APPROVED" className="min-h-10 whitespace-nowrap rounded-lg border border-alert px-3 text-sm font-semibold text-alert-ink">{u("approveVoid")}</button><button name="decision" value="REJECTED" className={`${btnGhost} whitespace-nowrap`}>{u("rejectVoid")}</button></form>}
                  {x.voidStatus === "REQUESTED" && !hasRole(me, "MD") && <span className="text-navy/60">{u("awaitingMd")}</span>}
                  {x.voidStatus === "REQUESTED" && !x.voidedAt && (x.voidRequestedById === me.id || can.invoice(me)) && <form action={withdrawVoid}><input type="hidden" name="docNo" value={x.no} /><button className="text-xs text-blue underline">{u("voidWithdraw")}</button></form>}
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-navy/70">{u("voidRules")}</p>
          {taxInvoices.some((x) => x.creditNotes.length > 0) && <Table head={["CNTH", "TITH", u("issueDate"), u("creditAmount"), t("total"), u("creditReason"), ""]}>
            {taxInvoices.flatMap((x) => x.creditNotes.map((c) => <tr key={c.id} className={c.voidedAt ? "text-navy/50 line-through" : ""}>
              <td className="font-mono">{c.no}</td><td className="font-mono text-xs">{x.no}</td><td>{localIso(c.issuedAt)!.slice(0, 10)}</td><td className="text-right">−{Number(c.subtotal).toFixed(2)}</td><td className="text-right">−{c.currency} {Number(c.total).toFixed(2)}</td><td className="text-xs">{c.reason}{c.voidReason ? ` · ${u("tiVoided")}: ${c.voidReason}` : ""}</td>
              <td className="no-underline">{c.voidedAt ? <Tag hot>{u("tiVoided")}</Tag> : hasRole(me, "MD") ? <details><summary className={`${btnGhost} inline-flex cursor-pointer items-center whitespace-nowrap`}>{u("voidBtn")}</summary><form action={voidCredit} className="mt-1 flex flex-wrap gap-1"><input type="hidden" name="cn" value={c.no} /><input name="reason" required placeholder={u("voidReason")} className={`${inputCls} w-44`} /><button className={`${btnGhost} whitespace-nowrap`}>{u("approveVoid")}</button></form></details> : null}</td></tr>))}
          </Table>}
        </Card>
      )}
      {businessClosureOn() && !liveNumbers() && <Alert>{u("testSeriesNotice")}</Alert>}
      {!mayIssue && !active && <Alert>{u(stage ? "invoiceByFinance" : "invoiceNotYet")}</Alert>}
      {mayIssue && !active && whyNot && <Alert>{u(`invoiceWhyNot_${whyNot}`)}</Alert>}
      {active && <Alert>{u("tiExistsNotice", { no: active.no })}</Alert>}
      {cost && (frozen || (!active && stage)) && <div id="cost" className="scroll-mt-20"><Card title={<>{u("costCard")} {frozen ? <Tag>{u("costFrozenTag")}</Tag> : null} {costOk ? <Tag>{u("costOkTag", { by: order.costConfirmedBy ?? "", at: localIso(order.costConfirmedAt!)!.slice(0, 16).replace("T", " ") })}</Tag> : <Tag hot>{order.costConfirmedAt ? u("costChangedTag") : u("costWaitTag")}</Tag>}</>} accent={!costOk}>
        <p className="mb-2 text-sm">{u("costSay")}</p>
        <Table head={[u("costKind"), u("costRef"), u("costWhat"), t("qty"), u("unitCost"), t("amount")]}>
          {([["costParts", cost.parts], ["costPurchases", cost.purchases], ["costLabour", cost.labour], ["costExpenses", cost.expenses]] as const).flatMap(([k, rows]) => rows.map((r, i) => <tr key={`${k}${i}`}>
            <td className="whitespace-nowrap">{u(k)}</td><td className="whitespace-nowrap font-mono text-xs">{r.ref}</td><td>{r.what}{r.note ? <span className="block text-xs text-navy/60">{r.note}</span> : null}</td>
            <td className="whitespace-nowrap tabular-nums">{r.qty} {r.unit}</td><td className={`text-right tabular-nums ${r.unitCost == null ? "font-semibold text-alert-ink" : ""}`}>{r.unitCost == null ? u("costNone") : r.unitCost.toFixed(2)}</td><td className="text-right tabular-nums">{r.amount.toFixed(2)}</td></tr>))}
          {cost.total === 0 && <tr><td colSpan={6} className="text-navy/60">{u("costEmpty")}</td></tr>}
        </Table>
        <p className="mt-2 text-right text-[13px]">{u("costParts")} {cost.partsTotal.toFixed(2)} · {u("costPurchases")} {cost.purchasesTotal.toFixed(2)} · {u("costLabour")} {cost.labourTotal.toFixed(2)}（{cost.hours} h）· {u("costExpenses")} {cost.expensesTotal.toFixed(2)}</p>
        <p className="text-right text-sm"><b>{u("costActualTotal")} {order.currency} {cost.total.toFixed(2)}</b> · {u("costQuoted")} {order.costTotal != null ? Number(order.costTotal).toFixed(2) : "—"} · {u("costRealMargin")} {sum.subtotal > 0 ? `${(((sum.subtotal - cost.total) / sum.subtotal) * 100).toFixed(1)}%` : "—"}</p>
        {cost.missing.length > 0 && <Alert>{u("costMissing", { list: cost.missing.join("、") })}</Alert>}
        {openItems.length > 0 && <Alert>{u("costOpenItems", { list: openItems.join("、") })}</Alert>}
        {snap?.note && costOk && <p className="mt-1 text-xs text-navy/70">{u("costNoteWas")}：{snap.note}</p>}
        <form action={okCost} data-nodraft className="mt-3">
          <h3 className="mb-1 text-sm font-semibold">{u("costByLine")}</h3>
          <Table head={["#", u("costWhat"), u("costQuotedCol"), "", u("costRealCol"), u("costSrcCol")]}>
            {costLines.map((l) => <tr key={l.lineNo} className={l.est && l.real == null ? "bg-[#FFF5F4]" : ""}>
              <td>{l.lineNo}</td><td>{l.description}{l.est ? <span className="ml-1 whitespace-nowrap rounded bg-[#E5E9EF] px-1.5 py-0.5 text-[11px] text-navy/70">{u("estTag")}</span> : null}</td>
              <td className="whitespace-nowrap text-right tabular-nums">{l.quoted != null ? l.quoted.toFixed(2) : "—"}</td><td>→</td>
              <td className={`whitespace-nowrap text-right tabular-nums ${l.real == null ? "font-semibold text-[#C0392B]" : ""}`}>{l.real != null ? l.real.toFixed(2) : u("costNotReplaced")}</td>
              <td>{l.est && !costOk ? <select name={`m${l.lineNo}`} defaultValue={l.choice ?? ""} className={`${inputCls} min-w-40`}><option value="">{u("costPick")}</option>{choices.map((x) => <option key={x.id} value={x.id}>{x.id === "none" ? u("costChoiceNone") : x.id === "labour" ? `${u("costLabour")} · ${x.label} = ${x.amount.toFixed(2)}` : `${x.label} = ${x.amount.toFixed(2)}`}</option>)}</select> : l.source === "SYSTEM" ? u("costSrcSystem") : l.choice === "none" ? u("costChoiceNone") : l.source}</td></tr>)}
          </Table>
          {!costOk && cost.missing.length > 0 && <div className="mt-2"><Field label={u("costGapNote")} required><input name="note" required className={inputCls} /></Field></div>}
          {!costOk && <button className="mt-2 min-h-11 rounded-lg bg-navy px-4 text-sm font-semibold text-white">{u("costOkBtn")}</button>}
        </form>
        {/* 成本决算的入口 (朱总 2026-11-28): a cost that is not in the system yet is put in from here, then chosen above */}
        {!costOk && !frozen && <div className="mt-3 rounded-lg border border-hair bg-[#F6F8FB] p-3 text-sm">
          <p className="font-semibold">{u("costAddTitle")}</p>
          <p className="mt-1 text-navy/75">{u("costAddHint")}</p>
          <p className="mt-2 flex flex-wrap gap-2"><Link href={`/finance/expenses/new?order=${order.no}`} className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-navy/45 bg-white px-3 font-semibold">{u("costAddExpense")} →</Link><Link href="/finance/expenses" className="inline-flex min-h-10 items-center whitespace-nowrap rounded-lg border border-navy/45 bg-white px-3 font-semibold">{u("costApproveExpense")} →</Link></p>
        </div>}
      </Card></div>}
      {canIssue && taxInvoices.length > 0 && <Alert>{u("tiReissueNotice")}</Alert>}
      {canIssue && <form id="f" action={save} className="space-y-4">
        <label className="flex items-start gap-2 rounded-lg border border-[#E6A23C] bg-[#FFF4E5] p-3 text-sm text-[#7A4A00]"><input type="checkbox" name="checked" required className="mt-1" /><span>{u("invoiceDraftCheck", { total: sum.total.toFixed(2), customer: order.customer.name })}</span></label>
        <Card title={u("taxInvoiceTi")}>
          <Grid>
            <Field label={u("buyer")}><Value>{order.customer.nameLocal ?? order.customer.name} · {t("taxId")} {order.customer.taxId ?? "—"} · {t("branch")} {order.customer.branchCode ?? "—"}</Value></Field>
            <Field label={u("issueDate")}><input name="issuedAt" type="date" defaultValue={today} className={inputCls} /></Field>
            <Field label={t("currency")}><Value>{order.currency}</Value></Field>
          </Grid>
          <Table head={["#", u("descThRequired"), u("descEn"), t("qty"), t("price"), t("amount")]}>
            {shown.map((l, i) => <tr key={l.id}><td>{l.lineNo}</td><td><input name={`th${i}`} required defaultValue={l.descriptionLocal ?? ""} className={inputCls} /></td><td>{l.description}</td><td>{l.qty}</td><td className="text-right">{l.unitPrice.toFixed(2)}</td><td className="text-right">{l.amount.toFixed(2)}</td></tr>)}
          </Table>
          <p className="text-right text-[13px]">{t("subtotal")} {sum.subtotal.toFixed(2)} · {t("vat")} {sum.vatAmount.toFixed(2)} · <b>{t("total")} {sum.total.toFixed(2)}</b>{fx ? ` · CNY ${(sum.total * Number(fx.rateToCny)).toFixed(2)} @${Number(fx.rateToCny).toFixed(4)} （${fxMark(u, fx.source, fx.rateDate, fxFields(fx).fxBy)}）` : ""}</p>
        </Card>
        <Card title={u("invoiceIv")}>
          <Grid>
            <Field label={u("dueDate")}><Value>{due} ({t("termDays")} {order.customer.paymentTermDays})</Value></Field>
            <Field label={u("receivable")}><Value>{order.currency} {sum.total.toFixed(2)}</Value></Field>
            <Field label={u("monthlyCustomer")}><Value>{order.customer.monthlyStatement ? u("yesIntoBl") : u("no")}</Value></Field>
          </Grid>
        </Card>
      </form>}
    </StepPage>
  );
}
