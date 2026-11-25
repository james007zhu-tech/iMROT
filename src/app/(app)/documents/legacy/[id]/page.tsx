import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { currentEmployee } from "@/server/auth";
import { prisma } from "@/lib/db";
import { can } from "@/lib/caps";
import { legacyFieldHidden, legacyKinds, legacyOwnOnly, type LegacyKindKey } from "@/lib/legacy";
import { Card, PageHeader, Table, Tag } from "@/components/ui";

export const dynamic = "force-dynamic";

type Pair = [string, string];
/** One record of the old system, whole and read-only: every field it had, its lines, and what it is tied to here. */
export default async function LegacyOne({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await currentEmployee();
  const l = await getTranslations("legacy");
  const x = await prisma.legacyDoc.findUnique({ where: { id }, include: { customer: { select: { code: true, name: true, salesId: true } }, asset: { select: { code: true, serialNumber: true } } } });
  if (!x || !legacyKinds(me).includes(x.kind as LegacyKindKey) || (legacyOwnOnly(me) && x.customer?.salesId !== me.id)) notFound();
  const data = x.data as { fields: Pair[]; lines: Record<string, Pair[][]> };
  const match = (x.match ?? {}) as { customer?: string | null; asset?: string | null };
  const show = (label: string) => !legacyFieldHidden(me, label);
  const pics = (Array.isArray(x.files) ? x.files : []) as { url: string; name?: string }[];
  const names = can.customerNames(me);
  const fields = data.fields.filter(([k]) => show(k) && (names || !/客户|customer|company|公司|地址|address|税号|tax id|总部/i.test(k)));
  const refs = x.refs.length ? await prisma.legacyDoc.findMany({ where: { no: { in: x.refs }, kind: { in: legacyKinds(me) } }, select: { id: true, no: true, kind: true } }) : [];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: `/documents/legacy?kind=${x.kind}`, label: l("title") }} title={<><span className="font-mono">{x.no ?? "—"}</span> <span className="text-lg font-semibold">{x.form}</span></>} badge={<Tag>{l("readOnly")}</Tag>} />
      <Card title={l("tiedTo")}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-navy/60">{l("customer")}</dt><dd>{x.customer && names ? <><Link href={`/customers/${x.customer.code}`} className="font-mono text-blue hover:underline">{x.customer.code}</Link> {x.customer.name} <span className="text-xs text-navy/60">· {match.customer}</span></> : x.customer ? "—" : <span className="text-alert-ink">{l("notTied")}</span>}</dd></div>
          {(x.kind === "INSPECTION" || x.kind === "REPAIR") && <div><dt className="text-navy/60">{l("asset")}</dt><dd>{x.asset ? <><Link href={`/assets/${x.asset.code}`} className="font-mono text-blue hover:underline">{x.asset.code}</Link> S/N {x.asset.serialNumber} <span className="text-xs text-navy/60">· {match.asset}</span></> : <span className="text-alert-ink">{l("notTied")}{match.asset ? ` · ${match.asset}` : ""}</span>}</dd></div>}
          {x.refs.length > 0 && <div className="sm:col-span-2"><dt className="text-navy/60">{l("refs")}</dt><dd className="flex flex-wrap gap-x-3 font-mono">{x.refs.map((r) => { const hit = refs.filter((d) => d.no === r); return hit.length ? hit.map((d) => <Link key={d.id} href={`/documents/legacy/${d.id}`} className="text-blue hover:underline">{r}<span className="font-sans text-xs text-navy/60"> {l(`k_${d.kind}`)}</span></Link>) : /^ATH\d/.test(r) ? <span key={r}>{r}</span> : <span key={r} className="text-navy/70">{r}</span>; })}</dd></div>}
          <div><dt className="text-navy/60">{l("by")}</dt><dd>{x.submittedBy} {x.submittedAt?.toISOString().slice(0, 10)}</dd></div>
        </dl>
      </Card>
      <Card title={l("record")}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([k, v], i) => <div key={i} className={v.length > 60 ? "sm:col-span-2 lg:col-span-3" : ""}><dt className="text-navy/60">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>)}
        </dl>
      </Card>
      {pics.length > 0 && (
        <Card title={`${l("pictures")} · ${pics.length}`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {pics.map((f) => <a key={f.url} href={f.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border bg-white">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={f.url} alt={f.name ?? ""} loading="lazy" className="h-40 w-full object-cover" /></a>)}
          </div>
        </Card>
      )}
      {Object.entries(data.lines).map(([g, rows]) => {
        const cols = [...new Set(rows.flatMap((r) => r.map(([k]) => k)))].filter(show);
        if (!cols.length) return null;
        return (
          <Card key={g} title={g}>
            <Table head={cols}>
              {rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="whitespace-pre-wrap">{r.find(([k]) => k === c)?.[1] ?? ""}</td>)}</tr>)}
            </Table>
          </Card>
        );
      })}
    </div>
  );
}
