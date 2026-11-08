/**
 * Salary record arithmetic (ETH file, decision 2026-11-08): the system records the salary structure the accountant
 * works from — gross, social security base and rates, provident fund, declared tax deductions, estimated withholding.
 * It does not run payroll. Every statutory figure below is a DEFAULT the form pre-fills and the MD may override per
 * record; the record keeps the values that were actually used, so later law changes never rewrite history.
 *
 * Thailand social security (ประกันสังคม, Section 33) defaults — PLACEHOLDERS to confirm with the accountant:
 *   contribution 5 % employee + 5 % employer on a wage base between the legal floor and ceiling.
 */
export interface StatutoryDefaults { ssoEmployeeRate: number; ssoEmployerRate: number; ssoWageFloor: number; ssoWageCeiling: number }

export const STATUTORY: Record<string, StatutoryDefaults> = {
  TH: { ssoEmployeeRate: 0.05, ssoEmployerRate: 0.05, ssoWageFloor: 1650, ssoWageCeiling: 17500 },
};

export function statutoryFor(countryCode: string): StatutoryDefaults | undefined {
  return STATUTORY[countryCode];
}

export interface Allowance { name: string; amount: number; taxable?: boolean }
export interface Deduction { name: string; amount: number }

export interface SalaryInput {
  baseSalary: number;
  allowances?: Allowance[];
  ssoWageBase?: number; /// when omitted: gross clamped to floor…ceiling of the country defaults
  ssoEmployeeRate?: number;
  ssoEmployerRate?: number;
  pvdEmployeeRate?: number;
  pvdEmployerRate?: number;
  whtMonthly?: number;
  otherDeductions?: Deduction[];
  countryCode?: string;
}

export interface SalarySummary {
  allowanceTotal: number;
  grossMonthly: number;
  ssoWageBase?: number;
  ssoEmployeeRate?: number;
  ssoEmployerRate?: number;
  ssoEmployee?: number;
  ssoEmployer?: number;
  pvdEmployee?: number;
  pvdEmployer?: number;
  whtMonthly?: number;
  otherTotal: number;
  netEstimate: number;
  employerCost: number; /// gross + employer SSO + employer PVD
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function clampWageBase(gross: number, d?: StatutoryDefaults): number {
  if (!d) return gross;
  return Math.min(Math.max(gross, d.ssoWageFloor), d.ssoWageCeiling);
}

export function salarySummary(i: SalaryInput): SalarySummary {
  const d = i.countryCode ? statutoryFor(i.countryCode) : undefined;
  const allowanceTotal = r2((i.allowances ?? []).reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const grossMonthly = r2((Number(i.baseSalary) || 0) + allowanceTotal);
  const ssoEmployeeRate = i.ssoEmployeeRate ?? d?.ssoEmployeeRate;
  const ssoEmployerRate = i.ssoEmployerRate ?? d?.ssoEmployerRate;
  const ssoWageBase = ssoEmployeeRate === undefined && ssoEmployerRate === undefined ? undefined : (i.ssoWageBase ?? clampWageBase(grossMonthly, d));
  const ssoEmployee = ssoWageBase !== undefined && ssoEmployeeRate !== undefined ? r2(ssoWageBase * ssoEmployeeRate) : undefined;
  const ssoEmployer = ssoWageBase !== undefined && ssoEmployerRate !== undefined ? r2(ssoWageBase * ssoEmployerRate) : undefined;
  const pvdEmployee = i.pvdEmployeeRate !== undefined ? r2(grossMonthly * i.pvdEmployeeRate) : undefined;
  const pvdEmployer = i.pvdEmployerRate !== undefined ? r2(grossMonthly * i.pvdEmployerRate) : undefined;
  const otherTotal = r2((i.otherDeductions ?? []).reduce((s, a) => s + (Number(a.amount) || 0), 0));
  const whtMonthly = i.whtMonthly !== undefined ? r2(i.whtMonthly) : undefined;
  const netEstimate = r2(grossMonthly - (ssoEmployee ?? 0) - (pvdEmployee ?? 0) - (whtMonthly ?? 0) - otherTotal);
  const employerCost = r2(grossMonthly + (ssoEmployer ?? 0) + (pvdEmployer ?? 0));
  return { allowanceTotal, grossMonthly, ssoWageBase, ssoEmployeeRate, ssoEmployerRate, ssoEmployee, ssoEmployer, pvdEmployee, pvdEmployer, whtMonthly, otherTotal, netEstimate, employerCost };
}

/** Days until a credential expires (negative = already expired); undefined when there is no expiry. */
export function daysUntil(expiresAt: Date | null | undefined, now = new Date()): number | undefined {
  if (!expiresAt) return undefined;
  return Math.ceil((expiresAt.getTime() - now.getTime()) / 86_400_000);
}

/** Masked amount for lists and exports: same digit count, all stars, thousands grouping kept. */
export function maskAmount(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const s = Math.round(Math.abs(Number(n))).toLocaleString("en-US");
  return s.replace(/\d/g, "*");
}
