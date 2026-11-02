import { describe, expect, it } from "vitest";
import { expectedReceipt, lineAmount, totals } from "./money";

describe("money", () => {
  it("line and totals with 7% VAT", () => {
    expect(lineAmount({ qty: 3, unitPrice: 1234.5 })).toBe(3703.5);
    const t = totals([{ qty: 1, unitPrice: 10000 }, { qty: 2, unitPrice: 250.25 }], 0.07);
    expect(t).toEqual({ subtotal: 10500.5, vatRate: 0.07, vatAmount: 735.04, total: 11235.54 });
  });
  it("withholding reduces receipt, not the invoice", () => {
    expect(expectedReceipt(11235.54, 0, 315.02)).toBe(10920.52);
    expect(expectedReceipt(11235.54, 5000, 0)).toBe(6235.54);
  });
});
