import Link from "next/link";
import { getTranslations } from "next-intl/server";
import type { WorkGap } from "@/lib/work-gate";
import { Card, btnBlue } from "@/components/ui";

/**
 * 按工单状态拦住 (测试报告 P0-07): where a repair or maintenance report cannot be written yet, the page shows this
 * instead of the form — which step is missing and the way to it. The service refuses the same way.
 */
export async function WorkGate({ no, gap, work }: { no: string; gap: WorkGap; work: "repair" | "maintain" }) {
  const u = await getTranslations("ui");
  const steps = (work === "maintain" ? ["quote", "confirm"] : ["inspect", "quote", "confirm"]) as WorkGap[];
  const at = steps.indexOf(gap);
  return (
    <Card title={u(work === "maintain" ? "workGateTitleM" : "workGateTitle")} accent>
      <p className="text-sm">{u(`workGate_${gap}`)}</p>
      <ol className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
        {steps.map((k, i) => { const past = gap === "over" || at > i; return (
          <li key={k} className={`rounded-full border px-3 py-1 ${k === gap ? "border-blue bg-blue text-white" : past ? "border-navy/30 bg-white text-navy/60" : "border-navy/30 bg-white text-navy"}`}>{past ? "✓ " : ""}{u(`step_${k}`)}</li>); })}
        <li className="rounded-full border border-dashed border-navy/40 px-3 py-1 text-navy/60">{u(`step_${work}`)}</li>
      </ol>
      <div className="mt-3">{gap === "over" ? <Link href={`/service-orders/${no}`} className={btnBlue}>{u("workGateBack")} →</Link> : <Link href={`/service-orders/${no}/${gap}`} className={btnBlue}>{u("workGateGo", { step: u(`step_${gap}`) })} →</Link>}</div>
    </Card>
  );
}
