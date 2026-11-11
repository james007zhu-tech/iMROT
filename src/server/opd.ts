/**
 * OPD · employees (ETH file). Only the MD may list employees or change anything but a person's own contact details
 * (decision 2026-11-03, widened 2026-11-08: each person may read their own file without salary and edit their
 * own contacts). Every change is audited; every salary view is audited.
 * The ETH/EVN/ECN number follows the legal entity chosen, so the MD can create the first staff of a new country.
 */
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { allocateNumber } from "@/lib/numbering-db";
import { hashPassword, verifyPassword } from "@/lib/password";
import type { CountryCode } from "@/lib/numbering";
import { daysUntil, salarySummary, type Allowance, type Deduction } from "@/lib/payroll";
import { audit } from "@/server/audit";
import { cleanBankDetails } from "@/lib/bank";

export const STAFF_ROLES = ["MD", "SALES", "ENGINEER", "WAREHOUSE", "FINANCE", "MANAGER"] as const;
export const CONTRACT_TYPES = ["PROBATION", "FIXED_TERM", "PERMANENT", "CONTRACTOR"] as const;
export const CREDENTIAL_KINDS = ["PASSPORT", "ID_CARD", "VISA", "WORK_PERMIT", "REPORT_90", "CONTRACT", "DEGREE", "CERTIFICATE", "DRIVING_LICENCE", "OTHER"] as const;
export const REVIEW_KINDS = ["PROBATION", "QUARTERLY", "ANNUAL", "SPECIAL"] as const;

export function assertMd(role: string) {
  if (role !== "MD") throw new Error("MD_ONLY");
}

/** Who may open an employee file: the MD any file, everyone else only their own. */
export function mayViewEmployee(me: { role: string; code: string }, code: string): boolean {
  return me.role === "MD" || me.code === code;
}

const Attachments = z.array(z.object({ name: z.string(), url: z.string(), kind: z.string().optional() })).optional();
const toDate = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : v instanceof Date ? v : new Date(String(v)));
const optDate = z.preprocess(toDate, z.date().optional());
const reqDate = z.preprocess(toDate, z.date());

/** Fields the MD edits on the file. Contact fields are also in OwnContactInput. */
export const ProfileInput = z.object({
  nationality: z.string().optional(),
  birthDate: optDate,
  gender: z.string().optional(),
  position: z.string().optional(),
  managerCode: z.string().optional(),
  joinedAt: optDate,
  probationEndsAt: optDate,
  confirmedAt: optDate,
  contractType: z.enum(CONTRACT_TYPES).optional(),
  contractEndsAt: optDate,
  workLocation: z.string().optional(),
  leftAt: optDate,
  leftReason: z.string().optional(),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  ssoNo: z.string().optional(),
  taxNo: z.string().optional(),
});

export const OwnContactInput = z.object({
  phone: z.string().optional(),
  phone2: z.string().optional(),
  lineId: z.string().optional(),
  wechatId: z.string().optional(),
  personalEmail: z.string().optional(),
  address: z.string().optional(),
  emergencyName: z.string().optional(),
  emergencyRelation: z.string().optional(),
  emergencyPhone: z.string().optional(),
});

export const EmployeeInput = z.object({
  actorCode: z.string(),
  entityCode: z.string(),
  name: z.string().min(1),
  nameLocal: z.string().optional(),
  role: z.enum(STAFF_ROLES),
  email: z.string().email(),
  locale: z.enum(["th", "zh", "en"]).default("th"),
  password: z.string().min(6),
  attachments: Attachments,
}).merge(ProfileInput).merge(OwnContactInput);

async function managerId(tx: Prisma.TransactionClient, code?: string) {
  if (!code) return undefined;
  const m = await tx.employee.findUnique({ where: { code } });
  if (!m) throw new Error(`MANAGER_UNKNOWN:${code}`);
  return m.id;
}

