import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/db";
import { DOC_PLACES } from "@/lib/doc-center";
import { Card } from "@/components/ui";
import { currentEmployee } from "@/server/auth";
import { docTypeAllowed, orderScope } from "@/server/scope";
import { can } from "@/lib/caps";

/** The step on an order that creates a document of this type (验收 has no number of its own). */
export function newStep(type: string) {
  return type === "AC" ? { path: "accept", statuses: ["ACCEPTANCE_PENDING", "IN_PROGRESS"], modes: undefined as string[] | undefined } : DOC_PLACES[type]?.step;
}

/**
 * "+ 新建" on every list page creates that document (朱总 2026-11-10). A document with a form of its own opens it;
 * one that belongs to an order (ERTH, DNTH, INTH, IVTH …) cannot exist without the order, so the button opens this
 * panel on the same page: the orders that have reached the step — one tap opens the form.
 */
export async function ReadyOrders({ type, title }: { type: string; title: string }) {
  const step = newStep(type);
  if (!step) return null;
  const [d, ts] = await Promise.all([getTranslations("docs"), getTranslations("orderStatus")]);
  const me = await currentEmployee();
  const money = ["TI", "IV", "RC"].includes(type);
  if ((money && !can.invoice(me)) || !docTypeAllowed(me, type)) return null; // 开票、收款的候选只给 FIN 和 MD
  // 开票候选 (需求清单 v4 V4-P0-06): accepted, not yet invoiced, worth more than zero — or a refused quote with a fee to bill
  const billable: Prisma.ServiceOrderWhereInput = type === "TI" || type === "IV" ? { OR: [{ status: "ACCEPTED", total: { gt: 0 } }, { status: "DECLINED", decline: { isNot: null } }] } : {};
  const ready = (await prisma.serviceOrder.findMany({ where: { AND: [await orderScope(me), billable, { status: { in: step.statuses as never }, ...(step.modes ? { mode: { in: step.modes as never } } : {}) }] }, orderBy: { reportedAt: "desc" }, take: 40, select: { no: true, status: true, customer: { select: { name: true } }, reportedSymptom: true, project: true, decline: { select: { fees: true } } } }))
    .filter((o) => o.status !== "DECLINED" || ((o.decline?.fees as { amount?: number }[] | null) ?? []).some((f) => Number(f.amount) > 0)); // a refused quote with nothing to bill is not a candidate
  return (
    <Card title={d("pickOrder", { name: title })} accent>
      {ready.length === 0 ? <p className="text-sm text-navy/70">{d("noReady")}</p> : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ready.map((o) => <Link key={o.no} href={`/service-orders/${o.no}/${step.path}`} className="rounded-lg border border-hair bg-white px-3 py-2 text-sm hover:border-blue"><span className="font-mono text-blue">{o.no}</span> <span className="text-navy">{o.customer.name}</span><span className="block truncate text-xs text-navy/60">{ts(o.status)}{o.reportedSymptom ? ` · ${o.reportedSymptom}` : (o.project as { name?: string } | null)?.name ? ` · ${(o.project as { name?: string }).name}` : ""}</span></Link>)}
        </div>
      )}
    </Card>
  );
}
