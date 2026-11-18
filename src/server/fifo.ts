/**
 * 存货先进先出 over the stock ledger (N-41). One replay per part, from its movements — see src/lib/fifo.ts. Used by the
 * report (存货), the part page and the part list (金额), the issue's cost (出库成本, the order's real cost) and the cost
 * a quote takes over from the system (the next batch to go out).
 */
import { prisma } from "@/lib/db";
import { fifoRun, type FifoMove } from "@/lib/fifo";

export type PartFifo = ReturnType<typeof fifoRun> & { partId: string; sku: string; name: string; fallback: number };

/** Replay the batches of the given parts (all parts when none are named), as they stood before `upTo` (now when omitted). */
export async function fifoOf(partIds?: string[], upTo?: Date): Promise<Map<string, PartFifo>> {
  if (partIds && !partIds.length) return new Map();
  const [parts, moves] = await Promise.all([
    prisma.part.findMany({ where: partIds ? { id: { in: partIds } } : {}, select: { id: true, sku: true, name: true, lastCost: true } }),
    prisma.stockMovement.findMany({ where: { kind: "PART", partId: partIds ? { in: partIds } : { not: null }, reversalOf: null, reversedBy: null, ...(upTo ? { movedAt: { lt: upTo } } : {}) }, select: { id: true, no: true, lineNo: true, direction: true, qty: true, unitCost: true, movedAt: true, partId: true, serviceOrderId: true, purchaseOrderId: true, refNo: true } }),
  ]);
  const by = new Map<string, FifoMove[]>();
  for (const m of moves) { const list = by.get(m.partId!) ?? []; list.push({ id: m.id, no: m.no, lineNo: m.lineNo, direction: m.direction, qty: Number(m.qty), unitCost: m.unitCost != null ? Number(m.unitCost) : null, movedAt: m.movedAt, orderId: m.serviceOrderId, isReturn: m.direction === "IN" && !!m.serviceOrderId && !m.purchaseOrderId, refNo: m.refNo }); by.set(m.partId!, list); }
  const out = new Map<string, PartFifo>();
  for (const p of parts) { const fallback = Number(p.lastCost ?? 0); out.set(p.id, { ...fifoRun(by.get(p.id) ?? [], fallback), partId: p.id, sku: p.sku, name: p.name ?? "", fallback }); }
  return out;
}
/**
 * The cost the system hands a quote for a part (取代「最近采购价」): the unit cost of the next batch to go out, and where
 * it comes from. No batch in stock → the last purchase price, said as such.
 */
export function systemCost(f: PartFifo | undefined): { cost: number; batch: { no: string; date: Date } | null } | null {
  if (!f) return null;
  if (f.next) return { cost: f.next.cost, batch: { no: f.next.inNo, date: f.next.date } };
  return f.fallback > 0 ? { cost: f.fallback, batch: null } : null;
}
