/**
 * Shared page furniture. Four global rules (2026-11-03) live here so pages cannot drift:
 *  ① list pages: the title row ends with "+ New …"           → <PageHeader newHref newLabel>
 *  ② frames are navy shades, orange only for alarms             → tokens in globals.css; <Alert>, <FaultText>
 *  ③ step pages: back button top-left, app route not history  → <PageHeader back={{ href, label }}>
 *  ④ forms: upload/paste box on top that fills the form       → <UploadRecognize> (client) placed under the header
 * No text lives here; callers pass translated labels.
 */
import Link from "next/link";

export const inputCls = "w-full rounded-md border px-2.5 py-2 text-sm";
/** For filter rows: natural width. */
export const filterCls = "min-h-10 rounded-md border px-2.5 py-2 text-sm";
export const btnPrimary = "inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-navy px-4 text-sm font-semibold text-white hover:bg-navy/90";
export const btnBlue = "inline-flex min-h-10 items-center justify-center gap-1 rounded-lg bg-blue px-4 text-sm font-semibold text-white hover:bg-blue/90";
export const btnGhost = "inline-flex min-h-10 items-center justify-center gap-1 rounded-lg border border-navy/45 bg-white px-4 text-sm font-semibold text-navy hover:bg-tint";

export function PageHeader({ title, badge, back, actions, newHref, newLabel }: {
  title: React.ReactNode; badge?: React.ReactNode; back?: { href: string; label: string }; actions?: React.ReactNode; newHref?: string; newLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {back && <Link href={back.href} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-navy/45 bg-white px-3 text-sm text-navy hover:bg-tint">← {back.label}</Link>}
      <h1 className="text-2xl font-bold text-navy">{title}</h1>
      {badge}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {actions}
        {newHref && newLabel && <Link href={newHref} className={btnBlue}>＋ {newLabel}</Link>}
      </div>
    </div>
  );
}

export function Card({ title, children, className = "", accent = false }: { title?: React.ReactNode; children: React.ReactNode; className?: string; accent?: boolean }) {
  return (
    <section className={`rounded-xl border bg-white p-4 ${accent ? "border-blue" : ""} ${className}`}>
      {title && <h2 className="mb-3 text-[15px] font-bold text-navy">{title}</h2>}
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Field({ label, required, children, className = "" }: { label: React.ReactNode; required?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1 text-[13px] ${className}`}>
      <span className="text-navy/80">{label}{required && <span className="text-alert"> *</span>}</span>
      {children}
    </label>
  );
}

export function Grid({ cols = 3, children }: { cols?: 2 | 3 | 4; children: React.ReactNode }) {
  const c = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[cols];
  return <div className={`grid grid-cols-1 gap-3 ${c}`}>{children}</div>;
}

/** Orange: alarms, conflicts, blocked actions. */
export function Alert({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-alert bg-alert/10 px-3 py-2 text-[13px] text-alert-ink">⚠ {children}</div>;
}

/** Red: fault descriptions and alarm codes, nothing else. */
export function FaultText({ children }: { children: React.ReactNode }) {
  return <span className="font-semibold text-fault">{children}</span>;
}

export function Tag({ children, hot = false }: { children: React.ReactNode; hot?: boolean }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold ${hot ? "border-alert bg-alert/15 text-alert-ink" : "border-navy/35 bg-blue/8 text-navy"}`}>{children}</span>;
}

/** How an asset is shown everywhere: ATH / brand series model / S/N, three lines. */
export function AssetTriple({ asset, link = true }: { asset: { code: string; serialNumber: string; model?: { code: string; series: { name: string; brand: { name: string } } } | null }; link?: boolean }) {
  const m = asset.model;
  return (
    <div className="flex flex-col leading-snug">
      {link ? <Link href={`/assets/${asset.code}`} className="font-mono font-bold text-blue hover:underline">{asset.code}</Link> : <b className="font-mono">{asset.code}</b>}
      {m && <span>{m.series.brand.name} {m.series.name.replace(/^SINAMICS\s+/i, "")} {m.code}</span>}
      <span className="text-xs text-navy/75">S/N {asset.serialNumber}</span>
    </div>
  );
}

/** Read-only value box that looks like a field (values carried over from the order). */
export function Value({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`min-h-10 rounded-md border bg-white px-2.5 py-2 text-sm ${className}`}>{children}</div>;
}

export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead className="text-left"><tr className="border-b border-line">{head.map((h, i) => <th key={i} className="px-2 py-2">{h}</th>)}</tr></thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-hair [&_td]:px-2 [&_td]:py-2 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

/** List footer "1–20 / 57  ‹ prev  next ›" (wireframe: every list pages by 20). `href(n)` keeps the list's filters. */
export const PAGE_SIZE = 20;
export function Pager({ page, total, href, prev, next, size = PAGE_SIZE }: { page: number; total: number; href: (n: number) => string; prev: string; next: string; size?: number }) {
  return (
    <div className="flex items-center gap-2 px-2 pt-2 text-[13px] text-navy/70">
      <span>{total === 0 ? 0 : (page - 1) * size + 1}–{Math.min(page * size, total)} / {total}</span>
      <span className="ml-auto" />
      {page > 1 && <Link href={href(page - 1)} className={btnGhost}>{prev}</Link>}
      {page * size < total && <Link href={href(page + 1)} className={btnGhost}>{next}</Link>}
    </div>
  );
}
