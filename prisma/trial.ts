/**
 * Trial accounts for the end-to-end test run (decision 2026-11-05).
 *   1. Staff account  — MANAGER, runs every staff flow (ALM/CRM/SLM/SCM/reports/AI); not MD, so OPD and legal entities stay closed to it.
 *   2. Portal account — a contact of the trial customer "[TRIAL] Test Rubber", runs the customer portal (report, quote, acceptance, downloads).
 * Business closure (TITH/IVTH/payment/BLTH) stays off until BUSINESS_CLOSURE=on — see src/lib/closure.ts.
 *
 * Run after `npm run db:seed`:  npm run trial:seed
 * Re-running is safe: the same accounts are kept and get a fresh password (or TRIAL_PASSWORD if set).
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/db";
import { createEmployee, updateEmployee } from "../src/server/opd";
import { createCustomer, addContact, setPortalPassword } from "../src/server/crm";
import { businessClosureOn } from "../src/lib/closure";

const STAFF_EMAIL = "trial.staff@dcit.test";
const PORTAL_LOGIN = "trial.portal";
const TRIAL_TAX_ID = "0999999999999"; // not a real company — marks the trial customer
const ENTITY = "DCiT";

const password = () => process.env.TRIAL_PASSWORD ?? `Tr-${randomBytes(6).toString("base64url")}`;

async function main() {
  const md = await prisma.employee.findFirst({ where: { role: "MD", active: true }, orderBy: { createdAt: "asc" } });
  if (!md) throw new Error("no MD employee — run npm run db:seed first");

  // 1. staff
  const staffPw = password();
  const existing = await prisma.employee.findUnique({ where: { email: STAFF_EMAIL } });
  const staff = existing
    ? await updateEmployee({ actorCode: md.code, code: existing.code, role: "MANAGER", active: true, password: staffPw })
    : await createEmployee({ actorCode: md.code, entityCode: ENTITY, name: "[TRIAL] Grok Tester", nameLocal: "[试用] Grok 测试员", role: "MANAGER", email: STAFF_EMAIL, locale: "zh", password: staffPw });

  // 2. trial customer + portal contact
  const portalPw = password();
  let customer = await prisma.customer.findFirst({ where: { taxId: TRIAL_TAX_ID, branchCode: "00000" } });
  if (!customer) {
    customer = await createCustomer({
      actorCode: staff.code, entityCode: ENTITY, taxId: TRIAL_TAX_ID, branchCode: "00000",
      nameLocal: "[ทดลอง] บริษัท เทสต์ รับเบอร์ (ไทยแลนด์) จำกัด", name: "[TRIAL] Test Rubber (Thailand) Co., Ltd.", shortName: "TRIAL",
      addressEn: "Trial address, Rayong (not real)", paymentTermDays: 30, monthlyStatement: true, source: "trial",
      plants: [{ code: "P1", name: "Trial Plant 1", address: "Rayong (trial)" }],
      contacts: [{ name: "Trial Portal User", title: "Maintenance", plantCode: "P1", portalLogin: PORTAL_LOGIN, portalPassword: portalPw }],
    });
  } else if (await prisma.contact.findUnique({ where: { portalLogin: PORTAL_LOGIN } })) {
    await setPortalPassword(md.code, PORTAL_LOGIN, portalPw);
  } else {
    await addContact(customer.code, { name: "Trial Portal User", title: "Maintenance", plantCode: "P1", portalLogin: PORTAL_LOGIN, portalPassword: portalPw });
  }

  const base = process.env.TRIAL_BASE_URL ?? "http://localhost:3000";
  console.log(`
DCiT OS trial accounts
──────────────────────────────────────────────
1 Staff (${staff.code}, MANAGER)   ${base}/login
  email     ${STAFF_EMAIL}
  password  ${staffPw}
2 Portal (${customer.code}, ${PORTAL_LOGIN})   ${base}/portal/login
  login     ${PORTAL_LOGIN}
  password  ${portalPw}
Business closure (TITH/IVTH/payment/BLTH): ${businessClosureOn() ? "ON  ⚠ set BUSINESS_CLOSURE=off for the trial" : "OFF"}
Test plan: docs/GROK-TRIAL.md
`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
