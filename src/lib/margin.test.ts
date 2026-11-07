import { describe, expect, it } from "vitest";
import { costTotal, marginApprovalFor, marginPct, quoteMayGoOut } from "./margin";

describe("margin", () => {
  it("computes cost and margin over costed lines, labour at zero cost", () => {
    const lines = [{ qty: 2, unitPrice: 3000, unitCost: 1000 }, { qty: 1, unitPrice: 2000 }];
    expect(costTotal(lines)).toBe(2000);
    expect(marginPct(lines)).toBe(0.75); // (8000 − 2000) / 8000
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
});
