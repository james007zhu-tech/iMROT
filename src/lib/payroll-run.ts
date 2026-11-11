/**
 * 月度工资 (朱总 2026-11-10: "每月工资自动计算，包括 PND1、SSO，根据薪资待遇和激励政策自动计算，要有绩效评估的过程").
 * Pure arithmetic for one employee's month; the server feeds it and stores every figure it used.
 *
 * Personal income tax — rates and allowances checked 2026-11-11 (Revenue Code; unchanged since tax year 2017):
 *   employment-income expenses 50 % capped at 100,000; personal 60,000; spouse without income 60,000;
 *   child 30,000 each; parent supported 30,000 each; social security actually paid; provident fund; life insurance ≤ 100,000;
 *   home-loan interest ≤ 100,000. Bands: 0–150k exempt, then 5/10/15/20/25/30/35 %.
 * Withholding (ภ.ง.ด.1, Revenue Code s.50(1)): the year's regular pay is projected (monthly × pay periods of the year), taxed, and
 * divided by the periods; pay that is not regular (overtime, performance pay, bonus) is taxed in the month it is paid at
 * the marginal bands on top of the regular year. THE ACCOUNTANT CONFIRMS THE METHOD — the MD may type the figure instead.
 */
import { clampWageBase, statutoryFor, type Allowance } from "./payroll";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const PIT_BANDS: [number, number][] = [[150_000, 0], [300_000, 0.05], [500_000, 0.10], [750_000, 0.15], [1_000_000, 0.20], [2_000_000, 0.25], [5_000_000, 0.30], [Infinity, 0.35]];

/** Tax of a year on net (taxable) income. */
export function annualTax(net: number): number {
  let tax = 0, lower = 0;
  for (const [upper, rate] of PIT_BANDS) {
    if (net <= lower) break;
    tax += (Math.min(net, upper) - lower) * rate;
    lower = upper;
  }
  return r2(tax);
}

/** What the person declared to the accountant (SalaryRecord.taxDeductions). */
export interface TaxProfile { maritalStatus?: string; spouseNoIncome?: string | boolean | number; children?: number | string; parentsSupported?: number | string; lifeInsurance?: number | string; homeLoanInterest?: number | string }

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0);

/** Allowances of the year, without the 50 % expense deduction (that depends on income). */
export function personalAllowances(p: TaxProfile | null | undefined, ssoAnnual: number, pvdAnnual: number): number {
  const spouse = p?.maritalStatus === "married" && (p.spouseNoIncome === true || p.spouseNoIncome === "yes" || p.spouseNoIncome === 1 || p.spouseNoIncome === "1") ? 60_000 : 0;
  return 60_000 + spouse + n(p?.children) * 30_000 + n(p?.parentsSupported) * 30_000 + Math.min(n(p?.lifeInsurance), 100_000) + Math.min(n(p?.homeLoanInterest), 100_000) + ssoAnnual + pvdAnnual;
}

export function taxOnIncome(income: number, allowances: number): number {
  const expenses = Math.min(income * 0.5, 100_000);
  return annualTax(Math.max(0, income - expenses - allowances));
}

export interface WithholdingInput {
  regularMonthly: number; /// base + taxable allowances
  periods: number; /// pay periods of this person in the year (12, fewer for a mid-year joiner)
  irregularBefore: number; /// overtime, performance pay and bonus already paid earlier this year
  irregularNow: number; /// … paid this month
  allowances: number; /// personalAllowances()
}
export interface Withholding { regularYear: number; regularTaxYear: number; regularTaxMonth: number; irregularTax: number; total: number }

export function monthlyWithholding(i: WithholdingInput): Withholding {
  const periods = Math.max(1, Math.round(i.periods));
  const regularYear = r2(i.regularMonthly * periods);
  const regularTaxYear = taxOnIncome(regularYear, i.allowances);
  const before = taxOnIncome(regularYear + i.irregularBefore, i.allowances);
  const after = taxOnIncome(regularYear + i.irregularBefore + i.irregularNow, i.allowances);
  const regularTaxMonth = r2(regularTaxYear / periods);
  const irregularTax = r2(Math.max(0, after - before));
  return { regularYear, regularTaxYear, regularTaxMonth, irregularTax, total: r2(regularTaxMonth + irregularTax) };
}

/** 绩效系数: the factor a month's score earns. Bands are the company's policy (PayrollRun.policy keeps the set used). */
export interface PerfBand { min: number; factor: number }
export const DEFAULT_BANDS: PerfBand[] = [{ min: 90, factor: 1.2 }, { min: 80, factor: 1 }, { min: 70, factor: 0.8 }, { min: 60, factor: 0.5 }, { min: 0, factor: 0 }];
export function perfFactor(score: number | null | undefined, bands: PerfBand[] = DEFAULT_BANDS): number {
  if (score == null) return 1;
  return [...bands].sort((a, b) => b.min - a.min).find((b) => score >= b.min)?.factor ?? 0;
}

