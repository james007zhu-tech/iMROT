import { describe, expect, it } from "vitest";
import { costTotal, marginApprovalFor, marginPct, quoteMayGoOut } from "./margin";

describe("margin", () => {
  it("computes cost; a priced line without cost leaves the margin open (no longer counted as free, 测试 2026-11-18)", () => {
    const lines = [{ qty: 2, unitPrice: 3000, unitCost: 1000 }, { qty: 1, unitPrice: 2000 }];
    expect(costTotal(lines)).toBe(2000);
    expect(marginPct(lines)).toBeNull();
    expect(marginPct([{ qty: 2, unitPrice: 3000, unitCost: 1000 }, { qty: 1, unitPrice: 2000, unitCost: 1000 }])).toBe(0.625); // (8000 − 3000) / 8000
  });
  it("is null with no revenue", () => {
    expect(marginPct([])).toBeNull();
    expect(marginPct([{ qty: 1, unitPrice: 0, unitCost: 10 }])).toBeNull();
  });
  it("needs the MD below 50 %", () => {
    expect(marginApprovalFor(0.5)).toBe("NOT_NEEDED");
    expect(marginApprovalFor(0.4999)).toBe("PENDING");
    expect(marginApprovalFor(null)).toBe("NOT_NEEDED");
    expect(marginApprovalFor(-0.1)).toBe("PENDING"); // selling below cost
  });
  it("lets only approved or unneeded quotes go to the customer", () => {
    expect(quoteMayGoOut("NOT_NEEDED")).toBe(true);
    expect(quoteMayGoOut("APPROVED")).toBe(true);
    expect(quoteMayGoOut("PENDING")).toBe(false);
    expect(quoteMayGoOut("REJECTED")).toBe(false);
  });
  it("a priced line without cost: no margin, NO_COST, cannot go out (测试 2026-11-18)", async () => {
    const { missingCostLines } = await import("./margin");
    const lines = [{ qty: 1, unitPrice: 1000, unitCost: 400 }, { qty: 2, unitPrice: 500, unitCost: null }, { qty: 1, unitPrice: 300, unitCost: 0 }];
    expect(missingCostLines(lines)).toEqual([2, 3]);
    expect(marginPct(lines)).toBeNull();
    expect(marginApprovalFor(marginPct(lines), 0.5, 2)).toBe("NO_COST");
    expect(quoteMayGoOut("NO_COST")).toBe(false);
  });
});
