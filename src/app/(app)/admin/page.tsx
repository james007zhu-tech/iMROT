import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Admin: legal entities, today's Bank of China rates, running number counters. Read-only in Phase 1 except via seed. */
export default async function Admin() {
  const [entities, rates, seqs] = await Promise.all([
    prisma.legalEntity.findMany({ orderBy: { countryCode: "asc" } }),
    prisma.fxRate.findMany({ orderBy: [{ rateDate: "desc" }, { currency: "asc" }], take: 40 }),
    prisma.docSequence.findMany({ orderBy: [{ prefix: "asc" }, { period: "desc" }], take: 100, include: { entity: true } }),
  ]);
  const cell = "px-3 py-1.5";
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Admin</h1>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">Legal entities</h2>
        <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className={cell}>Country</th><th className={cell}>Name</th><th className={cell}>Tax ID</th><th className={cell}>Local ccy</th><th className={cell}>Book ccy</th><th className={cell}>VAT</th><th className={cell}>Signatory</th></tr></thead>
          <tbody>{entities.map((e) => <tr key={e.id} className="border-t"><td className={`${cell} font-mono`}>{e.countryCode}</td><td className={cell}>{e.nameEn}<span className="block text-xs text-slate-500">{e.nameLocal}</span></td><td className={`${cell} font-mono`}>{e.taxId}</td><td className={cell}>{e.localCurrency}</td><td className={cell}>{e.bookCurrency}</td><td className={cell}>{(Number(e.vatRate) * 100).toFixed(0)}%</td><td className={cell}>{e.signatoryName}</td></tr>)}</tbody></table>
      </section>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">Bank of China rates (CNY per 1 unit)</h2>
        <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className={cell}>Date</th><th className={cell}>Currency</th><th className={cell}>Rate</th><th className={cell}>Published</th></tr></thead>
          <tbody>{rates.map((r) => <tr key={r.id} className="border-t"><td className={cell}>{r.rateDate.toISOString().slice(0, 10)}</td><td className={`${cell} font-mono`}>{r.currency}</td><td className={`${cell} font-mono`}>{Number(r.rateToCny).toFixed(6)}</td><td className={cell}>{r.publishedAt?.toISOString().slice(0, 16).replace("T", " ") ?? ""}</td></tr>)}{rates.length === 0 && <tr><td colSpan={4} className={`${cell} text-slate-500`}>no rates yet — run `npm run fx:fetch`</td></tr>}</tbody></table>
      </section>
      <section className="rounded-lg border bg-white p-3"><h2 className="mb-2 font-bold text-navy">Number counters</h2>
        <table className="w-full text-sm"><thead className="text-left text-slate-500"><tr><th className={cell}>Entity</th><th className={cell}>Prefix</th><th className={cell}>Period</th><th className={cell}>Last</th></tr></thead>
          <tbody>{seqs.map((s) => <tr key={s.id} className="border-t"><td className={cell}>{s.entity.countryCode}</td><td className={`${cell} font-mono`}>{s.prefix}</td><td className={`${cell} font-mono`}>{s.period}</td><td className={cell}>{s.last}</td></tr>)}</tbody></table>
      </section>
    </div>
  );
}