export async function createEmployee(input: z.input<typeof EmployeeInput>) {
  const d = EmployeeInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: d.actorCode } });
  assertMd(actor.role);
  const entity = await prisma.legalEntity.findUniqueOrThrow({ where: { code: d.entityCode } });
  return prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, { prefix: "E", createdByEmployeeCode: actor.code, entityId: entity.id, country: entity.countryCode as CountryCode, date: d.joinedAt });
    const { actorCode: _a, entityCode: _e, password, managerCode, attachments, ...rest } = d;
    void _a; void _e;
    const e = await tx.employee.create({ data: { ...rest, code, entityId: entity.id, passwordHash: hashPassword(password), managerId: await managerId(tx, managerCode), attachments: attachments as Prisma.InputJsonValue | undefined } });
    await audit(actor.id, "EMPLOYEE_CREATE", code, { role: d.role, entity: entity.code }, tx);
    return e;
  });
}

/** MD edit of the whole file: system fields, profile, contacts, and new archived files (appended). */
export async function updateEmployee(input: { actorCode: string; code: string; role?: (typeof STAFF_ROLES)[number]; active?: boolean; password?: string; locale?: string; name?: string; nameLocal?: string; attachments?: { name: string; url: string; kind?: string }[] } & z.input<typeof ProfileInput> & z.input<typeof OwnContactInput>) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: input.actorCode } });
  assertMd(actor.role);
  if (input.code === actor.code && input.role && input.role !== "MD") throw new Error("MD_SELF_DEMOTE");
  const profile = ProfileInput.parse(input);
  const contacts = OwnContactInput.parse(input);
  const { managerCode, ...p } = profile;
  return prisma.$transaction(async (tx) => {
    const cur = await tx.employee.findUniqueOrThrow({ where: { code: input.code } });
    const atts = input.attachments?.length ? ([...((cur.attachments as unknown[] | null) ?? []), ...input.attachments] as Prisma.InputJsonValue) : undefined;
    const e = await tx.employee.update({ where: { code: input.code }, data: { ...p, ...contacts, name: input.name, nameLocal: input.nameLocal, role: input.role, active: input.active, locale: input.locale, managerId: managerCode === undefined ? undefined : managerCode === "" ? null : await managerId(tx, managerCode), passwordHash: input.password ? hashPassword(input.password) : undefined, attachments: atts } });
    await audit(actor.id, "EMPLOYEE_UPDATE", input.code, { role: input.role, active: input.active, passwordReset: !!input.password, leftAt: input.leftAt ? String(input.leftAt) : undefined }, tx);
    return e;
  });
}

/** A person updates their own contact details (decision 2026-11-08). Nothing else on the file is theirs to change. */
export async function updateOwnContacts(actorCode: string, input: z.input<typeof OwnContactInput>) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  const d = OwnContactInput.parse(input);
  const e = await prisma.employee.update({ where: { id: actor.id }, data: d });
  await audit(actor.id, "EMPLOYEE_SELF_UPDATE", actor.code, { fields: Object.keys(d).filter((k) => d[k as keyof typeof d] !== undefined) });
  return e;
}

/** Re-enter the password to see an employee's contacts (and, for the MD, salary amounts) in full; audited. */
export async function authorizeEmployeeReveal(actorCode: string, password: string, code: string) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (!mayViewEmployee(actor, code)) throw new Error("FORBIDDEN");
  if (!verifyPassword(password, actor.passwordHash)) throw new Error("WRONG_PASSWORD");
  await audit(actor.id, actor.role === "MD" ? "EMPLOYEE_REVEAL" : "CONTACT_REVEAL", code, {});
}

// ── careers ────────────────────────────────────────────────────────────────────────────────────────────────

export const CareerInput = z.object({ fromYm: z.string().regex(/^\d{4}-\d{2}$/, "YM"), toYm: z.string().regex(/^\d{4}-\d{2}$/, "YM").optional(), company: z.string().min(1), title: z.string().optional(), summary: z.string().optional(), source: z.enum(["AI", "MANUAL"]).default("MANUAL") });

export async function setCareers(actorCode: string, code: string, rows: z.input<typeof CareerInput>[]) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const lines = rows.map((r) => CareerInput.parse(r));
  return prisma.$transaction(async (tx) => {
    const e = await tx.employee.findUniqueOrThrow({ where: { code } });
    await tx.employeeCareer.deleteMany({ where: { employeeId: e.id } });
    await tx.employeeCareer.createMany({ data: lines.map((l, i) => ({ ...l, employeeId: e.id, sort: i })) });
    await audit(actor.id, "EMPLOYEE_UPDATE", code, { careers: lines.length }, tx);
  });
}

