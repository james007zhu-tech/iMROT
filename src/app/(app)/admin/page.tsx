import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { saveLegalEntity } from "@/server/opd";
import { refreshBocRates } from "@/server/fx";
import { modeRules, setModeRules } from "@/server/modes";
import { MODES, DEFAULT_MARGIN_FLOOR, type Mode } from "@/lib/modes";
import { guarded } from "@/lib/action-result";
import { entityLabel } from "@/lib/entity";
import { bankAccounts, bankCurrencies, bankLines, type BankDetails } from "@/lib/bank";
import { Flash } from "@/components/Flash";
import { UploadRecognize } from "@/components/UploadRecognize";
import { Card, Field, Grid, PageHeader, Table, btnGhost, btnPrimary, inputCls } from "@/components/ui";

export const dynamic = "force-dynamic";
type Entity = Awaited<ReturnType<typeof prisma.legalEntity.findMany>>[number];

/** Admin: legal entities (MD edits, others read), Bank of China rates, running number counters. */
export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const [t, u] = await Promise.all([getTranslations("common"), getTranslations("ui")]);
  const me = await currentEmployee();
  const [entities, rates, seqs] = await Promise.all([
    prisma.legalEntity.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.fxRate.findMany({ orderBy: [{ rateDate: "desc" }, { currency: "asc" }], take: 40 }),
    prisma.docSequence.findMany({ orderBy: [{ prefix: "asc" }, { period: "desc" }], take: 100, include: { entity: true } }),
  ]);
  const md = me.role === "MD"; // legal entities: MD only (decision 2026-11-03)
  const floors = await modeRules();
  async function saveFloors(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      await setModeRules({ actorCode: me.code, floors: Object.fromEntries(MODES.map((m) => [m, Number(f.get(`floor_${m}`)) / 100])) as Record<Mode, number> });
      return "OK";
    }, "/admin");
  }
  async function fetchRates() {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      if (!["MD", "ADMIN", "MANAGER"].includes(me.role)) throw new Error("FORBIDDEN");
      try { const r = await refreshBocRates(); return `${r.rateDate} · ${r.count}`; } catch (e) { throw new Error(`FX_FETCH_FAILED:${(e as Error).message}`); }
    }, "/admin");
  }
  async function saveEntity(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      const s = (k: string) => String(f.get(k) ?? "").trim() || undefined;
      const e = await saveLegalEntity({ actorCode: me.code, countryCode: String(f.get("countryCode") ?? "").trim().toUpperCase(), code: String(f.get("code") ?? "").trim(), nameEn: String(f.get("nameEn") ?? "").trim(), nameLocal: s("nameLocal"), taxId: s("taxId"), branchCode: s("branchCode"), addressEn: s("addressEn"), addressLocal: s("addressLocal"), phone: s("phone"), email: s("email"), website: s("website"), signatoryName: s("signatoryName"), localCurrency: String(f.get("localCurrency") || "THB").trim().toUpperCase(), vatRate: Number(f.get("vatPct") ?? 7) / 100, taxInvoiceBookSize: f.get("taxInvoiceBookSize") ? Number(f.get("taxInvoiceBookSize")) : undefined, vatRegisteredFrom: s("vatRegisteredFrom"), bankDetails: bankFrom(f) });
      return e.code;
    }, "/admin");
  }
  const form = (e: Entity | null) => {
    const id = e ? `e_${e.countryCode}` : "e_new";
    return (
      <form id={id} action={saveEntity} className="space-y-3">
        <Grid>
          <Field label={u("countryCode")} required><input name="countryCode" defaultValue={e?.countryCode ?? ""} placeholder="VN" readOnly={!!e} required maxLength={2} className={`${inputCls} font-mono ${e ? "bg-tint" : ""}`} /></Field>
          <Field label={u("entityCode")} required><input name="code" defaultValue={e?.code ?? ""} placeholder="DCiV" required className={`${inputCls} font-mono`} /></Field>
          <Field label={t("nameEn")} required><input name="nameEn" defaultValue={e?.nameEn ?? ""} required className={inputCls} /></Field>
          <Field label={t("nameLocal")}><input name="nameLocal" defaultValue={e?.nameLocal ?? ""} className={inputCls} /></Field>
          <Field label={t("taxId")}><input name="taxId" defaultValue={e?.taxId ?? ""} className={`${inputCls} font-mono`} /></Field>
          <Field label={t("branch")}><input name="branchCode" defaultValue={e?.branchCode ?? ""} className={`${inputCls} font-mono`} /></Field>
          <Field label={t("localCcy")} required><input name="localCurrency" defaultValue={e?.localCurrency ?? ""} placeholder="VND" required maxLength={3} className={`${inputCls} font-mono`} /></Field>
          <Field label={t("bookCcy")}><div className="min-h-10 rounded-md border bg-tint px-2.5 py-2 text-sm">CNY</div></Field>
          <Field label={u("vatPct")} required><input name="vatPct" type="number" step="0.01" min={0} max={100} defaultValue={e ? pct(e.vatRate) : ""} required className={inputCls} /></Field>
          <Field label={u("vatRegisteredFrom")}><input name="vatRegisteredFrom" type="date" defaultValue={e?.vatRegisteredFrom ? e.vatRegisteredFrom.toISOString().slice(0, 10) : ""} className={inputCls} /></Field>
          <Field label={u("taxInvoiceBookSize")}><input name="taxInvoiceBookSize" type="number" min={1} max={1000} defaultValue={e?.taxInvoiceBookSize ?? 50} className={inputCls} /><p className="mt-1 text-xs text-navy/60">{u("taxInvoiceBookHint")}</p></Field>
          <Field label={t("addressEn")} className="md:col-span-3"><input name="addressEn" defaultValue={e?.addressEn ?? ""} className={inputCls} /></Field>
          <Field label={t("addressLocal")} className="md:col-span-3"><input name="addressLocal" defaultValue={e?.addressLocal ?? ""} className={inputCls} /></Field>
          <Field label={t("phone")}><input name="phone" defaultValue={e?.phone ?? ""} className={inputCls} /></Field>
          <Field label={t("email")}><input name="email" defaultValue={e?.email ?? ""} className={inputCls} /></Field>
          <Field label={t("website")}><input name="website" defaultValue={e?.website ?? ""} className={inputCls} /></Field>
          <Field label={t("signatory")}><input name="signatoryName" defaultValue={e?.signatoryName ?? ""} className={inputCls} /></Field>
        </Grid>
        {bankFields(e)}
        <div className="flex justify-end"><button className={btnPrimary}>{e ? t("save") : u("newEntity")}</button></div>
      </form>
    );
  };
  /** 收款银行: one bank, one account per currency — printed on invoices and tax invoices (invoice currency + THB). */
  const bankFields = (e: Entity | null) => {
    const b = e?.bankDetails as BankDetails | null | undefined;
    const acc = bankAccounts(b);
    return (
      <fieldset className="space-y-2 rounded-lg border border-dashed px-3 pb-3 pt-1">
        <legend className="px-1 text-sm font-semibold text-navy">{u("bankSection")}</legend>
        <Grid>
          <Field label={u("bankName")}><input name="bank" defaultValue={b?.bank ?? ""} placeholder="BANK OF CHINA (THAI) PCL" className={inputCls} /></Field>
          <Field label={u("bankBranch")}><input name="bankBranch" defaultValue={b?.branch ?? ""} placeholder="RAYONG BRANCH" className={inputCls} /></Field>
          <Field label={u("bankSwift")}><input name="swift" defaultValue={b?.swift ?? ""} placeholder="BKCHTHBKXXX" maxLength={11} className={`${inputCls} font-mono uppercase`} /></Field>
          <Field label={u("bankCode")}><input name="bankCode" defaultValue={b?.bankCode ?? ""} placeholder="052" className={`${inputCls} font-mono`} /></Field>
          <Field label={u("bankBranchCode")}><input name="bankBranchCode" defaultValue={b?.branchCode ?? ""} placeholder="0003" className={`${inputCls} font-mono`} /></Field>
          <Field label={u("bankAccountName")}><input name="accountName" defaultValue={b?.accountName ?? ""} className={inputCls} /></Field>
          {bankCurrencies(e?.localCurrency ?? "THB", b).map((c) => (
            <Field key={c} label={`${u("bankAccountNo")} ${c}`}><input name={`acc_${c}`} defaultValue={acc[c] ?? ""} inputMode="numeric" className={`${inputCls} font-mono`} /></Field>
          ))}
          <Field label={u("bankAccountOther")}><div className="flex gap-1"><input name="accOtherCcy" placeholder="JPY" maxLength={3} className={`${inputCls} w-20 font-mono uppercase`} /><input name="accOtherNo" className={`${inputCls} font-mono`} /></div></Field>
        </Grid>
        <p className="text-xs text-navy/60">{u("bankHint")}</p>
      </fieldset>
    );
  };
  const view = (e: Entity) => (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
      {([[t("nameEn"), e.nameEn], [t("nameLocal"), e.nameLocal], [t("taxId"), e.taxId], [t("branch"), e.branchCode], [t("localCcy"), e.localCurrency], [u("vatPct"), `${pct(e.vatRate)}%`], [u("taxInvoiceBookSize"), String(e.taxInvoiceBookSize)], [t("addressEn"), e.addressEn], [t("phone"), e.phone], [t("signatory"), e.signatoryName]] as [string, string | null][]).map(([k, v]) => <div key={k}><dt className="text-xs text-navy/70">{k}</dt><dd>{v || "—"}</dd></div>)}
      <div className="md:col-span-3"><dt className="text-xs text-navy/70">{u("bankSection")}</dt><dd className="whitespace-pre-line font-mono text-xs">{bankLines(e.bankDetails as BankDetails | null) || "—"}</dd></div>
    </dl>
  );
  return (
    <div className="space-y-4">
      <PageHeader title={t("nav_admin")} newHref={md ? "#new-entity" : undefined} newLabel={u("newEntity")} />
      <Flash ok={ok} error={error} />
      <Card title={t("legalEntities")}>
        <div className="space-y-2">
          {entities.map((e) => (
            <details key={e.id} className="rounded-lg border px-3 py-2" open={entities.length === 1}>
              <summary className="cursor-pointer text-sm font-semibold text-navy">{entityLabel(e, u)}{!e.taxId && <span className="ml-2 text-xs font-normal text-alert-ink">{u("entityIncomplete")}</span>}{e.taxId && !bankLines(e.bankDetails as BankDetails | null) && <span className="ml-2 text-xs font-normal text-alert-ink">{u("entityNoBank")}</span>}</summary>
              <div className="pt-3">{md ? form(e) : view(e)}</div>
            </details>
          ))}
        </div>
      </Card>
      {md && (
        <section id="new-entity" className="space-y-3">
          <UploadRecognize kind="entity" formId="e_new" title={u("upEntityTitle")} hint={u("upEntityHint")} />
          <Card title={u("newEntity")}>{form(null)}</Card>
        </section>
      )}
      <Card title={u("modeFloors")}>
        <form action={saveFloors} className="space-y-3">
          <Table head={[u("businessMode"), u("marginFloorCol"), u("decidedDefault")]}>
            {MODES.map((m) => <tr key={m}><td>{u(`mode_${m}`)}</td>
              <td>{md ? <span className="flex items-center gap-1"><input name={`floor_${m}`} type="number" min={0} max={99} step="0.5" required defaultValue={Math.round(floors[m] * 1000) / 10} className={`${inputCls} w-24!`} />%</span> : `${Math.round(floors[m] * 1000) / 10}%`}</td>
              <td className="text-navy/70">{Math.round(DEFAULT_MARGIN_FLOOR[m] * 100)}%</td></tr>)}
          </Table>
          <p className="text-xs text-navy/70">{u("modeFloorsHint")}</p>
          {md && <div className="flex justify-end"><button className={btnPrimary}>{t("save")}</button></div>}
        </form>
      </Card>
      <Card title={t("bocRates")}>
        <form action={fetchRates} className="flex flex-wrap items-center gap-3"><button className={btnGhost}>{u("fxFetchNow")}</button><span className="text-xs text-navy/70">{u("fxAutoNote")}</span></form>
        <Table head={[t("date"), t("currency"), t("rate"), t("published")]}>
          {rates.map((r) => <tr key={r.id}><td>{r.rateDate.toISOString().slice(0, 10)}</td><td className="font-mono">{r.currency}</td><td className="font-mono">{Number(r.rateToCny).toFixed(6)}</td><td>{r.publishedAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""}</td></tr>)}
          {rates.length === 0 && <tr><td colSpan={4} className="text-alert-ink">{t("noRates")}</td></tr>}
        </Table>
      </Card>
      <Card title={t("counters")}>
        <Table head={[t("entity"), t("prefix"), t("period"), t("last")]}>
          {seqs.map((x) => <tr key={x.id}><td>{x.entity.code} · {x.entity.countryCode}</td><td className="font-mono">{x.prefix}</td><td className="font-mono">{x.period}</td><td>{x.last}</td></tr>)}
        </Table>
      </Card>
    </div>
  );
}
/** 0.07 → 7 (no 7.000000000000001). */
const pct = (rate: unknown) => Math.round(Number(rate) * 10000) / 100;

/** The bank block of the entity form → BankDetails (accounts from acc_<CCY> and the "other currency" pair). */
function bankFrom(f: FormData): BankDetails {
  const s = (k: string) => String(f.get(k) ?? "");
  const accounts: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith("acc_") && typeof v === "string") accounts[k.slice(4)] = v;
  if (s("accOtherCcy").trim() && s("accOtherNo").trim()) accounts[s("accOtherCcy")] = s("accOtherNo");
  return { bank: s("bank"), branch: s("bankBranch"), bankCode: s("bankCode"), branchCode: s("bankBranchCode"), accountName: s("accountName"), swift: s("swift"), accounts };
}
