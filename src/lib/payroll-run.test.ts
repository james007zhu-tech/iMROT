import { describe, expect, it } from "vitest";
import { payslipNo } from "./numbering";
import { targetFactor, quarterOf, isQuarterEnd, annualTax, computeLine, monthlyWithholding, perfFactor, periodsInYear, personalAllowances, taxOnIncome } from "./payroll-run";

describe("personal income tax", () => {
  it("walks the bands", () => {
    expect(annualTax(150_000)).toBe(0);
    expect(annualTax(300_000)).toBe(7_500);
    expect(annualTax(500_000)).toBe(27_500);
    expect(annualTax(750_000)).toBe(65_000);
    expect(annualTax(1_000_000)).toBe(115_000);
    expect(annualTax(2_000_000)).toBe(365_000);
  });
  it("caps the expense deduction at 100,000", () => {
    // 600,000 a year, single: 600k − 100k − 60k = 440k → 7,500 + 14,000
    expect(taxOnIncome(600_000, 60_000)).toBe(21_500);
    // 120,000 a year: half is expenses, the rest under the personal allowance
    expect(taxOnIncome(120_000, 60_000)).toBe(0);
  });
  it("adds what was declared", () => {
    expect(personalAllowances(null, 0, 0)).toBe(60_000);
    expect(personalAllowances({ maritalStatus: "married", spouseNoIncome: "yes", children: 2, parentsSupported: 1, lifeInsurance: 150_000 }, 10_500, 0)).toBe(60_000 + 60_000 + 60_000 + 30_000 + 100_000 + 10_500);
    expect(personalAllowances({ maritalStatus: "married" }, 0, 0)).toBe(60_000); // a working spouse earns no allowance
  });
});

describe("monthly withholding", () => {
  it("spreads the regular year evenly", () => {
    const w = monthlyWithholding({ regularMonthly: 50_000, periods: 12, irregularBefore: 0, irregularNow: 0, allowances: 60_000 + 875 * 12 });
    // 600,000 − 100,000 − 70,500 = 429,500 → 7,500 + 12,950 = 20,450 a year
    expect(w.regularTaxYear).toBe(20_450);
    expect(w.total).toBe(1_704.17);
  });
  it("taxes a bonus in its month at the marginal band", () => {
    const base = { regularMonthly: 50_000, periods: 12, irregularBefore: 0, allowances: 70_500 };
    const w = monthlyWithholding({ ...base, irregularNow: 30_000 });
    expect(w.irregularTax).toBe(3_000); // 10 % band
    expect(w.total).toBe(4_704.17);
  });
  it("lets earlier irregular pay push later pay into the next band", () => {
    const w = monthlyWithholding({ regularMonthly: 50_000, periods: 12, irregularBefore: 60_000, irregularNow: 30_000, allowances: 70_500 });
    // 429,500 + 60,000 = 489,500; + 30,000 crosses 500,000: 10,500 at 10 % + 19,500 at 15 %
    expect(w.irregularTax).toBe(3_975);
  });
  it("withholds nothing from a low wage", () => {
    expect(monthlyWithholding({ regularMonthly: 15_000, periods: 12, irregularBefore: 0, irregularNow: 2_000, allowances: 69_000 }).total).toBe(0);
  });
});

describe("绩效系数 and pay periods", () => {
  it("maps a score to the band's factor", () => {
    expect(perfFactor(95)).toBe(1.2); expect(perfFactor(90)).toBe(1.2); expect(perfFactor(85)).toBe(1); expect(perfFactor(72)).toBe(0.8); expect(perfFactor(60)).toBe(0.5); expect(perfFactor(40)).toBe(0);
    expect(perfFactor(null)).toBe(1);
  });
  it("counts the months left for a mid-year joiner", () => {
    expect(periodsInYear("2026-11", new Date("2024-03-01"))).toBe(12);
    expect(periodsInYear("2026-11", new Date("2026-01-15"))).toBe(12);
    expect(periodsInYear("2026-11", new Date("2026-09-01"))).toBe(4);
  });
});

describe("one payroll line", () => {
  it("adds up an engineer's month", () => {
    const l = computeLine({ baseSalary: 30_000, allowances: [{ name: "transport", amount: 2_000 }], overtime: 1_875, variablePay: 5_000, perfScore: 92, bonus: 0, periods: 12, irregularBefore: 0, otherDeduction: 0, reimbursement: 640 });
    expect(l.incentive).toBe(6_000);
    expect(l.gross).toBe(39_875);
    expect(l.ssoBase).toBe(17_500); expect(l.ssoEmployee).toBe(875); expect(l.ssoEmployer).toBe(875);
    // regular year 384,000 − 100,000 − 60,000 − 10,500 = 213,500 → 3,175 a year; irregular 7,875 at 5 %
    expect(l.whtDetail.regularTaxYear).toBe(3_175);
    expect(l.wht).toBe(658.33);
    expect(l.net).toBe(38_981.67);
    expect(l.employerCost).toBe(40_750);
  });
  it("uses the typed withholding when the MD overrides it", () => {
    const l = computeLine({ baseSalary: 80_000, allowances: [], overtime: 0, variablePay: 0, bonus: 0, periods: 12, irregularBefore: 0, whtManual: 5_000, otherDeduction: 0, reimbursement: 0 });
    expect(l.wht).toBe(5_000); expect(l.net).toBe(80_000 - 875 - 5_000);
  });
  it("pays no performance pay without a variable amount, whatever the score", () => {
    const l = computeLine({ baseSalary: 20_000, allowances: [], overtime: 0, variablePay: 0, perfScore: 40, bonus: 0, periods: 12, irregularBefore: 0, otherDeduction: 0, reimbursement: 0 });
    expect(l.incentive).toBe(0); expect(l.perfFactor).toBe(1);
  });
});

describe("销售绩效 (朱总 2026-11-11)", () => {
  it("pays nothing below 70 % of target, half at 70 %, in full at target, and has no cap", () => {
    expect(targetFactor(0.69)).toBe(0);
    expect(targetFactor(0.7)).toBe(0.5);
    expect(targetFactor(0.85)).toBe(0.75);
    expect(targetFactor(1)).toBe(1);
    expect(targetFactor(1.6)).toBe(1.6);
    expect(targetFactor(null)).toBe(0);
  });
  it("splits a 60,000 package 50 / 30 / 20 and pays the quarter with its last month", () => {
    // base 30,000; monthly 18,000 at 85 % of target → 13,500; quarter 3 × 12,000 at 120 % → 43,200
    const l = computeLine({ baseSalary: 30_000, allowances: [], overtime: 0, variablePay: 18_000, achievement: 0.85, quarterlyPay: 36_000, quarterAchieved: 1.2, bonus: 0, periods: 12, irregularBefore: 0, otherDeduction: 0, reimbursement: 0 });
    expect(l.incentive).toBe(13_500); expect(l.quarterIncentive).toBe(43_200); expect(l.gross).toBe(86_700);
  });
  it("knows quarters and numbers payslips", () => {
    expect(quarterOf("2026-11")).toBe("2026-Q4"); expect(isQuarterEnd("2026-12")).toBe(true); expect(isQuarterEnd("2026-11")).toBe(false);
    expect(payslipNo("2026-11", "ETH2611002")).toBe("ESTH2611E002");
  });
});
