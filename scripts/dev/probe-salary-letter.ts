/**
 * 调薪通知单 against a real database: two salary records → letter details → fields → rendered docx with nothing left
 * unfilled; MD only; a first salary or a decrease gives no letter.   npx tsx scripts/dev/probe-salary-letter.ts
 */
import { readFile } from "node:fs/promises";
import { prisma } from "../../src/lib/db";
import { addSalaryRecord, createEmployee } from "../../src/server/opd";
import { renderSalaryLetter, salaryLetterFields, saveLetterDetails } from "../../src/server/salary-letter";
import { readZip } from "../../src/lib/docx/zip";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`SALARY LETTER FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (fn: () => Promise<unknown>, re: RegExp, m: string) => { try { await fn(); assert(false, m); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.split("\n")[0]})`); } };

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD" } });
  const stamp = Date.now().toString().slice(-6);
  const e = await createEmployee({ actorCode: md.code, entityCode: "DCiT", name: `Somchai Probe${stamp}`, nameLocal: "สมชาย ทดสอบ", role: "ENGINEER", position: "Technician", email: `sl${stamp}@dcit.test`, password: "probe123" });
  const first = await addSalaryRecord(md.code, e.code, { effectiveFrom: "2026-06-01", baseSalary: 15000, reason: "hire" });
  await refused(() => salaryLetterFields(first.id), /NO_PREVIOUS_SALARY/, "a first salary has no notice");
  const raise = await addSalaryRecord(md.code, e.code, { effectiveFrom: "2026-11-01", baseSalary: 17000, reason: "review" });
  await refused(() => saveLetterDetails(e.code, raise.id, { salutation: "x" }), /MD_ONLY/, "only the MD edits the letter");
  await saveLetterDetails(md.code, raise.id, { salutation: "Chai", praiseZh: "现场工作做得扎实。", praiseEn: "Solid site work.", praiseTh: "งานหน้างานแน่นมาก" });
  const f = await salaryLetterFields(raise.id);
  assert(f.OLD_BASE === "15,000.00" && f.NEW_BASE === "17,000.00" && f.INCREASE === "2,000.00" && f.INCREASE_PCT === "+13.3%", "15,000 → 17,000, +2,000, +13.3%");
  assert(f.EFFECTIVE_TH === "1 พฤศจิกายน 2569" && f.PAYDAY_EN === "4 December 2026" && f.PAYDAY_ZH === "2026年12月4日", "Thai BE date; first paid 4 Dec (5 Dec is a holiday)");
  assert(f.SALUTATION === "Chai" && f.TO_NAME.includes("สมชาย ทดสอบ") && f.POSITION === "Technician" && f.LETTER_NO === `${e.code}-SAL-202611`, `greeting, names, position, ref ${f.LETTER_NO}`);
  await refused(() => renderSalaryLetter(e.code, raise.id), /MD_ONLY/, "only the MD renders it");
  const r = await renderSalaryLetter(md.code, raise.id);
  const xml = readZip(await readFile(r.docxPath)).find((x) => x.name === "word/document.xml")!.data.toString("utf8");
  assert(!r.unfilled.length && xml.includes("STRICTLY CONFIDENTIAL") && xml.includes("17,000.00") && xml.includes("งานหน้างานแน่นมาก") && !!r.pdfPath, "rendered: nothing unfilled, confidential mark, amounts, personal thanks, PDF made");
  await r.cleanup();
  assert(await prisma.auditLog.count({ where: { target: e.code, action: { in: ["SALARY_LETTER", "SALARY_LETTER_EDIT"] } } }) === 2, "edit and render audited");
  const cut = await addSalaryRecord(md.code, e.code, { effectiveFrom: "2026-12-01", baseSalary: 16000, reason: "role change" });
  await refused(() => salaryLetterFields(cut.id), /NOT_AN_INCREASE/, "a decrease gets no thank-you letter");
  console.log(`\nSALARY LETTER PASSED — ${e.code}`);
}
main().catch((x) => { console.error(x); process.exit(1); }).finally(() => prisma.$disconnect());
