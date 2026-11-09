import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { advanceServiceOrder, createServiceOrder } from "@/server/slm";
import { currentEmployee } from "@/server/auth";
import { saveUpload } from "@/lib/uploads";
import { guarded } from "@/lib/action-result";
import { maskName } from "@/lib/mask";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { FormMemory } from "@/components/FormMemory";
import { AssetPicker } from "@/components/AssetPicker";
import { ScanButton } from "@/components/ScanButton";
import { Card, Field, Grid, PageHeader, Table, btnGhost, btnPrimary, inputCls } from "@/components/ui";
import { ModeCards } from "@/components/ModeCards";
import { MODES, MODE_KINDS, OPEN_MODES, isTradeMode, modeNeedsAsset, type Mode } from "@/lib/modes";
import { modeRules } from "@/server/modes";

export const dynamic = "force-dynamic";

/** 新建业务单 — the business mode first (mockup business-modes-v0.1, 2026-11-09), then the fields that mode needs (wireframe 4). */
export default async function NewOrder({ searchParams }: { searchParams: Promise<{ asset?: string; customer?: string; error?: string; mode?: string }> }) {
  const { asset, customer, error, mode: askedMode } = await searchParams;
  const initialMode: Mode = OPEN_MODES.includes(askedMode as Mode) ? (askedMode as Mode) : "REPAIR";
  const floors = await modeRules();
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const [assets, engineers, contacts] = await Promise.all([
    prisma.asset.findMany({ where: { status: { not: "RETIRED" }, customer: customer ? { code: customer } : undefined }, include: { customer: true, plant: true, model: true }, orderBy: { code: "asc" } }),
    prisma.employee.findMany({ where: { active: true, role: isTradeMode(askedMode) ? undefined : { in: ["ENGINEER", "MANAGER", "MD", "ADMIN"] } }, orderBy: { name: "asc" } }),
    prisma.contact.findMany({ include: { customer: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const trade = isTradeMode(initialMode);
  // 贸易: customer + SKU lines; the datalist shows what is on the shelf
  const [customers, parts, stock] = trade ? await Promise.all([
    prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true } }),
    prisma.part.findMany({ orderBy: { sku: "asc" }, take: 800, select: { id: true, sku: true, name: true } }),
    prisma.stockMovement.groupBy({ by: ["partId", "direction"], where: { partId: { not: null } }, _sum: { qty: true } }),
  ]) : [[], [], []];
  const onHand = new Map<string, number>();
  for (const g of stock) onHand.set(g.partId!, (onHand.get(g.partId!) ?? 0) + (g.direction === "IN" ? 1 : -1) * Number(g._sum.qty ?? 0));
  const TRADE_ROWS = 8;

  async function submit(form: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const s = (k: string) => String(form.get(k) ?? "").trim() || undefined;
      const mode = (s("mode") ?? "REPAIR") as Mode;
      const codes = [...new Set(form.getAll("assetCodes").map(String).filter(Boolean))];
      if (modeNeedsAsset(mode) && !codes.length) throw new Error("ASSET_REQUIRED");
      const first = codes.length ? await prisma.asset.findUniqueOrThrow({ where: { code: codes[0] } }) : null;
      const customerId = first?.customerId ?? s("customerId");
      if (!customerId) throw new Error("INVALID_INPUT:customer");
      const boxed = JSON.parse(s("attachments") ?? "[]") as { name: string; url: string; kind: string }[];
      const po = [];
      for (const f of form.getAll("poFiles")) if (f instanceof File && f.size > 0) po.push({ ...(await saveUpload(f, "po")), name: f.name, kind: "PO" });
      const order = await createServiceOrder({
        createdByEmployeeCode: me.code, customerId, plantId: first?.plantId ?? undefined, assetCodes: codes,
        requestLines: Array.from({ length: 12 }, (_, i) => ({ sku: s(`ls${i}`), description: s(`ld${i}`), qty: Number(s(`lq${i}`) ?? 0), unit: s(`lu${i}`), neededBy: s(`ln${i}`) })),
        mode, kind: s("kind") as "REPAIR" | undefined, partnerReason: s("partnerReason"), reportedSymptom: s("reportedSymptom"), reportedAlarm: s("reportedAlarm"), productionImpact: s("productionImpact"),
        customerRef: s("customerRef"), reportedByContactId: s("reportedById"), reportedAt: s("reportedAt") ? new Date(s("reportedAt")!) : undefined,
        currency: "THB", attachments: [...boxed, ...po],
      });
      if (form.get("assign") && s("assigneeCode")) {
        await advanceServiceOrder(order.no, "ASSIGNED", me.code, [s("plannedAt") ? `📅 ${s("plannedAt")!.replace("T", " ")}` : "", s("internalNote") ?? ""].filter(Boolean).join(" · ") || undefined, s("assigneeCode"));
      }
      return { ok: order.no, to: `/service-orders/${order.no}` };
    }, "/service-orders/new");
  }

  const pick = assets.map((a) => ({ code: a.code, serial: a.serialNumber, location: a.location ?? "", customer: a.customer?.name ?? "", plant: a.plant ? `${a.plant.code} ${a.plant.name}` : "", label: `${a.code} · ${a.location ?? ""} · ${a.customer?.name ?? ""}${a.plant ? ` ${a.plant.code}` : ""} · S/N ${a.serialNumber}` }));
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/service-orders", label: u("backToOrders") }} title={u("newServiceOrder")}
        actions={<><Link href="/service-orders" className={btnGhost}>{t("cancel")}</Link><button form="f" name="assign" value="1" className={btnGhost}>{u("saveAndAssign")}</button><button form="f" className={btnPrimary}>{t("save")}</button></>} />
      <Flash error={error === "ASSET_REQUIRED" ? u("assetRequired") : error} />
      <FormMemory formId="f" />
      <Card title={u("businessMode")}>
        <ModeCards form="f" initial={initialMode} inputCls={inputCls}
          cards={MODES.map((m) => ({ mode: m, name: u(`mode_${m}`), sub: u(`modeSub_${m}`), desc: u(`modeDesc_${m}`), floor: u("marginFloorTag", { pct: Math.round(floors[m] * 100) }), assetNote: u(modeNeedsAsset(m) ? (m === "MAINTENANCE" ? "modeAssetMany" : m === "AUTOMATION_PROJECT" ? "modeAssetTbd" : "modeAsset") : "modeSkuOnly"), open: OPEN_MODES.includes(m) }))}
          kinds={MODE_KINDS.MAINTENANCE.map((k) => ({ value: k, label: t(k) }))}
          labels={{ kind: u("maintenanceKind"), reason: u("partnerReason"), reasonPh: u("partnerReasonPh"), soon: u("modeComingSoon") }} />
      </Card>
      <UploadRecognize kind="service" formId="f" title={u(trade ? "upTradeTitle" : "upServiceTitle")} hint={u(trade ? "upTradeHint" : "upServiceHint")} />
      <form id="f" action={submit} className="space-y-4">
{trade ? (<>
        <Card title={u("customerAndInquiry")}>
          <Grid>
            <Field label={t("customer")} required><select name="customerId" required defaultValue={customers.find((c) => c.code === customer)?.id ?? ""} className={inputCls}><option value="">—</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}</select></Field>
            <Field label={u("inquiryContact")}><select name="reportedById" className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)} · {c.customer.name}</option>)}</select></Field>
            <Field label={u("customerInquiryRef")}><input name="customerRef" className={`${inputCls} font-mono`} /></Field>
            <Field label={u("inquiryDate")}><input name="reportedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
          </Grid>
          <Field label={u("inquiryFiles")}><input name="poFiles" type="file" multiple accept="image/*,application/pdf" className={inputCls} /></Field>
        </Card>
        <Card title={u("itemLines")}>
          <datalist id="trade-parts">{parts.map((p) => <option key={p.id} value={p.sku}>{p.name} · {u("onHand", { n: onHand.get(p.id) ?? 0 })}</option>)}</datalist>
          <Table head={["#", u("partSku"), t("description"), t("qty"), u("unitShort"), u("neededBy")]}>
            {Array.from({ length: TRADE_ROWS }, (_, i) => (
              <tr key={i}>
                <td className="w-8 text-navy/60">{i + 1}</td>
                <td><input name={`ls${i}`} list="trade-parts" className={`${inputCls} font-mono`} /></td>
                <td><input name={`ld${i}`} className={inputCls} /></td>
                <td className="w-24"><input name={`lq${i}`} type="number" min={0} step="0.001" required={i === 0} className={inputCls} /></td>
                <td className="w-20"><input name={`lu${i}`} defaultValue="pcs" className={inputCls} /></td>
                <td className="w-40"><input name={`ln${i}`} type="date" className={inputCls} /></td>
              </tr>
            ))}
          </Table>
          <p className="text-xs text-navy/70">{u("itemLinesHint")}</p>
        </Card>
        </>) : (<>
        <Card title={u("whichAsset")}>
          <AssetPicker formId="f" assets={pick} initial={asset ? [asset] : []} labels={{ asset: t("asset"), customer: u("customerAuto"), plant: u("plantAuto"), add: u("addAnotherAsset") }} />
          <div className="flex flex-wrap items-center gap-2">
            <ScanButton compact label={u("scanDcitLabel")} hrefTemplate="/service-orders/new?asset={code}" />
            <Link href="/assets/new" className="text-sm text-blue underline">{u("assetNotListed")}</Link>
          </div>
        </Card>
        <Card title={u("reportContent")}>
          <Grid>
            <Field label={t("alarmCode")}><input name="reportedAlarm" className={`${inputCls} font-semibold text-fault`} /></Field>
            <Field label={t("impact")} required><select name="productionImpact" className={inputCls}><option value="STOPPED">{u("impactStopped")}</option><option value="DEGRADED">{u("impactDegraded")}</option><option value="NONE">{u("impactNone")}</option></select></Field>
          </Grid>
          <Field label={t("symptom")} required><textarea name="reportedSymptom" required rows={2} className={`${inputCls} font-semibold text-fault`} /></Field>
          <Grid>
            <Field label={u("customerRefVerbatim")}><input name="customerRef" className={`${inputCls} font-mono`} /></Field>
            <Field label={u("reportedBy")}><select name="reportedById" className={inputCls}><option value="">—</option>{contacts.map((c) => <option key={c.id} value={c.id}>{maskName(c.name)} · {c.customer.name}</option>)}</select></Field>
            <Field label={t("reportedAt")}><input name="reportedAt" type="datetime-local" defaultValue={now} className={inputCls} /></Field>
          </Grid>
          <Field label={u("poAttachments")}><input name="poFiles" type="file" multiple accept="image/*,application/pdf" className={inputCls} /></Field>
        </Card>
        </>)}
        <Card title={u(trade ? "orderOwner" : "dispatch")}>
          <Grid>
            <Field label={t("assignee")}><select name="assigneeCode" className={inputCls}><option value="">—</option>{engineers.map((e) => <option key={e.id} value={e.code}>{e.code} {e.name}</option>)}</select></Field>
            {!trade && <Field label={u("plannedVisit")}><input name="plannedAt" type="datetime-local" className={inputCls} /></Field>}
            <Field label={u("internalNote")}><input name="internalNote" className={inputCls} /></Field>
          </Grid>
        </Card>
      </form>
    </div>
  );
}
