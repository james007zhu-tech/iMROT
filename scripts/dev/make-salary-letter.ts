/**
 * Render one 调薪通知单 from the command line (trial use before the page is deployed):
 *   npx tsx scripts/dev/make-salary-letter.ts <employee name> <old base> <new base> <effective YYYY-MM-DD> [position]
 * Creates the employee file and the two salary records in the database it runs against when they are missing.
 */
import { prisma } from "../../src/lib/db";
import { createEmployee, addSalaryRecord } from "../../src/server/opd";
import { renderSalaryLetter, saveLetterDetails } from "../../src/server/salary-letter";
import { copyFile } from "node:fs/promises";

async function main() {
  const [name, oldBase, newBase, eff, position] = process.argv.slice(2);
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD" } });
  let e = await prisma.employee.findFirst({ where: { name } });
  if (!e) { const c = await createEmployee({ actorCode: md.code, entityCode: "DCiT", name, role: "ENGINEER", position, email: `${name.toLowerCase()}.trial@dcit.local`, password: Math.random().toString(36).slice(2, 12) }); /* login set up later by the MD */ e = await prisma.employee.findUniqueOrThrow({ where: { code: c.code } }); }
  const effective = new Date(`${eff}T00:00:00Z`);
  const recs = await prisma.salaryRecord.findMany({ where: { employeeId: e.id }, orderBy: { effectiveFrom: "asc" } });
  if (!recs.length) await addSalaryRecord(md.code, e.code, { effectiveFrom: new Date(effective.getTime() - 86_400_000 * 31).toISOString().slice(0, 10), baseSalary: Number(oldBase), reason: "Salary before this adjustment" });
  let rec = await prisma.salaryRecord.findFirst({ where: { employeeId: e.id, effectiveFrom: effective } });
  if (!rec) rec = await addSalaryRecord(md.code, e.code, { effectiveFrom: eff, baseSalary: Number(newBase), reason: "Annual review — salary adjustment" });
  await saveLetterDetails(md.code, rec.id, {
    salutation: name, position,
    praiseZh: "你负责的控制柜、车间准备和客户现场工作，都踏踏实实地做出了能交付、能验收的结果。",
    praiseEn: "The control cabinets, the workshop preparation and the site work you take care of have all been delivered as real results that can be handed over and checked.",
    praiseTh: "งานตู้ควบคุม การเตรียมความพร้อมของโรงซ่อม และงานที่หน้างานลูกค้าที่คุณรับผิดชอบ ล้วนสำเร็จเป็นผลงานที่ส่งมอบและตรวจรับได้จริง",
  });
  const r = await renderSalaryLetter(md.code, rec.id);
  console.log("unfilled:", r.unfilled);
  await copyFile(r.pdfPath!, `/tmp/claude-0/${r.fileBase}.pdf`); await copyFile(r.docxPath, `/tmp/claude-0/${r.fileBase}.docx`);
  console.log(r.fileBase);
  await r.cleanup(); await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