// ── credentials ────────────────────────────────────────────────────────────────────────────────────────────

export const CredentialInput = z.object({ kind: z.enum(CREDENTIAL_KINDS), title: z.string().optional(), number: z.string().optional(), issuedAt: optDate, expiresAt: optDate, remindDays: z.coerce.number().int().min(0).max(365).default(90), file: z.object({ name: z.string(), url: z.string(), kind: z.string().optional() }).optional(), note: z.string().optional() });

export async function addCredential(actorCode: string, code: string, input: z.input<typeof CredentialInput>) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const d = CredentialInput.parse(input);
  const e = await prisma.employee.findUniqueOrThrow({ where: { code } });
  const c = await prisma.employeeCredential.create({ data: { ...d, employeeId: e.id, file: d.file as Prisma.InputJsonValue | undefined } });
  await audit(actor.id, "EMPLOYEE_UPDATE", code, { credential: d.kind, expiresAt: d.expiresAt ? String(d.expiresAt) : undefined });
  return c;
}

/** Credentials read by the upload box (passport, ID card, visa, work permit, degree): added unless the same one is already on file. */
export async function addQuickCredentials(actorCode: string, code: string, quick: { kind: (typeof CREDENTIAL_KINDS)[number]; number?: string; expiresAt?: string; title?: string }[]) {
  if (!quick.length) return 0;
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const e = await prisma.employee.findUniqueOrThrow({ where: { code }, include: { credentials: true } });
  let n = 0;
  for (const q of quick) {
    const exp = q.expiresAt ? new Date(q.expiresAt) : undefined;
    const dup = e.credentials.some((c) => c.kind === q.kind && ((q.number && c.number === q.number) || (!q.number && exp && c.expiresAt && c.expiresAt.getTime() === exp.getTime()) || (!q.number && !exp && q.title && c.title === q.title)));
    if (dup) continue;
    await prisma.employeeCredential.create({ data: { employeeId: e.id, kind: q.kind, number: q.number, expiresAt: exp, title: q.title, remindDays: q.kind === "REPORT_90" ? 14 : 90 } });
    n++;
  }
  if (n) await audit(actor.id, "EMPLOYEE_UPDATE", code, { credentialsFromUpload: n });
  return n;
}

export async function removeCredential(actorCode: string, id: string) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const c = await prisma.employeeCredential.delete({ where: { id }, include: { employee: true } });
  await audit(actor.id, "EMPLOYEE_UPDATE", c.employee.code, { credentialRemoved: c.kind });
}

/** Credentials that need attention: expired, or inside their reminder window. Used by the list page (orange). */
export function credentialAlerts<T extends { kind: string; expiresAt: Date | null; remindDays: number }>(creds: T[], now = new Date()) {
  return creds.map((c) => ({ ...c, days: daysUntil(c.expiresAt, now) })).filter((c) => c.days !== undefined && c.days <= c.remindDays).sort((a, b) => a.days! - b.days!);
}

/** Probation ends (or ended) without a confirmation or a probation review. */
export function probationDue(e: { probationEndsAt: Date | null; confirmedAt: Date | null; leftAt: Date | null }, reviews: { kind: string }[], now = new Date(), window = 14): boolean {
  if (!e.probationEndsAt || e.confirmedAt || e.leftAt) return false;
  if (reviews.some((r) => r.kind === "PROBATION")) return false;
  return daysUntil(e.probationEndsAt, now)! <= window;
}

// ── salary ─────────────────────────────────────────────────────────────────────────────────────────────────

const Money = z.coerce.number().min(0);
const Rate = z.coerce.number().min(0).max(1).optional();
export const SalaryInputSchema = z.object({
  effectiveFrom: reqDate,
  currency: z.string().regex(/^[A-Z]{3}$/).default("THB"),
  baseSalary: Money,
  allowances: z.array(z.object({ name: z.string().min(1), amount: Money, taxable: z.boolean().optional() })).default([]),
  ssoWageBase: Money.optional(),
  ssoEmployeeRate: Rate,
  ssoEmployerRate: Rate,
  pvdEmployeeRate: Rate,
  pvdEmployerRate: Rate,
  taxDeductions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  whtMonthly: Money.optional(),
  variablePay: Money.optional(), /// 绩效工资 at 100 %
  otherDeductions: z.array(z.object({ name: z.string().min(1), amount: Money })).default([]),
  reason: z.string().min(1),
  note: z.string().optional(),
  approvedByCode: z.string().optional(), /// defaults to the actor (the MD)
  approvedAt: optDate,
  attachments: Attachments,
});

