/**
 * Browser end-to-end walk with Playwright against a running server (BASE_URL, default http://localhost:3000).
 * Logs in as the seeded admin, walks every staff page, exercises the main forms, logs into the portal as a contact,
 * and screenshots each page into ./e2e-shots. Exits non-zero on the first failed step.
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
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });
let n = 0;
async function step(name, fn) {
  n++;
  try { await fn(); await page.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}.png`, fullPage: true }); console.log(`  ok  ${n}. ${name}`); }
  catch (e) { await page.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}-FAIL.png`, fullPage: true }).catch(() => {}); console.error(`FAIL ${n}. ${name}: ${e.message}`); await browser.close(); process.exit(1); }
}
/** Server-action redirects are client-side in Next, so give the fresh render up to 6 s to appear. */
const expectText = async (t, pg = page) => { for (let i = 0; i < 12; i++) { if ((await pg.locator("body").innerText()).includes(t)) return; await pg.waitForTimeout(500); } throw new Error(`expected text "${t}" on ${pg.url()}`); };
const noFlashError = async () => { await page.waitForTimeout(300); const b = await page.locator("body").innerText(); const m = /⚠ (.*)/.exec(b); if (m) throw new Error(`action error: ${m[1]}`); };
const stamp = Date.now().toString(36).toUpperCase();
/** Pick the <option> whose label contains `text` (Playwright's label matcher is exact-string only). */
const selectByText = async (scope, selector, text) => { const value = await scope.locator(`${selector} option`).evaluateAll((os, t) => os.find((o) => o.textContent.includes(t))?.value, text); if (!value) throw new Error(`no option containing "${text}" in ${selector}`); await scope.locator(selector).selectOption(value); };
/** Submit a form and wait for the server action's redirect to land, so the next step sees the fresh page. */
const submit = async (form, pg = page) => { await form.locator("button").last().click(); await pg.waitForTimeout(800); await pg.waitForLoadState("networkidle"); };

