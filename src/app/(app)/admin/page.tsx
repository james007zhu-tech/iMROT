import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { currentEmployee } from "@/server/auth";
import { guarded } from "@/lib/action-result";
import { Flash } from "@/components/Flash";

export const dynamic = "force-dynamic";

/** Admin: legal entities (editable), Bank of China rates, running number counters. */
export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const t = await getTranslations("common");
  const me = await currentEmployee();
  const [entities, rates, seqs] = await Promise.all([
    prisma.legalEntity.findMany({ orderBy: { countryCode: "asc" } }),
    prisma.fxRate.findMany({ orderBy: [{ rateDate: "desc" }, { currency: "asc" }], take: 40 }),
    prisma.docSequence.findMany({ orderBy: [{ prefix: "asc" }, { period: "desc" }], take: 100, include: { entity: true } }),
  ]);
  const admin = me.role === "MD"; // legal entities: MD only (decision 2026-11-03)
  async function saveEntity(f: FormData) {
    "use server";
    await guarded(async () => {
      const me = await currentEmployee();
      if (me.role !== "MD") throw new Error("MD only");
      const countryCode = String(f.get("countryCode")).toUpperCase();
      const code = String(f.get("code") || "").trim();
      if (!/^DCi[A-Z]$/.test(code)) throw new Error("code must look like DCiT / DCiV / DCiC");
      const data = { code, nameEn: String(f.get("nameEn")), nameLocal: s(f, "nameLocal"), taxId: s(f, "taxId"), branchCode: s(f, "branchCode"), addressEn: s(f, "addressEn"), addressLocal: s(f, "addressLocal"), phone: s(f, "phone"), email: s(f, "email"), website: s(f, "website"), signatoryName: s(f, "signatoryName"), localCurrency: String(f.get("localCurrency") || "THB").toUpperCase(), bookCurrency: "CNY", vatRate: Number(f.get("vatRate") ?? 0.07) };
      await prisma.legalEntity.upsert({ where: { countryCode }, update: data, create: { countryCode, ...data } });
      return `${countryCode} saved`;
    }, "/admin");
  }
  const cell = "px-3 py-1.5";
  const input = "rounded-md border px-2 py-1 text-sm";
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy">{t("nav_admin")}</h1>
      <Flash ok={ok} error={error} />
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{t("legalEntities")}</h2>
        <div className="space-y-3">
          {[...entities, ...(admin ? [null] : [])].map((e, i) => (
            <form key={e?.id ?? "new"} action={saveEntity} className="grid grid-cols-2 gap-1 rounded-md border p-2 md:grid-cols-4">
              <input name="countryCode" defaultValue={e?.countryCode ?? ""} placeholder={t("countryHint")} className={`${input} font-mono`} readOnly={!!e} required />
              <input name="code" defaultValue={e?.code ?? ""} placeholder="DCiV" className={`${input} font-mono`} required />
              <input name="nameEn" defaultValue={e?.nameEn ?? ""} placeholder={t("nameEn")} className={`${input} md:col-span-2`} required />
              <input name="nameLocal" defaultValue={e?.nameLocal ?? ""} placeholder={t("nameLocal")} className={`${input} md:col-span-2`} />
              <input name="taxId" defaultValue={e?.taxId ?? ""} placeholder={t("taxId")} className={input} /><input name="branchCode" defaultValue={e?.branchCode ?? ""} placeholder={t("branch")} className={input} />
              <input name="addressEn" defaultValue={e?.addressEn ?? ""} placeholder={t("addressEn")} className={`${input} md:col-span-2`} /><input name="addressLocal" defaultValue={e?.addressLocal ?? ""} placeholder={t("addressLocal")} className={`${input} md:col-span-2`} />
              <input name="phone" defaultValue={e?.phone ?? ""} placeholder={t("phone")} className={input} /><input name="email" defaultValue={e?.email ?? ""} placeholder={t("email")} className={input} /><input name="website" defaultValue={e?.website ?? ""} placeholder={t("website")} className={input} /><input name="signatoryName" defaultValue={e?.signatoryName ?? ""} placeholder={t("signatory")} className={input} />
              <input name="localCurrency" defaultValue={e?.localCurrency ?? "THB"} placeholder={t("localCcy")} className={input} /><input name="vatRate" type="number" step="0.01" defaultValue={e ? Number(e.vatRate) : 0.07} className={input} /><span className="self-center text-xs text-navy/70">{t("bookCcy")}: CNY</span>
              {admin && <button className="rounded bg-navy px-3 py-1 text-sm text-white">{e ? t("save") : t("addEntity")}</button>}
            </form>
          ))}
        </div>
      </section>
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{t("bocRates")}</h2>
        <table className="w-full text-sm"><thead className="text-left text-navy/70"><tr><th className={cell}>{t("date")}</th><th className={cell}>{t("currency")}</th><th className={cell}>{t("rate")}</th><th className={cell}>{t("published")}</th></tr></thead>
          <tbody>{rates.map((r) => <tr key={r.id} className="border-t"><td className={cell}>{r.rateDate.toISOString().slice(0, 10)}</td><td className={`${cell} font-mono`}>{r.currency}</td><td className={`${cell} font-mono`}>{Number(r.rateToCny).toFixed(6)}</td><td className={cell}>{r.publishedAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""}</td></tr>)}{rates.length === 0 && <tr><td colSpan={4} className={`${cell} text-navy/70`}>{t("noRates")}</td></tr>}</tbody></table>
      </section>
      <section className="rounded-xl border bg-white p-4"><h2 className="mb-2 font-bold text-navy">{t("counters")}</h2>
        <table className="w-full text-sm"><thead className="text-left text-navy/70"><tr><th className={cell}>{t("entity")}</th><th className={cell}>{t("prefix")}</th><th className={cell}>{t("period")}</th><th className={cell}>{t("last")}</th></tr></thead>
          <tbody>{seqs.map((x) => <tr key={x.id} className="border-t"><td className={cell}>{x.entity.countryCode}</td><td className={`${cell} font-mono`}>{x.prefix}</td><td className={`${cell} font-mono`}>{x.period}</td><td className={cell}>{x.last}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
const s = (f: FormData, k: string) => { const v = f.get(k); return v ? String(v) : undefined; };
