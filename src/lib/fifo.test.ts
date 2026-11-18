import { describe, expect, it } from "vitest";
import { fifoRun, type FifoMove } from "./fifo";

const d = (n: number) => new Date(Date.UTC(2026, 10, n));
const mv = (id: string, direction: "IN" | "OUT", qty: number, day: number, more: Partial<FifoMove> = {}): FifoMove => ({ id, no: `${direction === "IN" ? "IB" : "OB"}${id}`, lineNo: 1, direction, qty, unitCost: null, movedAt: d(day), ...more });

describe("存货先进先出 (N-41)", () => {
  it("MD's example: 6 @100, then 4 @120, issue 1 → costs 100, 980 left", () => {
    const r = fifoRun([mv("a", "IN", 6, 1, { unitCost: 100 }), mv("b", "IN", 4, 2, { unitCost: 120 }), mv("c", "OUT", 1, 3)]);
    expect(r.out.get("c")!.amount).toBe(100); expect(r.out.get("c")!.unit).toBe(100);
    expect(r.value).toBe(980); expect(r.qty).toBe(9); expect(r.next!.cost).toBe(100);
  });
  it("an issue across two batches is split, at each batch's cost", () => {
    const r = fifoRun([mv("a", "IN", 6, 1, { unitCost: 100 }), mv("b", "IN", 4, 2, { unitCost: 120 }), mv("c", "OUT", 8, 3)]);
    expect(r.out.get("c")!.alloc).toEqual([{ inNo: "IBa", qty: 6, cost: 100 }, { inNo: "IBb", qty: 2, cost: 120 }]);
    expect(r.out.get("c")!.amount).toBe(840); expect(r.value).toBe(240); expect(r.next!.cost).toBe(120);
  });
  it("a return goes back to the batch its issue came from, at that cost", () => {
    const r = fifoRun([mv("a", "IN", 6, 1, { unitCost: 100 }), mv("b", "IN", 4, 2, { unitCost: 120 }), mv("c", "OUT", 7, 3, { orderId: "o" }), mv("r", "IN", 2, 4, { isReturn: true, orderId: "o" })]);
    expect(r.back.get("r")!.alloc).toEqual([{ inNo: "IBb", qty: 1, cost: 120 }, { inNo: "IBa", qty: 1, cost: 100 }]);
    expect(r.qty).toBe(5); expect(r.value).toBe(100 + 4 * 120);
  });
  it("a receipt without a cost and stock from before batches use the fallback", () => {
    const r = fifoRun([mv("a", "IN", 2, 1), mv("c", "OUT", 3, 2)], 50);
    expect(r.out.get("c")!.amount).toBe(150); expect(r.qty).toBe(0); expect(r.value).toBe(0);
  });
});