/** MD only. Writes the structure as entered plus the derived figures (gross, SSO amounts, net estimate). */
export async function addSalaryRecord(actorCode: string, code: string, input: z.input<typeof SalaryInputSchema>) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const d = SalaryInputSchema.parse(input);
  const e = await prisma.employee.findUniqueOrThrow({ where: { code }, include: { entity: true } });
  const approver = d.approvedByCode ? await prisma.employee.findUniqueOrThrow({ where: { code: d.approvedByCode } }) : actor;
  const s = salarySummary({ baseSalary: d.baseSalary, allowances: d.allowances as Allowance[], ssoWageBase: d.ssoWageBase, ssoEmployeeRate: d.ssoEmployeeRate, ssoEmployerRate: d.ssoEmployerRate, pvdEmployeeRate: d.pvdEmployeeRate, pvdEmployerRate: d.pvdEmployerRate, whtMonthly: d.whtMonthly, otherDeductions: d.otherDeductions as Deduction[], countryCode: e.entity.countryCode });
  const rec = await prisma.salaryRecord.create({ data: {
    employeeId: e.id, effectiveFrom: d.effectiveFrom, currency: d.currency, baseSalary: d.baseSalary,
    allowances: d.allowances as Prisma.InputJsonValue, allowanceTotal: s.allowanceTotal, grossMonthly: s.grossMonthly, variablePay: d.variablePay,
    ssoWageBase: s.ssoWageBase, ssoEmployeeRate: s.ssoEmployeeRate, ssoEmployerRate: s.ssoEmployerRate, ssoEmployee: s.ssoEmployee, ssoEmployer: s.ssoEmployer,
    pvdEmployeeRate: d.pvdEmployeeRate, pvdEmployerRate: d.pvdEmployerRate,
    taxDeductions: d.taxDeductions as Prisma.InputJsonValue | undefined, whtMonthly: s.whtMonthly, otherDeductions: d.otherDeductions as Prisma.InputJsonValue, netEstimate: s.netEstimate,
    reason: d.reason, note: d.note, approvedById: approver.id, approvedAt: d.approvedAt ?? new Date(), createdById: actor.id, attachments: d.attachments as Prisma.InputJsonValue | undefined,
  } });
  await audit(actor.id, "SALARY_ADD", code, { effectiveFrom: d.effectiveFrom.toISOString().slice(0, 10), reason: d.reason, currency: d.currency });
  return rec;
}

/** Every look at salary figures is logged (decision 2026-11-08). Call from the page when amounts are shown in full. */
export async function auditSalaryView(actorCode: string, code: string) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  await audit(actor.id, "SALARY_VIEW", code, {});
}

/** MD only: all salary rows, newest first (the first row is the current salary). */
export async function salaryHistory(viewer: { role: string }, employeeId: string) {
  if (viewer.role !== "MD") return [];
  return prisma.salaryRecord.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" }, include: { approvedBy: { select: { name: true } } } });
}

/** Current salary = the latest row effective on or before `at`. */
export async function currentSalary(employeeId: string, at = new Date()) {
  return prisma.salaryRecord.findFirst({ where: { employeeId, effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: "desc" } });
}

// ── performance reviews ────────────────────────────────────────────────────────────────────────────────────

export const ReviewInput = z.object({ period: z.string().min(1), kind: z.enum(REVIEW_KINDS), score: z.coerce.number().min(0).max(100).optional(), grade: z.string().optional(), reviewedAt: reqDate, conclusion: z.string().optional(), improvements: z.string().optional(), visibleToEmployee: z.boolean().default(true), attachments: Attachments, confirmProbation: z.boolean().optional() });

