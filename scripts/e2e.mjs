/**
 * Browser end-to-end walk with Playwright against a running server (BASE_URL, default http://localhost:3000).
 * Logs in as the seeded MD, creates customer → assets → a full repair service with every step on its own form page
 * (INTH, quote, PO, ERTH, OBTH, RPTH, DNTH with a PO mismatch, acceptance, invoice, payment, archive), a contract
 * maintenance (PMTH), then the phone-sized portal. Screenshots go to ./e2e-shots. Exits non-zero on the first failure.
 *   node scripts/e2e.mjs
 */
import { chromium } from "playwright"; // run with NODE_PATH or npm i -D playwright
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "dongsheng.zhu@ducheng-industrial.com";
const PASSWORD = process.env.E2E_PASSWORD ?? process.env.SEED_ADMIN_PASSWORD ?? "dcit2026";
mkdirSync("e2e-shots", { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
let n = 0;
async function step(name, fn) {
  n++;
  try { await fn(); await page.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}.png`, fullPage: true }); console.log(`  ok  ${n}. ${name}`); }
  catch (e) { await page.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}-FAIL.png`, fullPage: true }).catch(() => {}); console.error(`FAIL ${n}. ${name}: ${e.message}`); await browser.close(); process.exit(1); }
}
/** Server-action redirects are client-side in Next, so give the fresh render up to 6 s to appear. */
const expectText = async (t, pg = page) => { for (let i = 0; i < 12; i++) { if ((await pg.locator("body").innerText()).includes(t)) return; await pg.waitForTimeout(500); } throw new Error(`expected text "${t}" on ${pg.url()}`); };
const flashError = async () => { await page.waitForTimeout(300); const t = await page.locator("[class*=border-alert][class*=px-4]").allInnerTexts(); return t.join(" ").trim(); };
const noFlashError = async () => { const e = await flashError(); if (e) throw new Error(`action error: ${e}`); };
const stamp = Date.now().toString(36).toUpperCase();
const taxId = `01${String(Date.now()).slice(-11)}`;
/** Pick the <option> whose label contains `text`. */
const selectByText = async (scope, selector, text) => { const value = await scope.locator(`${selector} option`).evaluateAll((os, t) => os.find((o) => o.textContent.includes(t))?.value, text); if (!value) throw new Error(`no option containing "${text}" in ${selector}`); await scope.locator(selector).selectOption(value); };
/** Submit an inline form and wait for the server action's redirect to land. */
const submit = async (form, pg = page) => { await form.locator("button").last().click(); await pg.waitForTimeout(800); await pg.waitForLoadState("networkidle"); };
/** Step pages: the save button sits in the header (form="f", no name). */
const save = async (pg = page) => { await pg.locator("button[form=f]:not([name])").click(); await pg.waitForTimeout(900); await pg.waitForLoadState("networkidle"); };
const shot = async (name) => { n++; await page.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}.png`, fullPage: true }); };

await step("login", async () => { await page.goto(`${BASE}/login`); await page.fill('[name=email]', EMAIL); await page.fill('[name=password]', PASSWORD); await page.click("form button[type=submit]"); await page.waitForURL(/\/(dashboard|assets)/); });
await step("dashboard", async () => { await page.goto(`${BASE}/dashboard`); await page.click("text=EN"); await page.waitForTimeout(800); await expectText("Dashboard"); });
await step("language-switch", async () => { await page.click("text=中文"); await page.waitForTimeout(800); await expectText("看板"); await page.click("text=ไทย"); await page.waitForTimeout(800); await expectText("แดชบอร์ด"); await page.click("text=EN"); await page.waitForTimeout(800); await expectText("Assets"); });
await step("admin", async () => { await page.goto(`${BASE}/admin`); await expectText("DCiT"); await expectText("THB"); });
await step("models-add", async () => {
  await page.goto(`${BASE}/models`);
  const f = page.locator("form").filter({ has: page.locator('input[name=code][placeholder=SIE]') }); await f.locator('[name=code]').fill("ABB"); await f.locator('[name=name]').fill("ABB"); await submit(f); await noFlashError();
  const s = page.locator("form").filter({ has: page.locator('[name=brandCode]') }); await s.locator('[name=brandCode]').selectOption("ABB"); await s.locator('[name=code]').fill("ACS880"); await s.locator('[name=name]').fill("ACS880"); await submit(s); await noFlashError();
  const m = page.locator("form").filter({ has: page.locator('[name=seriesId]') }); await m.locator('[name=seriesId]').selectOption({ label: "ABB ACS880" }); await m.locator('[name=code]').fill(`ACS880-01-145A-3-${stamp}`); await m.locator('[name=kw]').fill("75"); await submit(m); await noFlashError();
  await expectText(`ACS880-01-145A-3-${stamp}`);
});
await step("model-detail-knowledge", async () => {
  await page.click(`text=ACS880-01-145A-3-${stamp}`); await page.waitForURL(/\/models\//);
  const f = page.locator("form").filter({ has: page.locator('[name=firstChecks]') }); await f.locator('[name=code]').fill("F0001"); await f.locator('[name=title]').fill("Overcurrent"); await f.locator('[name=firstChecks]').fill("check motor cable insulation"); await submit(f); await noFlashError(); await expectText("F0001");
  const b = page.locator("form").filter({ has: page.locator('[name=sku]') }); await b.locator('[name=sku]').fill(`ABB-FAN-${stamp}`); await b.locator('[name=vendorPartNo]').fill("3AUA0000074016"); await b.locator('[name=name]').fill("Cooling fan"); await submit(b); await noFlashError(); await expectText(`ABB-FAN-${stamp}`);
});

let customerCode;
await step("customer-list-has-new-button", async () => { await page.goto(`${BASE}/customers`); await page.click("a:has-text('New customer')"); await page.waitForURL(/\/customers\/new/); await expectText("DBD"); });
await step("customer-create", async () => {
  await page.fill("[name=taxId]", taxId); await page.locator("[name=taxId]").blur();
  await page.fill("[name=nameLocal]", `บริษัท ทดสอบ ${stamp} จำกัด`); await page.fill("[name=name]", `E2E Tyre ${stamp}`);
  await page.locator("[name=monthlyStatement]").check();
  await page.fill("[name=p0_name]", "Plant 1");
  await page.fill("[name=c0_name]", "Khun Somchai"); await page.fill("[name=c0_phone]", "081-234-5612"); await page.fill("[name=c0_login]", `somchai-${stamp.toLowerCase()}`); await page.fill("[name=c0_pw]", "portal123");
  await save(); await page.waitForURL(/\/customers\/CTH/); customerCode = page.url().split("/").pop().split("?")[0]; await expectText(customerCode);
});
await step("contacts-masked-then-revealed", async () => {
  await expectText("Khun S****"); await expectText("08*-***-**12");
  const f = page.locator("form").filter({ has: page.locator("[name=password]") }); await f.locator("[name=password]").fill(PASSWORD); await submit(f); await expectText("Khun Somchai");
});

let assetCode, motorCode;
await step("asset-motor", async () => {
  await page.goto(`${BASE}/assets`); await page.click("a:has-text('New asset')"); await page.waitForURL(/\/assets\/new/);
  await page.selectOption("[name=type]", "MOTOR"); await page.fill("[name=modelCode]", "6SL3120-2TE41-0AA1"); await page.fill("[name=serialNumber]", `MOT-E2E-${stamp}`);
  await selectByText(page, "[name=customerId]", `E2E Tyre ${stamp}`); await page.fill("[name=location]", "Mixer line 2 motor"); await page.selectOption("[name=responsibleEmployeeId]", { index: 1 });
  await save(); await page.waitForURL(/\/assets\/ATH/); motorCode = page.url().split("/").pop().split("?")[0];
});
await step("asset-vfd-with-relation", async () => {
  await page.goto(`${BASE}/assets/new`);
  await page.selectOption("[name=type]", "VFD"); await page.fill("[name=modelCode]", `ACS880-01-145A-3-${stamp}`); await page.fill("[name=serialNumber]", `SN-E2E-${stamp}`);
  await selectByText(page, "[name=customerId]", `E2E Tyre ${stamp}`); await page.fill("[name=location]", "Mixer line 2"); await page.selectOption("[name=responsibleEmployeeId]", { index: 1 });
  await page.fill("[name=ratedPowerKw]", "75"); await selectByText(page, "[name=rel_DRIVES]", motorCode);
  await save(); await page.waitForURL(/\/assets\/ATH/); assetCode = page.url().split("/").pop().split("?")[0]; await expectText(motorCode);
});
await step("asset-duplicate-serial-warns", async () => {
  await page.goto(`${BASE}/assets/new`);
  await page.fill("[name=modelCode]", "6SL3120-2TE41-0AA1"); await page.fill("[name=serialNumber]", `SN-E2E-${stamp}`); await selectByText(page, "[name=customerId]", `E2E Tyre ${stamp}`); await page.fill("[name=location]", "x"); await page.selectOption("[name=responsibleEmployeeId]", { index: 1 });
  await save(); await expectText(`already exists as ${assetCode}`);
});

let orderNo;
await step("report-issue-and-assign", async () => {
  await page.goto(`${BASE}/service-orders/new?asset=${assetCode}`);
  await page.fill("[name=reportedSymptom]", "F0001 overcurrent on start"); await page.fill("[name=reportedAlarm]", "F0001"); await page.fill("[name=customerRef]", "PO-E2E-001");
  await page.selectOption("[name=assigneeCode]", { index: 1 });
  await page.locator("button[name=assign]").click(); await page.waitForURL(/\/service-orders\/QTTH/); orderNo = page.url().split("/").pop().split("?")[0];
  await expectText("PO-E2E-001"); await expectText("Inspection INTH");
});
const go = async (s) => { await page.goto(`${BASE}/service-orders/${orderNo}/${s}`); await expectText(orderNo); };
await step("inspect", async () => {
  await go("inspect");
  await page.fill("[name=conditions]", "38°C dusty, isolated and locked out"); await page.fill("[name=findings]", "DC bus capacitors degraded; fan seized"); await page.fill("[name=probableCause]", "cooling failure"); await page.fill("[name=recommendation]", "replace fan, load test");
  await page.fill("[name=c_supply]", "380V ±10%"); await page.fill("[name=r_supply]", "372V");
  await save(); await page.waitForURL(new RegExp(`/service-orders/${orderNo}\\?`)); await noFlashError(); await expectText("INTH");
});
await step("quote", async () => {
  await go("quote");
  await page.fill("[name=d0]", "Cooling fan"); await page.fill("[name=l0]", "พัดลม"); await page.fill("[name=q0]", "1"); await page.fill("[name=p0]", "6500"); await page.fill("[name=s0]", `ABB-FAN-${stamp}`);
  await page.fill("[name=d1]", "Labour"); await page.fill("[name=l1]", "ค่าแรง"); await page.fill("[name=q1]", "4"); await page.fill("[name=u1]", "h"); await page.fill("[name=p1]", "1500");
  await save(); await noFlashError(); await expectText("13375.00");
});
await step("customer-po", async () => { await go("confirm"); if ((await page.locator('input[value="Labour"]').count()) !== 1) throw new Error("PO lines not prefilled from quote"); await save(); await noFlashError(); await expectText("Repair RPTH"); });
await step("erth-receive", async () => { await go("receive"); await page.fill("[name=sender]", "customer truck"); await page.fill("[name=accessories]", "keypad × 1\ncable × 2"); await page.fill("[name=condition]", "dusty"); await save(); await noFlashError(); await expectText("ERTH"); });
await step("stock-out", async () => {
  await page.goto(`${BASE}/service-orders/${orderNo}`); await page.click("a:has-text('Issue parts OBTH')"); await page.waitForURL(/\/parts\/movement/);
  await selectByText(page, "[name=assetCode]", `${assetCode} · ${orderNo}`); await page.fill("[name=s0]", `ABB-FAN-${stamp}`); await page.fill("[name=q0]", "1"); await page.selectOption("[name=o0]", "RETURN_TO_CUSTOMER");
  await save(); await page.waitForURL(new RegExp(`/service-orders/${orderNo}`)); await noFlashError(); await expectText("OBTH");
});
await step("repair-finish", async () => {
  await go("repair");
  await page.fill("[name=workPerformed]", "replaced fan, cleaned heatsink"); await page.fill("[name=laborHours]", "4"); await page.selectOption("[name=pdisp0]", "RETURN_TO_CUSTOMER"); await page.fill("[name=pold0]", "F-OLD-1");
  await page.fill("[name=c_noLoad]", "0-50 Hz"); await page.fill("[name=r_noLoad]", "ok"); await page.selectOption("[name=p_noLoad]", "yes");
  await save(); await noFlashError(); await expectText("RPTH"); await expectText("Delivery note DNTH");
});
let dnNo;
await step("delivery-linked-docs-and-live-check", async () => {
  await go("deliver"); await expectText("Must go back"); await expectText("Linked documents"); await expectText("PO-E2E-001"); await expectText("INTH2611"); await expectText("ERTH2611");
  const cable = page.locator("tr", { hasText: "cable" }); await cable.locator("input[type=number]").fill("1"); await cable.getByText("Short 1").waitFor();
  await cable.locator("input[type=number]").fill("2"); await cable.getByText("✓ Matches").waitFor();
});
await step("delivery-draft-keeps-number", async () => {
  const cable = page.locator("tr", { hasText: "cable" }).locator("input[type=number]"); await cable.fill("1");
  await page.locator("button[name=draft][value='1']").click(); await page.waitForLoadState("networkidle"); await noFlashError();
  await expectText("Draft"); if ((await page.locator("tr", { hasText: "cable" }).locator("input[type=number]").inputValue()) !== "1") throw new Error("draft quantity not restored");
});
await step("delivery-mismatch-blocked", async () => {
  await page.selectOption("[name=contactId]", { index: 1 });
  const cable = page.locator("tr", { hasText: "cable" }).locator("input[type=number]"); await cable.fill("1");
  await save(); await expectText("Cannot issue");
});
await step("draft-after-error-stays-draft", async () => {
  // FormMemory used to restore the draft button's value from the hidden field, so "save draft" after an error issued the note.
  await page.locator("button[name=draft][value='1']").click(); await page.waitForLoadState("networkidle");
  if (/\/deliver\/DNTH/.test(page.url())) throw new Error("save draft after an error issued the delivery note");
  await expectText("Draft");
});
await step("delivery-issued-and-signed", async () => {
  await page.selectOption("[name=contactId]", { index: 1 });
  const cable = page.locator("tr", { hasText: "cable" }).locator("input[type=number]"); await cable.fill("2");
  await save(); await page.waitForURL(/\/deliver\/DNTH/); dnNo = page.url().split("/").pop().split("?")[0];
  await page.fill("[name=signedBy]", "Khun Somchai"); await save(); await page.waitForURL(new RegExp(`/service-orders/${orderNo}\\?`)); await noFlashError(); await expectText("Signed by Khun S****");
});
await step("acceptance", async () => { await go("accept"); await page.selectOption("[name=contactId]", { index: 1 }); await save(); await noFlashError(); await expectText("Service completion"); });
await step("invoice", async () => { await go("invoice"); await save(); await noFlashError(); await expectText("TITH2611"); await expectText("IVTH2611"); });
await step("payment", async () => { await go("payment"); await page.fill("[name=paidAmount]", "13000"); await page.fill("[name=whtAmount]", "375"); await save(); await noFlashError(); });
await step("archive-case", async () => { await go("archive"); await page.fill("[name=lesson]", "check fan before capacitors"); await page.locator("[name=toFaultCode]").check(); await save(); await noFlashError(); });
await step("report-pdfs", async () => {
  for (const url of [`/api/documents/${orderNo}/render?template=04&format=pdf`, `/api/documents/${dnNo}/render?format=pdf`, `/api/documents/${orderNo}/render?template=13&format=pdf`]) {
    const r = await ctx.request.get(`${BASE}${url}`); if (r.status() !== 200) throw new Error(`${url} → ${r.status()}`);
  }
  const docs = await page.locator("a[href*='/api/documents/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const insp = docs.find((h) => h.includes("INTH")); const r = await ctx.request.get(`${BASE}${insp}`); if (r.status() !== 200) throw new Error(`inspection pdf ${r.status()}`);
});
await step("order-detail-final", async () => { await page.goto(`${BASE}/service-orders/${orderNo}`); await expectText("Delivery note"); await expectText("Diagnostic report"); });

let pmNo;
await step("contract-maintenance-pmth", async () => {
  await page.goto(`${BASE}/service-orders/new?asset=${assetCode}`);
  await page.selectOption("[name=kind]", "CONTRACT"); await page.fill("[name=reportedSymptom]", "quarterly preventive maintenance"); await page.selectOption("[name=productionImpact]", "NONE"); await page.selectOption("[name=assigneeCode]", { index: 1 });
  await page.locator("button[name=assign]").click(); await page.waitForURL(/\/service-orders\/QTTH/); pmNo = page.url().split("/").pop().split("?")[0];
  await expectText("Maintenance PMTH");
  await page.goto(`${BASE}/service-orders/${pmNo}/maintain`);
  await page.fill("[name=i0]", "Fan 2 noise"); await page.fill("[name=m0]", "bearing noise"); await page.selectOption("[name=v0]", "HAZARD");
  await page.fill("[name=hazards]", "fan 2 bearing noise"); await page.fill("[name=handled]", "cleaned heatsink"); await page.fill("[name=recommendation]", "replace fan 2");
  await page.locator("[name=hazardToRepair]").check();
  await save(); await noFlashError(); await expectText("PMTH");
});

await step("asset-timeline", async () => { await page.goto(`${BASE}/assets/${assetCode}`); await expectText("INTH"); await expectText("RPTH"); await expectText(dnNo); await expectText("Maintenance record"); });
await step("label", async () => { await page.goto(`${BASE}/assets/${assetCode}/label?n=4`); await expectText(assetCode); });
await step("parts-and-stock", async () => {
  await page.goto(`${BASE}/parts/movement?direction=IN`);
  await page.fill("[name=s0]", `ABB-FAN-${stamp}`); await page.fill("[name=q0]", "5"); await page.fill("[name=c0]", "4200"); await page.fill("[name=s1]", `NOPE-${stamp}`); await page.fill("[name=q1]", "1");
  await save(); await expectText(`NOPE-${stamp}`);
  await page.fill("[name=s1]", "SIE-6SL3352-1AE32-1AA1"); await page.fill("[name=q1]", "2"); await save(); await page.waitForURL(/\/parts\?/);
  const ok = decodeURIComponent(page.url()); if (!/IBTH\d{9} · 2/.test(ok)) throw new Error(`expected one IBTH with 2 lines, got ${ok}`);
});
await step("search", async () => { await page.goto(`${BASE}/search?q=${assetCode}`); await expectText(assetCode); });
await step("dashboard-build", async () => { await page.goto(`${BASE}/dashboard`); await page.fill("input[placeholder*=\"Describe\"]", "本月维修看板：工单、收入、工程师"); await page.click("form button:has-text('AI')"); await page.waitForURL(/\/dashboard\/[a-z0-9]+/, { timeout: 15000 }); });
await step("employee-create-md-only", async () => {
  await page.goto(`${BASE}/people`); await page.click("a:has-text('New employee')"); await page.waitForURL(/\/people\/new/);
  await page.fill("[name=name]", `Engineer ${stamp}`); await page.fill("[name=email]", `eng-${stamp.toLowerCase()}@ducheng-industrial.com`); await page.fill("[name=password]", "engineer1");
  await save(); await page.waitForURL(/\/people\?/); await expectText(`Engineer ${stamp}`);
});
await step("non-md-cannot-see-opd", async () => {
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await c2.newPage();
  await p2.goto(`${BASE}/login`); await p2.fill("[name=email]", `eng-${stamp.toLowerCase()}@ducheng-industrial.com`); await p2.fill("[name=password]", "engineer1"); await p2.click("form button[type=submit]"); await p2.waitForURL(/\/(dashboard|assets)/);
  const nav = await p2.locator("aside").innerText(); if (/Organisation|组织|บุคลากร|OPD/i.test(nav) && (await p2.locator("aside a[href='/people']").count()) > 0) throw new Error("OPD menu visible to an engineer");
  await p2.goto(`${BASE}/people`); const b = await p2.locator("body").innerText(); if (b.includes("ETH2611001")) throw new Error("engineer can read the employee list"); await c2.close();
});
await step("finance-and-blth", async () => { await page.goto(`${BASE}/finance`); await expectText("IVTH"); await page.goto(`${BASE}/customers/${customerCode}`); await page.click("button:has-text('BLTH')"); await page.waitForTimeout(800); await page.waitForLoadState("networkidle"); const b = await page.locator("body").innerText(); if (!/BLTH2611|nothing to bill/.test(b)) throw new Error("BLTH neither issued nor correctly refused"); });
await step("sign-out", async () => { await page.click("text=Sign out"); await page.waitForURL(/\/login/); });

// ── portal, phone-sized ──
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const p = await mobile.newPage();
p.on("pageerror", (e) => errors.push(`portal pageerror: ${e.message}`));
async function pstep(name, fn) { n++; try { await fn(); await p.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}.png`, fullPage: true }); console.log(`  ok  ${n}. ${name}`); } catch (e) { await p.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}-FAIL.png`, fullPage: true }).catch(() => {}); console.error(`FAIL ${n}. ${name}: ${e.message}`); await browser.close(); process.exit(1); } }
const ptext = (t) => expectText(t, p);
await pstep("portal-login", async () => { await p.goto(`${BASE}/portal/login`); await p.fill('[name=login]', `somchai-${stamp.toLowerCase()}`); await p.fill('[name=password]', "portal123"); await p.locator("form").filter({ has: p.locator('[name=login]') }).locator("button").click(); await p.waitForURL(/\/portal$/); await ptext(assetCode); });
await pstep("portal-report", async () => { await p.goto(`${BASE}/portal/report?asset=${assetCode}`); await p.fill("[name=reportedSymptom]", "vibration and noise"); await p.locator("form#f button").last().click(); await p.waitForURL(/\/portal\/orders\/QTTH/); await ptext("vibration"); });
await pstep("portal-isolation", async () => { const r = await mobile.request.get(`${BASE}/api/assets`); if (r.status() !== 401) throw new Error(`portal contact could read staff API: ${r.status()}`); });
await pstep("portal-order-reports", async () => {
  await p.goto(`${BASE}/portal/orders/${orderNo}`); await ptext("INTH"); await ptext(dnNo);
  const z = await mobile.request.get(`${BASE}/api/portal/orders/${orderNo}/zip`); if (z.status() !== 200 || !z.headers()["content-type"].includes("zip")) throw new Error(`zip ${z.status()}`);
});

if (errors.length) { console.error("browser errors:\n" + errors.join("\n")); }
await browser.close();
console.log(`\nE2E PASSED — ${n} steps, customer ${customerCode}, asset ${assetCode}, order ${orderNo}, delivery ${dnNo}, PM ${pmNo}${errors.length ? ` (with ${errors.length} browser console errors)` : ""}`);
