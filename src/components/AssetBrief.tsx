import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { Briefing } from "@/server/briefing";

/** 这台设备的底细 — shown above every field form (ERTH, INTH, RPTH, PMTH): look first, then work. */
export async function AssetBrief({ brief, open = true }: { brief: Briefing; open?: boolean }) {
  const u = await getTranslations("ui");
  return (
    <details open={open} className="rounded-xl border border-blue/40 bg-white">
      <summary className="cursor-pointer list-none px-4 py-3 text-[15px] font-bold text-navy [&::-webkit-details-marker]:hidden">{u("briefTitle")} <span className="font-mono text-sm font-normal text-navy/60">{brief.asset.code} · {brief.asset.model}</span></summary>
      <div className="grid gap-4 border-t border-hair px-4 py-3 text-[13.5px] md:grid-cols-2">
        <div>
          <b className="text-navy/70">{u("briefKnowledge")}</b>
          {brief.codes.length === 0 && <p className="text-navy/60">{u("briefNoCode")}</p>}
          {brief.codes.map((c) => <div key={c.id} className="mt-1.5"><Link href={`/fault-codes/${c.id}`} className="font-mono font-bold text-blue hover:underline">{c.code}</Link> <span className="font-semibold">{c.title}</span>{c.meaning && <p className="text-navy/80">{c.meaning}</p>}{c.checks && <p className="text-navy/80"><span className="text-navy/60">{u("briefChecks")}</span> {c.checks}</p>}{c.parts && <p className="text-navy/80"><span className="text-navy/60">{u("briefParts")}</span> {c.parts}</p>}</div>)}
        </div>
        <div>
          <b className="text-navy/70">{u("briefHistory")}</b>
          {brief.history.length === 0 && <p className="text-navy/60">{u("briefNoHistory")}</p>}
          {brief.history.map((h) => <p key={h.no} className="mt-1"><span className="whitespace-nowrap text-navy/60">{h.date}</span> <span className="font-mono text-xs">{h.no}</span> {h.what}</p>)}
          {brief.backup && <p className="mt-1 text-navy/80"><span className="text-navy/60">{u("briefBackup")}</span> {brief.backup.date} {brief.backup.name}</p>}
          {brief.cases.length > 0 && <><b className="mt-3 block text-navy/70">{u("briefCases")}</b>{brief.cases.map((c) => <p key={c.no} className="mt-1"><Link href={`/service-orders/${c.no}`} className="font-mono text-xs text-blue hover:underline">{c.no}</Link> {c.symptom ? `${c.symptom} → ` : ""}{c.cause}</p>)}</>}
        </div>
      </div>
    </details>
  );
}