export async function addReview(actorCode: string, code: string, input: z.input<typeof ReviewInput>) {
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const d = ReviewInput.parse(input);
  return prisma.$transaction(async (tx) => {
    const e = await tx.employee.findUniqueOrThrow({ where: { code } });
    const r = await tx.performanceReview.create({ data: { employeeId: e.id, period: d.period, kind: d.kind, score: d.score, grade: d.grade, reviewerId: actor.id, reviewedAt: d.reviewedAt, conclusion: d.conclusion, improvements: d.improvements, visibleToEmployee: d.visibleToEmployee, attachments: d.attachments as Prisma.InputJsonValue | undefined } });
    if (d.kind === "PROBATION" && d.confirmProbation && !e.confirmedAt) await tx.employee.update({ where: { id: e.id }, data: { confirmedAt: d.reviewedAt, contractType: e.contractType === "PROBATION" ? "PERMANENT" : e.contractType } });
    await audit(actor.id, "REVIEW_ADD", code, { period: d.period, kind: d.kind, score: d.score, grade: d.grade }, tx);
    return r;
  });
}

/** The whole file for the page. Salary rows only for the MD; reviews filtered for the person. */
export async function getEmployeeFile(viewer: { role: string; code: string }, code: string) {
  if (!mayViewEmployee(viewer, code)) throw new Error("FORBIDDEN");
  const md = viewer.role === "MD";
  const e = await prisma.employee.findUnique({ where: { code }, include: {
    entity: true, manager: { select: { code: true, name: true } },
    careers: { orderBy: [{ sort: "asc" }, { fromYm: "desc" }] },
    credentials: { orderBy: [{ expiresAt: "asc" }] },
    reviews: { where: md ? {} : { visibleToEmployee: true }, orderBy: { reviewedAt: "desc" }, include: { reviewer: { select: { name: true } } } },
  } });
  return e;
}

/** Legal entities (DCiT / DCiV / DCiC …): MD only, audited. The country code is fixed once created — it is in every number. */
export const EntityInput = z.object({
  actorCode: z.string(),
  countryCode: z.string().regex(/^[A-Z]{2}$/, "ENTITY_COUNTRY"),
  code: z.string().regex(/^DCi[A-Z]$/, "ENTITY_CODE"),
  nameEn: z.string().min(1),
  nameLocal: z.string().optional(),
  taxId: z.string().optional(),
  branchCode: z.string().optional(),
  addressEn: z.string().optional(),
  addressLocal: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  website: z.string().optional(),
  signatoryName: z.string().optional(),
  localCurrency: z.string().regex(/^[A-Z]{3}$/),
  vatRate: z.number().min(0).max(1),
  taxInvoiceBookSize: z.number().int().min(1).max(1000).optional(),
  vatRegisteredFrom: z.preprocess((v) => (v === undefined || v === null || v === "" ? undefined : v instanceof Date ? v : new Date(String(v))), z.date().optional()),
  /// 收款银行 (2026-11-09). Absent = leave as is; all fields empty = clear.
  bankDetails: z.object({ bank: z.string().optional(), branch: z.string().optional(), bankCode: z.string().optional(), branchCode: z.string().optional(), accountName: z.string().optional(), swift: z.string().optional(), accounts: z.record(z.string()).optional() }).optional(),
});

export async function saveLegalEntity(input: z.input<typeof EntityInput>) {
  const { actorCode, countryCode, bankDetails, ...rest } = EntityInput.parse(input);
  const actor = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  assertMd(actor.role);
  const bank = bankDetails === undefined ? undefined : cleanBankDetails(bankDetails);
  const data = { ...rest, ...(bank === undefined ? {} : { bankDetails: bank ? (bank as Prisma.InputJsonValue) : Prisma.JsonNull }) };
  const clash = await prisma.legalEntity.findFirst({ where: { code: data.code, NOT: { countryCode } } });
  if (clash) throw new Error(`ENTITY_CODE_TAKEN:${data.code}:${clash.countryCode}`);
  const saved = await prisma.legalEntity.upsert({ where: { countryCode }, update: data, create: { countryCode, ...data, bookCurrency: "CNY" } });
  await audit(actor.id, "ENTITY_SAVE", saved.code, { countryCode, ...rest, ...(bank === undefined ? {} : { bankDetails: bank }) });
  return saved;
}
