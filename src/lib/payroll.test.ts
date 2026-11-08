import { describe, expect, it } from "vitest";
import { clampWageBase, daysUntil, maskAmount, salarySummary, STATUTORY } from "./payroll";

describe("salarySummary", () => {
  it("adds allowances into gross and applies the Thai SSO defaults with the wage ceiling", () => {
    const s = salarySummary({ baseSalary: 45000, allowances: [{ name: "housing", amount: 5000 }, { name: "phone", amount: 1000 }], countryCode: "TH" });
    expect(s.allowanceTotal).toBe(6000);
    expect(s.grossMonthly).toBe(51000);
    expect(s.ssoWageBase).toBe(STATUTORY.TH.ssoWageCeiling);
    expect(s.ssoEmployee).toBe(STATUTORY.TH.ssoWageCeiling * 0.05);
    expect(s.ssoEmployer).toBe(s.ssoEmployee);
    expect(s.netEstimate).toBe(51000 - s.ssoEmployee!);
    expect(s.employerCost).toBe(51000 + s.ssoEmployer!);
  });

  it("uses the gross as SSO base when it is under the ceiling, and the floor when under the floor", () => {
    expect(salarySummary({ baseSalary: 12000, countryCode: "TH" }).ssoWageBase).toBe(12000);
    expect(clampWageBase(1000, STATUTORY.TH)).toBe(STATUTORY.TH.ssoWageFloor);
  });

  it("keeps the record's own rates and figures over the defaults", () => {
    const s = salarySummary({ baseSalary: 30000, countryCode: "TH", ssoWageBase: 15000, ssoEmployeeRate: 0.05, ssoEmployerRate: 0.05, pvdEmployeeRate: 0.03, pvdEmployerRate: 0.03, whtMonthly: 1234.5, otherDeductions: [{ name: "loan", amount: 2000 }] });
    expect(s.ssoEmployee).toBe(750);
    expect(s.pvdEmployee).toBe(900);
    expect(s.otherTotal).toBe(2000);
    expect(s.netEstimate).toBe(30000 - 750 - 900 - 1234.5 - 2000);
    expect(s.employerCost).toBe(30000 + 750 + 900);
  });

  it("has no SSO figures for a country without defaults unless rates are given", () => {
    const s = salarySummary({ baseSalary: 10000, countryCode: "XX" });
    expect(s.ssoEmployee).toBeUndefined();
    expect(s.netEstimate).toBe(10000);
  });
});

describe("helpers", () => {
  it("counts days to expiry and masks amounts digit for digit", () => {
    const now = new Date("2026-11-08T00:00:00Z");
    expect(daysUntil(new Date("2027-01-15T00:00:00Z"), now)).toBe(68);
    expect(daysUntil(new Date("2026-11-01T00:00:00Z"), now)).toBeLessThan(0);
    expect(daysUntil(null)).toBeUndefined();
    expect(maskAmount(45000)).toBe("**,***");
    expect(maskAmount(null)).toBe("—");
  });
});
