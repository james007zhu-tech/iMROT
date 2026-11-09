import { describe, expect, it } from "vitest";
import { incotermLine, shipmentProblems, shippedProblems, shipTotals, tradeTermsFrom, transportDoc } from "./export";

const line = { key: "PO:1", lineNo: 1, description: "SINAMICS G120 PM240-2", hsCode: "8504.40.90", origin: "DE", qty: 4, unit: "pcs", packages: 2, netKg: 30, grossKg: 34, unitPrice: 900, amount: 3600 };

describe("international trade rules", () => {
  it("reads the trade terms and refuses what customs or the quote cannot work with", () => {
    const t = tradeTermsFrom({ currency: "usd", incoterm: "fob", place: "Laem Chabang", destCountry: "Indonesia", destPort: "Jakarta", shipMode: "sea", paymentTerms: "T/T 30% advance, 70% before shipment", paymentDays: "0" });
    expect(t).toMatchObject({ currency: "USD", incoterm: "FOB", shipMode: "SEA", paymentDays: 0 });
    expect(incotermLine(t)).toBe("FOB Laem Chabang (Incoterms® 2020)");
    expect(() => tradeTermsFrom({ ...t, incoterm: "FOT" })).toThrow(/BAD_INCOTERM/);
    expect(() => tradeTermsFrom({ ...t, place: " " })).toThrow(/TRADE_TERMS_REQUIRED:place/);
  });
  it("needs HS code, origin, packages and weights on every line before the CI and PL go out", () => {
    expect(shipmentProblems({ portLoading: "Laem Chabang", portDischarge: "Jakarta", etd: "2026-12-01", lines: [line] })).toEqual([]);
    expect(shipmentProblems({ portLoading: "", portDischarge: "Jakarta", etd: "", lines: [{ ...line, hsCode: "85", origin: "", grossKg: 20 }] }))
      .toEqual(["PORT_LOADING", "ETD", "HS_CODE:1", "ORIGIN:1", "WEIGHT:1"]);
    expect(shipmentProblems({ portLoading: "a", portDischarge: "b", etd: "x", lines: [{ ...line, hsCode: "85044090" }] })).toEqual([]);
  });
  it("counts the shipment and names the carrier document", () => {
    expect(shipTotals([line, { ...line, packages: 1, netKg: 0.5, grossKg: 0.75, amount: 10.5 }])).toEqual({ packages: 3, netKg: 30.5, grossKg: 34.75, amount: 3610.5 });
    expect(shippedProblems({ blNo: "", shippedAt: undefined })).toEqual(["BL_NO", "SHIPPED_AT"]);
    expect([transportDoc("SEA"), transportDoc("AIR"), transportDoc("ROAD")]).toEqual(["B/L", "AWB", "CMR"]);
  });
});