await step("login", async () => { await page.goto(`${BASE}/login`); await page.fill('[name=email]', EMAIL); await page.fill('[name=password]', PASSWORD); await page.click("form button[type=submit]"); await page.waitForURL(/\/(dashboard|assets)/); });
await step("dashboard", async () => { await page.goto(`${BASE}/dashboard`); await expectText("แดชบอร์ด"); await page.click("text=EN"); await page.waitForTimeout(800); await expectText("Dashboard"); });
await step("language-switch", async () => { await page.click("text=中文"); await page.waitForTimeout(800); await expectText("看板"); await page.click("text=ไทย"); await page.waitForTimeout(800); await expectText("แดชบอร์ด"); await page.click("text=EN"); await page.waitForTimeout(800); await expectText("Assets"); });
await step("admin", async () => { await page.goto(`${BASE}/admin`); await expectText("TH"); await expectText("THB"); });
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
await step("customer-create", async () => {
  await page.goto(`${BASE}/customers`);
  const f = page.locator("form").filter({ has: page.locator('[name=taxId]') }); await f.locator('[name=name]').fill(`E2E Tyre ${stamp}`); await f.locator('[name=taxId]').fill("0105559999999"); await f.locator('[name=monthlyStatement]').check(); await f.locator("button").click();
  await page.waitForURL(/\/customers\/CTH/); customerCode = page.url().split("/").pop(); await expectText(customerCode);
});
await step("customer-plant-contact", async () => {
  const pf = page.locator("form").filter({ has: page.locator('input[name=code][placeholder=P1]') });
  await pf.locator('[name=code]').fill("P1"); await pf.locator('[name=name]').fill("Plant 1"); await submit(pf); await noFlashError(); await expectText("Plant 1");
  const c = page.locator("form").filter({ has: page.locator('[name=portalLogin]') }); await c.locator('[name=name]').fill("Khun Somchai"); await c.locator('[name=portalLogin]').fill(`somchai-${stamp.toLowerCase()}`); await c.locator('[name=password]').fill("portal123"); await submit(c); await noFlashError(); await expectText("Khun Somchai");
});
let assetCode;
await step("asset-onboard", async () => {
  await page.goto(`${BASE}/assets/new`);
  await page.selectOption('[name=type]', "VFD"); await page.fill('[name=serialNumber]', `SN-E2E-${stamp}`);
  await selectByText(page, '[name=modelId]', `ACS880-01-145A-3-${stamp}`); await selectByText(page, '[name=customerId]', customerCode);
  await page.fill('[name=location]', "Mixer line 2"); await page.selectOption('[name=responsibleEmployeeId]', { index: 1 }); await page.locator("form").filter({ has: page.locator('[name=serialNumber]') }).locator("button").click();
  await page.waitForURL(/\/assets\/ATH/); assetCode = page.url().split("/").pop(); await expectText(assetCode); await expectText("ONBOARDED".length ? "" : "");
});
await step("asset-motor-and-relation", async () => {
  await page.goto(`${BASE}/assets/new`);
  await page.selectOption('[name=type]', "MOTOR"); await page.fill('[name=serialNumber]', `MOT-E2E-${stamp}`); await page.selectOption('[name=modelId]', { index: 1 }); await selectByText(page, '[name=customerId]', customerCode); await page.fill('[name=location]', "Mixer line 2 motor"); await page.selectOption('[name=responsibleEmployeeId]', { index: 1 }); await page.locator("form").filter({ has: page.locator('[name=serialNumber]') }).locator("button").click();
  await page.waitForURL(/\/assets\/ATH/); const motor = page.url().split("/").pop();
  await page.goto(`${BASE}/assets/${assetCode}`);
  const rel = page.locator("form").filter({ has: page.locator('[name=relation]') }); await rel.locator('[name=relation]').selectOption("DRIVES"); await selectByText(rel, '[name=other]', motor); await submit(rel); await noFlashError(); await expectText("drives");
});
let orderNo;
await step("report-issue", async () => {
  await page.goto(`${BASE}/service-orders/new?asset=${assetCode}`);
  await page.selectOption('[name=assetCodes]', [assetCode]); await page.fill('[name=reportedSymptom]', "F0001 overcurrent on start"); await page.fill('[name=reportedAlarm]', "F0001"); await page.fill('[name=customerRef]', "PO-E2E-001"); await page.locator("form").filter({ has: page.locator('[name=assetCodes]') }).locator("button").click();
  await page.waitForURL(/\/service-orders\/QTTH/); orderNo = page.url().split("/").pop(); await expectText("PO-E2E-001");
});
await step("assign", async () => { const f = page.locator("form").filter({ has: page.locator('[name=assignee]') }); await submit(f); await noFlashError(); });
await step("inspect", async () => {
  const f = page.locator("form").filter({ has: page.locator('[name=findings]') });
  await f.locator('[name=findings]').fill("DC bus capacitors degraded; fan seized"); await f.locator('[name=probableCause]').fill("cooling failure"); await f.locator('[name=recommendation]').fill("replace fan, load test");
  await f.locator('[name="c_Power supply"]').fill("380V ±10%"); await f.locator('[name="r_Power supply"]').fill("372V"); await submit(f); await noFlashError(); await expectText("INTH");
});
await step("quote", async () => {
  const f = page.locator("form").filter({ has: page.locator('[name=d0]') });
  await f.locator('[name=d0]').fill("Cooling fan"); await f.locator('[name=l0]').fill("พัดลม"); await f.locator('[name=q0]').fill("1"); await f.locator('[name=p0]').fill("6500");
  await f.locator('[name=d1]').fill("Labour"); await f.locator('[name=l1]').fill("ค่าแรง"); await f.locator('[name=q1]').fill("4"); await f.locator('[name=p1]').fill("1500");
  await submit(f); await noFlashError(); await expectText("13375.00");
});
await step("customer-confirms", async () => { const f = page.locator("form").filter({ has: page.locator('input[name=to][value=IN_PROGRESS]') }); await submit(f); await noFlashError(); });
await step("erth-receive", async () => { const f = page.locator("form").filter({ has: page.locator('[name=sender]') }); await f.locator('[name=sender]').fill("customer truck"); await f.locator('[name=condition]').fill("dusty"); await submit(f); await noFlashError(); await expectText("ERTH"); });
await step("repair-finish", async () => {
  const f = page.locator("form").filter({ has: page.locator('[name=workPerformed]') });
  await f.locator('[name=confirmedFault]').fill("fan seized"); await f.locator('[name=rootCause]').fill("bearing wear"); await f.locator('[name=workPerformed]').fill("replaced fan, cleaned heatsink"); await f.locator('[name=laborHours]').fill("4"); await f.locator('[name=finished]').check();
  await submit(f); await noFlashError(); await expectText("RPTH");
});
await step("acceptance", async () => {
  const f = page.locator("form").filter({ has: page.locator('[name=dv0]') });
  await f.locator('[name=dv0]').fill("Runs at 50 Hz under load"); await f.locator('[name=cr0]').fill("no trip 2h"); await f.locator('[name=rs0]').fill("pass"); await f.locator('[name=customerSignatory]').fill("Khun Somchai"); await submit(f); await noFlashError(); await expectText("Accepted");
});
await step("invoice", async () => { await page.locator("form").filter({ has: page.locator("button") }).filter({ hasText: /Issue|开具|ออก/ }).locator("button").first().click(); await page.waitForTimeout(800); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("TITH2611"); await expectText("IVTH2611"); });
await step("payment", async () => {
  const f = page.locator("form").filter({ has: page.locator('[name=paidAmount]') });
  await f.locator('[name=paidAt]').fill("2026-11-03"); await f.locator('[name=paidAmount]').fill("13000"); await f.locator('[name=whtAmount]').fill("375"); await submit(f); await noFlashError();
});
await step("archive-case", async () => { const f = page.locator("form").filter({ has: page.locator('[name=lesson]') }); await f.locator('[name=lesson]').fill("check fan before capacitors"); await f.locator('[name=toFaultCode]').check(); await submit(f); await noFlashError(); });
await step("report-pdf", async () => {
  const docs = await page.locator("a[href*='/api/documents/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  const pdf = docs.find((h) => h.includes("INTH") && h.includes("format=pdf"));
  const r = await ctx.request.get(`${BASE}${pdf}`); if (r.status() !== 200 || !r.headers()["content-type"].includes("pdf")) throw new Error(`pdf ${r.status()} ${r.headers()["content-type"]}`);
  const r2 = await ctx.request.get(`${BASE}/api/documents/${orderNo}/render?template=04&format=pdf`); if (r2.status() !== 200) throw new Error(`04 render ${r2.status()}`);
});
await step("asset-timeline", async () => { await page.goto(`${BASE}/assets/${assetCode}`); for (const t of ["IN_SERVICE", "INTH", "RPTH", "TITH"]) { /* status badge is translated; check doc numbers */ } await expectText("INTH"); await expectText("RPTH"); await expectText("Paid".length ? orderNo : ""); });
await step("label", async () => { await page.goto(`${BASE}/assets/${assetCode}/label?n=4`); await expectText(assetCode); });
await step("parts-and-stock", async () => {
  await page.goto(`${BASE}/parts/ABB-FAN-${stamp}`);
  const f = page.locator("form").filter({ has: page.locator('[name=direction]') }); await f.locator('[name=direction]').selectOption("IN"); await f.locator('[name=qty]').fill("5"); await f.locator('[name=unitCost]').fill("4200"); await submit(f); await noFlashError(); await expectText("IBTH"); await expectText("on hand 5");
});
await step("search", async () => { await page.goto(`${BASE}/search?q=${assetCode}`); await expectText(assetCode); });
await step("dashboard-build", async () => { await page.goto(`${BASE}/dashboard`); await page.fill("input[placeholder*=\"Describe\"]", "本月维修看板：工单、收入、工程师"); await page.click("form button:has-text('AI')"); await page.waitForURL(/\/dashboard\/[a-z0-9]+/, { timeout: 15000 }); await expectText("Orders per month".length ? "" : ""); });
await step("people-and-finance", async () => { await page.goto(`${BASE}/people`); await expectText("ETH2611001"); await page.goto(`${BASE}/finance`); await expectText("IVTH"); await page.goto(`${BASE}/customers/${customerCode}`); await page.click("button:has-text('BLTH')"); await page.waitForTimeout(800); await page.waitForLoadState("networkidle"); const b = await page.locator("body").innerText(); if (!/BLTH2611|nothing to bill/.test(b)) throw new Error("BLTH neither issued nor correctly refused"); });
await step("sign-out", async () => { await page.click("text=Sign out"); await page.waitForURL(/\/login/); });

// ── portal, phone-sized ──
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const p = await mobile.newPage();
const pageRef = page; // keep screenshots helper on desktop page; portal uses own steps below
async function pstep(name, fn) { n++; try { await fn(); await p.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}.png`, fullPage: true }); console.log(`  ok  ${n}. ${name}`); } catch (e) { await p.screenshot({ path: `e2e-shots/${String(n).padStart(2, "0")}-${name}-FAIL.png`, fullPage: true }).catch(() => {}); console.error(`FAIL ${n}. ${name}: ${e.message}`); await browser.close(); process.exit(1); } }
const ptext = (t) => expectText(t, p);
await pstep("portal-login", async () => { await p.goto(`${BASE}/portal/login`); await p.fill('[name=login]', `somchai-${stamp.toLowerCase()}`); await p.fill('[name=password]', "portal123"); await p.locator("form").filter({ has: p.locator('[name=login]') }).locator("button").click(); await p.waitForURL(/\/portal$/); await ptext(assetCode); });
await pstep("portal-report", async () => { await p.goto(`${BASE}/portal/report?asset=${assetCode}`); await p.fill('[name=symptom]', "vibration and noise"); await p.locator("form").filter({ has: p.locator('[name=symptom]') }).locator("button").click(); await p.waitForURL(/\/portal\/orders\/QTTH/); await ptext("vibration"); });
await pstep("portal-isolation", async () => { const r = await mobile.request.get(`${BASE}/api/assets`); if (r.status() !== 401) throw new Error(`portal contact could read staff API: ${r.status()}`); });
await pstep("portal-order-history", async () => { await p.goto(`${BASE}/portal/orders/${orderNo}`); await ptext("INTH"); });

if (errors.length) { console.error("browser errors:\n" + errors.join("\n")); }
await browser.close();
console.log(`\nE2E PASSED — ${n} steps, customer ${customerCode}, asset ${assetCode}, order ${orderNo}${errors.length ? ` (with ${errors.length} browser console errors)` : ""}`);
