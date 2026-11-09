import { describe, expect, it } from "vitest";
import { averageScore, custodyOf, missingAccessories, payableDueDate, revisionNeedsConsent, whtRateFor } from "./srm";

describe("partner repair rules (2026-11-08)", () => {
  // margin floors per business mode: src/lib/modes.test.ts
  it("monthly partners are due 15 days after the invoice month ends; others on the invoice date", () => {
    expect(payableDueDate(new Date("2026-11-08T10:00:00Z"), "MONTHLY", 15).toISOString().slice(0, 10)).toBe("2026-12-15");
    expect(payableDueDate(new Date("2026-02-27T00:00:00Z"), "MONTHLY", null).toISOString().slice(0, 10)).toBe("2026-03-15");
    expect(payableDueDate(new Date("2026-12-31T00:00:00Z"), "MONTHLY", 15).toISOString().slice(0, 10)).toBe("2027-01-15");
    expect(payableDueDate(new Date("2026-11-08T10:00:00Z"), "PER_ORDER").toISOString().slice(0, 10)).toBe("2026-11-08");
  });
  it("withholds 3 % only on a Thai partner's repair", () => {
    expect(whtRateFor("TH", "SUBCONTRACT")).toBe(0.03);
    expect(whtRateFor("TH", "PARTS")).toBe(0);
    expect(whtRateFor("CN", "SUBCONTRACT")).toBe(0);
  });
  it("lists accessories that did not come back", () => {
    expect(missingAccessories([{ item: "Fan", qty: 2 }, { item: "Cover", qty: 1 }], [{ item: "fan ", qty: 1 }, { item: "Cover", qty: 1 }])).toEqual([{ item: "Fan", qty: 1 }]);
    expect(missingAccessories([{ item: "Fan", qty: 1 }], [{ item: "Fan", qty: 1 }, { item: "Extra", qty: 1 }])).toEqual([]);
  });
  it("tracks custody through a rework cycle", () => {
    expect(custodyOf([])).toBe("NONE");
    expect(custodyOf(["SENT", "ARRIVED", "COMPLETED"])).toBe("AT_PARTNER");
    expect(custodyOf(["SENT", "RETURNED"])).toBe("RETURNED");
    expect(custodyOf(["SENT", "RETURNED", "RETEST_FAILED"])).toBe("FAILED");
    expect(custodyOf(["SENT", "RETURNED", "RETEST_FAILED", "SENT", "RETURNED", "RETEST_PASSED"])).toBe("PASSED");
  });
  it("needs customer consent when the POTH costs more or slips", () => {
    const d = new Date("2026-11-20");
    expect(revisionNeedsConsent({ subtotal: 1000, expectedAt: d }, { subtotal: 1200, expectedAt: d })).toBe(true);
    expect(revisionNeedsConsent({ subtotal: 1000, expectedAt: d }, { subtotal: 1000, expectedAt: new Date("2026-11-25") })).toBe(true);
    expect(revisionNeedsConsent({ subtotal: 1000, expectedAt: d }, { subtotal: 900, expectedAt: new Date("2026-11-18") })).toBe(false);
  });
  it("averages partner ratings", () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([{ quality: 5, onTime: 4, price: 3, cooperation: 4 }, { quality: 3, onTime: 3, price: 3, cooperation: 3 }])).toBe(3.5);
  });
});
