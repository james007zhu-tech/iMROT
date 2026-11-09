/**
 * 调薪通知单 — the last step of a salary adjustment (2026-11-09): a STRICTLY CONFIDENTIAL thank-you letter in Thai, English
 * and Chinese, template 32 (scripts/templates/build_hr_letters.py), filled from the salary record and the one before it.
 * MD only, like every salary figure; every render is audited.
 */
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { audit } from "@/server/audit";
import { fillDocx } from "@/lib/docx/fill";
import { convertToPdf } from "@/server/office";
import { fmtDate, fmtMonth, money, payday, salaryChange, type LetterDetails } from "@/lib/salary-letter";
import type { Prisma } from "@prisma/client";

const TEMPLATES = path.join(process.cwd(), "templates", "word");
const OUT = path.join(process.cwd(), "uploads", "documents");
export const SALARY_LETTER_TEMPLATE = "32_Salary_Adjustment_Notice.docx";

async function mdOnly(actorCode: string) {
  const a = await prisma.employee.findUniqueOrThrow({ where: { code: actorCode } });
  if (a.role !== "MD") throw new Error("MD_ONLY");
  return a;
}

/** The record and the one in force just before it (what "before" means on the letter). */
async function recordPair(recordId: string) {
  const rec = await prisma.salaryRecord.findUniqueOrThrow({ where: { id: recordId }, include: { employee: { include: { entity: true } }, approvedBy: true } });
  const prev = await prisma.salaryRecord.findFirst({ where: { employeeId: rec.employeeId, id: { not: rec.id }, effectiveFrom: { lt: rec.effectiveFrom } }, orderBy: { effectiveFrom: "desc" } });
  return { rec, prev };
}

/** Save the personal part of the letter: greeting, job title on the letter, thanks in three languages. */
export async function saveLetterDetails(actorCode: string, recordId: string, d: LetterDetails) {
  const actor = await mdOnly(actorCode);
  const rec = await prisma.salaryRecord.findUniqueOrThrow({ where: { id: recordId }, include: { employee: { select: { code: true } } } });
  const clean = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]).filter(([, v]) => v)) as LetterDetails;
  await audit(actor.id, "SALARY_LETTER_EDIT", rec.employee.code, { recordId });
  return prisma.salaryRecord.update({ where: { id: recordId }, data: { letter: { ...((rec.letter as object | null) ?? {}), ...clean } as Prisma.InputJsonValue } });
}

export async function salaryLetterFields(recordId: string) {
  const { rec, prev } = await recordPair(recordId);
  const ch = salaryChange(prev ? Number(prev.baseSalary) : undefined, Number(rec.baseSalary));
  if (!ch) throw new Error("NO_PREVIOUS_SALARY"); // a first salary is an offer, not an adjustment
  if (ch.diff <= 0) throw new Error("NOT_AN_INCREASE");
  const e = rec.employee, l = (rec.letter as LetterDetails | null) ?? {};
  const eff = rec.effectiveFrom, pay = payday(eff), today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  const monthOf = new Date(Date.UTC(eff.getUTCFullYear(), eff.getUTCMonth(), 1));
  const salutation = l.salutation || e.name.split(/\s+/)[0];
  return {
    LETTER_NO: `${e.code}-SAL-${eff.toISOString().slice(0, 7).replace("-", "")}`,
    ISSUE_DATE: fmtDate.en(today),
    EMP_NAME: e.name, TO_NAME: [e.name, e.nameLocal].filter(Boolean).join("\n"), POSITION: l.position || e.position || "", EMP_CODE: e.code,
    SALUTATION: salutation,
    OLD_BASE: money(ch.oldBase), NEW_BASE: money(ch.newBase), INCREASE: money(ch.diff), INCREASE_PCT: ch.pct,
    EFFECTIVE_EN: fmtDate.en(eff), EFFECTIVE_TH: fmtDate.th(eff), EFFECTIVE_ZH: fmtDate.zh(eff),
    FIRST_MONTH_EN: fmtMonth.en(monthOf), FIRST_MONTH_TH: fmtMonth.th(monthOf), FIRST_MONTH_ZH: fmtMonth.zh(monthOf),
    PAYDAY_EN: fmtDate.en(pay), PAYDAY_TH: fmtDate.th(pay), PAYDAY_ZH: fmtDate.zh(pay),
    PRAISE_TH: l.praiseTh ?? "", PRAISE_EN: l.praiseEn ?? "", PRAISE_ZH: l.praiseZh ?? "",
    SIGNATORY: e.entity.signatoryName ?? rec.approvedBy.name,
  };
}

export async function renderSalaryLetter(actorCode: string, recordId: string) {
  const actor = await mdOnly(actorCode);
  const values = await salaryLetterFields(recordId);
  const { docx, unfilled } = fillDocx(await readFile(path.join(TEMPLATES, SALARY_LETTER_TEMPLATE)), values);
  await mkdir(path.join(OUT, "renders"), { recursive: true });
  const dir = await mkdtemp(path.join(OUT, "renders", `salary-${values.EMP_CODE}-`));
  const fileBase = `${values.LETTER_NO}_Salary_Adjustment_Notice`;
  const docxPath = path.join(dir, `${fileBase}.docx`);
  await writeFile(docxPath, docx);
  const pdfPath = await convertToPdf(docxPath, dir);
  await audit(actor.id, "SALARY_LETTER", values.EMP_CODE, { recordId, letterNo: values.LETTER_NO });
  return { docxPath, pdfPath, unfilled, fileBase, cleanup: () => rm(dir, { recursive: true, force: true }).catch(() => {}) };
}
