/**
 * 存货先进先出 (N-41, MD 2026-11-18 17:02). Every receipt is a batch — its quantity at its unit cost. An issue takes
 * from the oldest batch that still has stock and goes on to the next when that one runs out; what it cost is what those
 * batches cost (an issue across batches is split). A return goes back to the batches its issue was taken from, at their
 * cost. What is left in the batches, at their own costs, is the value of the stock.
 *
 * Nothing here is stored: the whole history of a part is replayed, so the same figure comes out wherever it is asked
 * for — the report, the part page, the list, the issue's cost, the cost a quote takes over.
 */
export type FifoMove = {
  id: string; no: string; lineNo: number; direction: "IN" | "OUT"; qty: number; unitCost: number | null; movedAt: Date;
  orderId?: string | null; /** an IN that hands back what an order drew */ isReturn?: boolean; /** the OBTH a return (or a reversal) refers to */ refNo?: string | null;
};
export type FifoBatch = { inId: string; inNo: string; date: Date; qty: number; left: number; cost: number };
export type FifoAlloc = { inNo: string | null; qty: number; cost: number };
export type FifoOut = { no: string; qty: number; amount: number; unit: number; alloc: FifoAlloc[] };
const r2 = (n: number) => Math.round(n * 100) / 100, r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function fifoRun(moves: FifoMove[], fallbackCost = 0) {
  const sorted = [...moves].sort((a, b) => a.movedAt.getTime() - b.movedAt.getTime() || (a.direction === b.direction ? 0 : a.direction === "IN" ? -1 : 1) || a.no.localeCompare(b.no) || a.lineNo - b.lineNo);
  const batches: FifoBatch[] = [];
  const out = new Map<string, FifoOut>(), back = new Map<string, FifoOut>(); // by movement id: what an issue cost; what a return gave back
  const taken = new Map<string, { m: FifoMove; alloc: (FifoAlloc & { inId: string | null; returned: number })[] }>();
  for (const m of sorted) {
    if (m.direction === "IN" && !m.isReturn) {
      const b: FifoBatch = { inId: m.id, inNo: m.no, date: m.movedAt, qty: m.qty, left: m.qty, cost: m.unitCost ?? fallbackCost }; batches.push(b);
      // an issue recorded before the goods it took were booked in (more out than the batches held): this receipt covers
      // it first, at this receipt's cost — so the batches never hold more than the store does
      for (const t of taken.values()) { if (b.left <= 1e-9) break; let hit = false;
        for (const a of [...t.alloc]) { if (b.left <= 1e-9) break; if (a.inId !== null || a.inNo !== null) continue; const q = Math.min(b.left, r6(a.qty - a.returned)); if (q <= 1e-9) continue;
          b.left = r6(b.left - q); a.qty = r6(a.qty - q); t.alloc.push({ inId: b.inId, inNo: b.inNo, qty: q, cost: b.cost, returned: 0 }); hit = true; }
        if (hit) { t.alloc = t.alloc.filter((a) => a.qty > 1e-9); const amount = r2(t.alloc.reduce((x, a) => x + a.qty * a.cost, 0)); out.set(t.m.id, { no: t.m.no, qty: t.m.qty, amount, unit: t.m.qty ? r2(amount / t.m.qty) : 0, alloc: t.alloc.map(({ inNo, qty, cost }) => ({ inNo, qty, cost })) }); } }
      continue;
    }
    if (m.direction === "OUT") {
      let need = m.qty; const alloc: (FifoAlloc & { inId: string | null; returned: number })[] = [];
      for (const b of batches) { if (need <= 1e-9) break; if (b.left <= 1e-9) continue; const q = Math.min(b.left, need); b.left = r6(b.left - q); need = r6(need - q); alloc.push({ inId: b.inId, inNo: b.inNo, qty: q, cost: b.cost, returned: 0 }); }
      if (need > 1e-9) alloc.push({ inId: null, inNo: null, qty: need, cost: fallbackCost, returned: 0 }); // more went out than the batches hold (stock from before batches): at the fallback cost
      const amount = r2(alloc.reduce((s, a) => s + a.qty * a.cost, 0));
      out.set(m.id, { no: m.no, qty: m.qty, amount, unit: m.qty ? r2(amount / m.qty) : 0, alloc: alloc.map(({ inNo, qty, cost }) => ({ inNo, qty, cost })) });
      taken.set(m.id, { m, alloc });
      continue;
    }
    // a return: back to the batches of the issue it belongs to — the one named, else the order's latest issue that still has something out
    let left = m.qty; const gave: FifoAlloc[] = [];
    const sources = [...taken.values()].filter((t) => (m.refNo ? t.m.no === m.refNo : !!m.orderId && t.m.orderId === m.orderId)).reverse();
    for (const t of sources) for (const a of [...t.alloc].reverse()) {
      if (left <= 1e-9) break; const q = Math.min(left, r6(a.qty - a.returned)); if (q <= 1e-9) continue;
      a.returned = r6(a.returned + q); left = r6(left - q); gave.push({ inNo: a.inNo, qty: q, cost: a.cost });
      const b = a.inId ? batches.find((x) => x.inId === a.inId) : undefined;
      if (b) b.left = r6(b.left + q); else batches.push({ inId: m.id, inNo: m.no, date: m.movedAt, qty: q, left: q, cost: a.cost });
    }
    if (left > 1e-9) { const c = m.unitCost ?? fallbackCost; batches.push({ inId: m.id, inNo: m.no, date: m.movedAt, qty: left, left, cost: c }); gave.push({ inNo: null, qty: left, cost: c }); } // nothing it could go back to: a batch of its own
    const amount = r2(gave.reduce((s, a) => s + a.qty * a.cost, 0));
    back.set(m.id, { no: m.no, qty: m.qty, amount, unit: m.qty ? r2(amount / m.qty) : 0, alloc: gave });
  }
  const open = batches.filter((b) => b.left > 1e-9);
  return { batches: open, all: batches, out, back, qty: r6(open.reduce((s, b) => s + b.left, 0)), value: r2(open.reduce((s, b) => s + b.left * b.cost, 0)), next: open[0] ?? null };
}
