/**
 * AI 建供应商 (朱总 2026-11-27): the assistant had no way to create a supplier. create_supplier / update_supplier
 * against a real database: fields, kept papers, duplicates, rights.
 *   npx tsx scripts/dev/probe-ai-supplier.ts
 */
import { prisma } from "../../src/lib/db";
import { runAction, ACTION_TOOLS } from "../../src/server/ai-actions";

const assert = (c: unknown, m: string) => { if (!c) throw new Error(`AI-SUPPLIER FAIL: ${m}`); console.log("  ok  " + m); };
const refused = async (f: () => Promise<unknown>, re: RegExp, m: string) => { try { await f(); } catch (e) { assert(re.test((e as Error).message), `${m} (${(e as Error).message.slice(0, 70)})`); return; } throw new Error(`AI-SUPPLIER FAIL: ${m} — was not refused`); };

async function main() {
  const md = await prisma.employee.findFirstOrThrow({ where: { role: "MD", active: true } });
  const eng = await prisma.employee.findFirstOrThrow({ where: { role: "ENGINEER", active: true, NOT: { extraRoles: { has: "PURCHASING" } } } });
  const tag = Date.now().toString().slice(-6), ctx = { employeeCode: md.code };
  assert(ACTION_TOOLS.some((t) => t.name === "create_supplier") && ACTION_TOOLS.some((t) => t.name === "update_supplier"), "the assistant is offered create_supplier and update_supplier");
  const papers = [{ name: "DBD.pdf", url: `/api/uploads/chat-${tag}-dbd.pdf` }, { name: "PP20.pdf", url: `/api/uploads/chat-${tag}-pp20.pdf` }];
  const r = await runAction("create_supplier", { name: `AI Probe Supply ${tag} Co., Ltd.`, nameLocal: `บริษัท เอไอ โพรบ ${tag} จำกัด`, taxId: `0 1055 ${Date.now().toString().slice(-8)}`, branchCode: "00000", address: "99 Moo 1, Rayong 21000", contactName: "Khun Probe", phone: "+66 80 000 0000", email: `probe${tag}@example.com`, paymentTerms: "30 days", files: papers }, ctx) as { href?: string; data?: { code?: string } };
  const s = await prisma.supplier.findUniqueOrThrow({ where: { code: r.data!.code! } });
  assert(/^STH/.test(s.code!) && r.href === `/suppliers/${s.code}`, `supplier ${s.code} created, link to its file`);
  assert(/^\d{13}$/.test(s.taxId!) && s.contactName === "Khun Probe" && s.phone === "+66 80 000 0000" && s.email === `probe${tag}@example.com` && s.nameLocal?.includes(tag), "tax ID (spaces removed), Thai name, contact, phone and e-mail stored");
  assert((s.files as unknown[]).length === 2, "both papers kept on the supplier file");
  await refused(() => runAction("create_supplier", { name: `ai probe supply ${tag} co., ltd.` }, ctx), /already exists/, "the same name again is refused and points to update_supplier");
  await refused(() => runAction("create_supplier", { name: `Other ${tag}`, files: [{ name: "x", url: "https://elsewhere.example/x.pdf" }] }, ctx), /attached in this conversation/, "a file from elsewhere is refused");
  await refused(() => runAction("create_supplier", { name: `Eng ${tag} Co.` }, { employeeCode: eng.code }), /NO_PERMISSION|FORBIDDEN/, "an engineer cannot create a supplier");
  await runAction("update_supplier", { supplier: s.code, phone: "+66 81 111 1111", files: [papers[0], { name: "bank.jpg", url: `/api/uploads/chat-${tag}-bank.jpg` }] }, ctx);
  const u = await prisma.supplier.findUniqueOrThrow({ where: { id: s.id } });
  assert(u.phone === "+66 81 111 1111" && u.email === s.email && (u.files as unknown[]).length === 3, "update: phone changed, e-mail untouched, one new paper added (no duplicate)");
  await refused(() => runAction("update_supplier", { supplier: s.code, phone: "1" }, { employeeCode: eng.code }), /FORBIDDEN/, "an engineer cannot change a supplier");
  console.log(`\nAI-SUPPLIER PASSED — ${s.code}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