/**
 * 销售绩效 (朱总 2026-11-11): "低于目标的 70% 则绩效为 0，达到 70% 为 50%，上不封顶".
 * Between 70 % and 100 % the payout rises in a straight line from 50 % to 100 %; above target it equals the achievement.
 */
export function targetFactor(achievement: number | null | undefined): number {
  if (achievement == null || !Number.isFinite(achievement) || achievement < 0.7) return 0;
  if (achievement <= 1) return Math.round((0.5 + ((achievement - 0.7) / 0.3) * 0.5) * 1000) / 1000;
  return Math.round(achievement * 1000) / 1000;
}
export const quarterOf = (month: string) => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
export const isQuarterEnd = (month: string) => Number(month.slice(5, 7)) % 3 === 0;

/** Pay periods in the calendar year for someone who joined on `joinedAt` (12 when they joined before it). */
export function periodsInYear(month: string, joinedAt?: Date | null): number {
  const year = Number(month.slice(0, 4));
  if (!joinedAt || joinedAt.getUTCFullYear() < year) return 12;
  if (joinedAt.getUTCFullYear() > year) return 1;
  return 12 - joinedAt.getUTCMonth();
}

export interface LineInput {
  baseSalary: number; allowances: Allowance[];
  overtime: number; variablePay: number; perfScore?: number | null; bands?: PerfBand[]; bonus: number;
  achievement?: number | null; /// set = sales: the month's factor comes from the target, not from a score
  quarterlyPay?: number; quarterAchieved?: number | null; /// three months' quarterly pay at 100 %, and the quarter's achievement
  ssoWageBase?: number | null; ssoEmployeeRate?: number | null; ssoEmployerRate?: number | null; pvdEmployeeRate?: number | null; pvdEmployerRate?: number | null;
  profile?: TaxProfile | null; periods: number; irregularBefore: number;
  whtManual?: number | null; otherDeduction: number; reimbursement: number; countryCode?: string;
}
export interface LineResult {
  allowanceTotal: number; taxableAllowances: number; perfFactor: number; incentive: number; quarterFactor: number; quarterIncentive: number; gross: number;
  ssoBase: number; ssoEmployee: number; ssoEmployer: number; pvdEmployee: number; pvdEmployer: number;
  wht: number; whtDetail: Withholding & { allowances: number }; net: number; employerCost: number;
}

export function computeLine(i: LineInput): LineResult {
  const d = statutoryFor(i.countryCode ?? "TH");
  const allowanceTotal = r2(i.allowances.reduce((s, a) => s + n(a.amount), 0));
  const taxableAllowances = r2(i.allowances.filter((a) => a.taxable !== false).reduce((s, a) => s + n(a.amount), 0));
  const factor = i.achievement !== undefined ? targetFactor(i.achievement) : i.variablePay > 0 ? perfFactor(i.perfScore, i.bands) : 1;
  const quarterFactor = i.quarterlyPay ? targetFactor(i.quarterAchieved) : 0;
  const quarterIncentive = r2((i.quarterlyPay ?? 0) * quarterFactor);
  const incentive = r2(i.variablePay * factor);
  const regular = r2(i.baseSalary + allowanceTotal);
  const irregularNow = r2(i.overtime + incentive + quarterIncentive + i.bonus);
  const gross = r2(regular + irregularNow);
  // social security is on the regular wage, clamped to the legal base — the salary record's own base wins when it has one
  const eRate = i.ssoEmployeeRate ?? d?.ssoEmployeeRate ?? 0, rRate = i.ssoEmployerRate ?? d?.ssoEmployerRate ?? 0;
  const ssoBase = eRate || rRate ? r2(i.ssoWageBase ?? clampWageBase(regular, d)) : 0;
  const ssoEmployee = r2(ssoBase * eRate), ssoEmployer = r2(ssoBase * rRate);
  const pvdEmployee = r2(i.baseSalary * (i.pvdEmployeeRate ?? 0)), pvdEmployer = r2(i.baseSalary * (i.pvdEmployerRate ?? 0));
  const allowances = personalAllowances(i.profile, ssoEmployee * i.periods, pvdEmployee * i.periods);
  const w = monthlyWithholding({ regularMonthly: r2(i.baseSalary + taxableAllowances), periods: i.periods, irregularBefore: i.irregularBefore, irregularNow, allowances });
  const wht = i.whtManual != null ? r2(i.whtManual) : w.total;
  const net = r2(gross - ssoEmployee - pvdEmployee - wht - i.otherDeduction + i.reimbursement);
  return { allowanceTotal, taxableAllowances, perfFactor: factor, incentive, quarterFactor, quarterIncentive, gross, ssoBase, ssoEmployee, ssoEmployer, pvdEmployee, pvdEmployer, wht, whtDetail: { ...w, allowances }, net, employerCost: r2(gross + ssoEmployer + pvdEmployer) };
}
