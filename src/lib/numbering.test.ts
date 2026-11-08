import { describe, expect, it } from "vitest";
import { countryFromEmployeeCode, formatNumber, parseNumber, periodKey } from "./numbering";

const d = new Date(2026, 10, 2); // 2026-11-02 local

describe("numbering", () => {
  it("formats master-data numbers with monthly period", () => {
    expect(formatNumber("A", "TH", d, 1)).toBe("ATH26110001");
    expect(formatNumber("C", "TH", d, 1)).toBe("CTH2611001");
    expect(formatNumber("E", "VN", d, 7)).toBe("EVN2611007");
    expect(formatNumber("A", "TH", new Date(2026, 9, 5), 1)).toBe("ATH26100001");
  });

  it("formats document numbers with daily period, 2 digits by default", () => {
    expect(formatNumber("QT", "TH", d, 1)).toBe("QTTH26110201");
    expect(formatNumber("RP", "TH", d, 12)).toBe("RPTH26110212");
    expect(formatNumber("QT", "TH", new Date(2026, 9, 31), 1)).toBe("QTTH26103101");
  });

  it("uses 3 digits for stock movements", () => {
    expect(formatNumber("IB", "TH", d, 1)).toBe("IBTH261102001");
    expect(formatNumber("OB", "TH", d, 150)).toBe("OBTH261102150");
  });

  it("refuses overflow and never silently wraps", () => {
    expect(() => formatNumber("QT", "TH", d, 100)).toThrow();
    expect(() => formatNumber("OB", "TH", d, 1000)).toThrow();
    expect(() => formatNumber("A", "TH", d, 10000)).toThrow();
  });

  it("derives country from the creator's employee code", () => {
    expect(countryFromEmployeeCode("ETH2610001")).toBe("TH");
    expect(countryFromEmployeeCode("EVN2611003")).toBe("VN");
    expect(() => countryFromEmployeeCode("CTH2610001")).toThrow();
  });

  it("period keys", () => {
    expect(periodKey("A", d)).toBe("2611");
    expect(periodKey("QT", d)).toBe("261102");
  });

  it("parses numbers back", () => {
    expect(parseNumber("ATH26100001")).toEqual({ prefix: "A", country: "TH", period: "2610", serial: 1, tier: "master" });
    expect(parseNumber("QTTH26110201")).toEqual({ prefix: "QT", country: "TH", period: "261102", serial: 1, tier: "document" });
    expect(parseNumber("OBTH261102150")?.serial).toBe(150);
    expect(parseNumber("OBTH26110215")).toBeNull(); // wrong width for OB
    expect(parseNumber("XCGDD2610140001")).toBeNull(); // customer's own number: stored verbatim, never parsed as ours
  });
});

describe("supplier numbers (STH, 2026-11-08)", () => {
  it("parses STH like a customer number", () => {
    expect(parseNumber("STH2611001")).toEqual({ prefix: "S", country: "TH", period: "2611", serial: 1, tier: "master" });
    expect(parseNumber("STH26110001")).toBeNull(); // suppliers have 3 digits, not 4
  });
});
