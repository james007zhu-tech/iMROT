import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { hasRole } from "@/lib/caps";
import { localIso } from "@/lib/dates";
import { currentEmployee } from "@/server/auth";
import { presetRange, reportDetail, type DetailKind } from "@/server/fin-report";
import { PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";
const KINDS: DetailKind[] = ["result", "vatNet", "revenue", "vatOut", "collected", "whtByCustomers", "purchases", "vatIn", "paidSuppliers", "expenses", "payroll", "stock", "vatDue", "whtDue", "payrollDue", "bsCash", "bsAr", "bsAp"];

/** 报表下钻: the documents behind one number of the report page; every row opens its document (派修单 v4 P0-1). */
export default async function Detail({ searchParams }: { searchParams: Promise<{ k?: string; from?: string; to?: string; p?: string; test?: string; mode?: string; customer?: string; category?: string }> }) {
  const sp = await searchParams;
  const [t, u, me] = await Promise.all([getTranslations("ops"), getTranslations("ui"), currentEmployee()]);
  if (!hasRole(me, "MD", "FINANCE") || !KINDS.includes(sp.k as DetailKind)) notFound();
  const day = /^\d{4}-\d{2}-\d{2}$/, range = day.test(sp.from ?? "") && day.test(sp.to ?? "") ? { from: sp.from!, to: sp.to! } : presetRange(sp.p ?? "month");
  const kind = sp.k as DetailKind, includeTest = sp.test === "1";
  const r = await reportDetail(me.entityId, range, kind, { withPayroll: hasRole(me, "MD"), includeTest, mode: sp.mode, customer: sp.customer, category: sp.category });
  const m = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const back = new URLSearchParams({ from: range.from, to: range.to, ...(includeTest ? { test: "1" } : {}) }).toString();
  const sub = sp.mode ? u(`mode_${sp.mode}`) : sp.customer ?? sp.category ?? "";
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/finance/reports?${back}`, label: "←" }} title={`${t(`det_${kind}`)}${sub ? ` · ${sub}` : ""}`} badge={<Tag>{kind === "stock" || kind.startsWith("bs") ? range.to : `${range.from} → ${range.to}`}</Tag>} />
      <div className="rounded-xl border bg-white p-2">
        <Table head={[t("repDate"), t("repDocNo"), t("repParty"), t("repRef"), "THB"]}>
          {r.rows.map((x, i) => <tr key={x.no + i}><td className="whitespace-nowrap font-mono text-xs">{localIso(x.date)?.slice(0, 10) ?? ""}</td><td className="whitespace-nowrap"><Link href={x.href} className="font-mono text-blue hover:underline">{x.no || "—"}</Link></td><td>{x.who}</td><td className="text-xs text-navy/70">{x.note}</td><td className="text-right tabular-nums">{m(x.amount)}</td></tr>)}
          {!r.rows.length && <tr><td colSpan={5} className="py-4 text-center text-navy/60">{t("detNone")}</td></tr>}
          <tr className="font-semibold"><td colSpan={4} className="text-right">{t("total")} ({r.rows.length})</td><td className="text-right tabular-nums">{m(r.total)}</td></tr>
        </Table>
      </div>
      {!includeTest && <p className="text-xs text-navy/60">{t("repTestNote")}</p>}
    </div>
  );
}
