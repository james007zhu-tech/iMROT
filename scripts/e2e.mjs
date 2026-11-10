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
page.on("pageerror", (e) => errors.push(`pageerror at ${page.url()}: ${e.message.slice(0, 120)}`));
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
  const f = page.locator("form").filter({ has: page.locator('[name=firstChecks]') }); await f.locator('[name=code]').fill("F0001"); await f.locator('[name=title]').fill("Overcurrent"); await f.locator('[name=firstChecks]').fill("check motor cable insulation"); await f.locator('[name=level]').selectOption("model"); await submit(f); await noFlashError(); await expectText("F0001");
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
  await page.fill("[name=modelCode]", "6SL3120-2TE41-0AA1"); await page.fill("[name=serialNumber]", `SN-E2E-${stamp}`);
  await expectText(`already exists as ${assetCode}`); // warned while typing, before saving
  await selectByText(page, "[name=customerId]", `E2E Tyre ${stamp}`); await page.fill("[name=location]", "x"); await page.selectOption("[name=responsibleEmployeeId]", { index: 1 });
  await save(); await expectText(`already exists as ${assetCode}`);
});
await step("assistant-offline-lookup", async () => {
  // No ANTHROPIC_API_KEY in the test server: the assistant must still answer look-ups by record number.
  const r = await ctx.request.post(`${BASE}/api/ai/assist`, { data: { messages: [{ role: "user", content: `${assetCode} history?` }], path: "/assets" } });
  const j = await r.json(); if (!String(j.text).includes(assetCode) || !/Offline mode/.test(j.text)) throw new Error(`assistant offline: ${JSON.stringify(j).slice(0, 200)}`);
  const f = await ctx.request.post(`${BASE}/api/ai/assist`, { data: { messages: [{ role: "user", content: "new asset VFD serial X-1 location Line 3" }], path: "/assets/new", fields: ["type", "serialNumber", "location"] } });
  const fj = await f.json(); if (fj.actions?.[0]?.fields?.serialNumber !== "X-1") throw new Error(`assistant dictation: ${JSON.stringify(fj).slice(0, 200)}`);
});
await step("favicon-served", async () => {
  for (const u of ["/favicon.ico", "/icon-32.png", "/apple-touch-icon.png"]) { const r = await ctx.request.get(`${BASE}${u}`); if (r.status() !== 200) throw new Error(`${u} → ${r.status()}`); }
});

let orderNo;
await step("report-issue-and-assign", async () => {
  await page.goto(`${BASE}/service-orders/new?asset=${assetCode}`);
  // business modes (2026-11-09): six cards, repair preselected, floors shown, modes not open yet disabled
  await expectText("Margin floor 50%"); await expectText("Margin floor 33%"); await expectText("Coming in the next release");
  if (!(await page.locator("input[name=mode][value=REPAIR]").isChecked())) throw new Error("repair should be preselected");
  if (!(await page.locator("input[name=mode][value=INTERNATIONAL_TRADE]").isDisabled())) throw new Error("international trade is not open yet");
  await page.fill("[name=reportedSymptom]", "F0001 overcurrent on start"); await page.fill("[name=reportedAlarm]", "F0001"); await page.fill("[name=customerRef]", "PO-E2E-001");
  await page.selectOption("[name=assigneeCode]", { index: 1 });
  await page.locator("button[name=assign]").click(); await page.waitForURL(/\/service-orders\/QTTH/); orderNo = page.url().split("/").pop().split("?")[0];
  await expectText("PO-E2E-001"); await expectText("Inspection INTH");
});
const go = async (s) => { await page.goto(`${BASE}/service-orders/${orderNo}/${s}`); await expectText(orderNo); };
await step("inspect-draft-and-gaps", async () => {
  // Save a half-filled INTH as a draft: same number comes back, nothing is registered, missing items are listed.
  await go("inspect");
  await page.fill("[name=conditions]", "38°C dusty"); await page.fill("[name=findings]", "fan seized");
  await page.locator("button[name=draft][value='1']").click(); await page.waitForLoadState("networkidle"); await noFlashError();
  await expectText("Draft"); await expectText("Still missing:"); await expectText("isolation / lock-out confirmation");
  if ((await page.inputValue("[name=findings]")) !== "fan seized") throw new Error("draft findings not restored");
});
await step("inspect", async () => {
  await go("inspect");
  await page.fill("[name=conditions]", "38°C dusty, isolated and locked out"); await page.fill("[name=findings]", "DC bus capacitors degraded; fan seized"); await page.fill("[name=probableCause]", "cooling failure"); await page.fill("[name=recommendation]", "replace fan, load test");
  await page.fill("[name=c_supply]", "380V ±10%"); await page.fill("[name=r_supply]", "372V");
  // parts and labour the repair needs (internal rows): the fan is not in the catalogue → short → a PRTH is raised on save
  await page.fill("[name=ns0]", `ABB-FAN-${stamp}`); await page.fill("[name=nd0]", "Cooling fan"); await page.fill("[name=nq0]", "1");
  await page.selectOption("[name=nk1]", "LABOUR"); await page.fill("[name=nd1]", "Labour"); await page.fill("[name=nq1]", "4"); await page.fill("[name=nu1]", "h");
  await save(); await page.waitForURL(new RegExp(`/service-orders/${orderNo}\\?`)); await noFlashError(); await expectText("INTH"); await expectText("PRTH");
});
await step("quote", async () => {
  await go("quote");
  if ((await page.inputValue("[name=s0]")) !== `ABB-FAN-${stamp}` || (await page.inputValue("[name=q1]")) !== "4") throw new Error("quote not pre-filled from the INTH needs");
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
await step("acceptance", async () => { await go("accept"); await page.selectOption("[name=contactId]", { index: 1 }); await page.locator("[name=confirmLock]").check(); await save(); await noFlashError(); await expectText("Service completion"); });
await step("invoice", async () => { await go("invoice"); await save(); await noFlashError(); await expectText("TITH2611"); await expectText("IVTH2611"); });
await step("payment", async () => { await go("payment"); await page.fill("[name=paidAmount]", "13000"); await page.fill("[name=whtAmount]", "375"); await save(); await noFlashError(); });
await step("finance-pdfs", async () => {
  await go("payment");
  const links = await page.locator("a[href*='/api/documents/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  for (const k of ["IVTH", "TITH", "RCTH"]) { const l = links.find((h) => h.includes(`/${k}`)); if (!l) throw new Error(`no ${k} PDF link on the payment page`); const r = await ctx.request.get(`${BASE}${l}`); if (r.status() !== 200) throw new Error(`${l} → ${r.status()}`); }
});
await step("project-complete", async () => {
  await page.goto(`${BASE}/service-orders/${orderNo}`); await expectText("Fully paid"); // settled but not closed by itself
  await page.click("button:has-text('Project complete')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("Closed");
});
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
  await page.locator("input[name=mode][value=MAINTENANCE]").check(); await page.selectOption("[name=kind]", "CONTRACT"); await page.fill("[name=reportedSymptom]", "quarterly preventive maintenance"); await page.selectOption("[name=productionImpact]", "NONE"); await page.selectOption("[name=assigneeCode]", { index: 1 });
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
  await page.locator("[data-sku-name=s1]", { hasText: "Unknown SKU" }).waitFor(); // flagged while typing, before saving
  await save(); await expectText(`NOPE-${stamp}`);
  await page.fill("[name=s1]", "SIE-6SL3352-1AE32-1AA1"); await page.fill("[name=q1]", "2"); await save(); await page.waitForURL(/\/parts\?/);
  const ok = decodeURIComponent(page.url()); if (!/IBTH\d{9} · 2/.test(ok)) throw new Error(`expected one IBTH with 2 lines, got ${ok}`);
});
await step("lists-page-by-20", async () => {
  await page.goto(`${BASE}/service-orders`); const rows = await page.locator("table tbody tr").count(); if (rows > 20) throw new Error(`service order list shows ${rows} rows`);
  await expectText(" / "); // "1–20 / n" pager line
});
await step("search", async () => { await page.goto(`${BASE}/search?q=${assetCode}`); await expectText(assetCode); });
let prNo, poNo, engCode, blNo;
await step("supplier-new", async () => {
  await page.goto(`${BASE}/suppliers/new`); await page.fill("[name=nameEn]", `FA Parts ${stamp}`); await page.fill("[name=paymentTerms]", "30 days"); await page.fill("[name=leadTimeDays]", "5");
  await save(); await page.waitForURL(/\/suppliers\?/); await expectText(`FA Parts ${stamp}`);
});
await step("inquiry-new-and-compare", async () => {
  await page.goto(`${BASE}/purchasing/inquiries/new`);
  await page.fill("[name=s0]", `ABB-FAN-${stamp}`); await page.fill("[name=v0]", "FAN-01"); await page.fill("[name=d0]", "Cooling fan"); await page.fill("[name=q0]", "2");
  await save(); await page.waitForURL(/\/purchasing\/inquiries\/PRTH/); prNo = page.url().split("/").pop().split("?")[0];
  await expectText("Cooling fan");
  const q = page.locator("form#q"); await selectByText(q, "[name=supplierId]", `FA Parts ${stamp}`); await q.locator("[name=quoteNo]").fill(`FAQ-${stamp}`); await q.locator("[name=p0]").fill("3900");
  await q.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText(`FAQ-${stamp}`);
  await page.locator("form").filter({ has: page.locator("[name=quoteId]") }).locator("button").click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("Compared");
});
await step("purchase-order-and-receipt", async () => {
  await page.locator("form").filter({ hasText: "Raise POTH" }).locator("button").click(); await page.waitForURL(/\/purchasing\/orders\/POTH/); poNo = page.url().split("/").pop().split("?")[0];
  await expectText("3900.00"); await expectText("7800.00");
  await page.locator("form").filter({ hasText: "Mark as sent" }).locator("button").click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await expectText("Sent");
  const r = page.locator("form#r"); await r.locator("[name=supplierRef]").fill(`INV-${stamp}`); await r.locator("[name=r0]").fill("2");
  await r.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("Received"); await expectText("IBTH");
  await page.goto(`${BASE}/purchasing/orders`); await expectText(poNo); await page.goto(`${BASE}/purchasing/inquiries`); await expectText(prNo); await expectText("Ordered");
  for (const no of [prNo, poNo]) { const r = await ctx.request.get(`${BASE}/api/documents/${no}/render?format=pdf`); if (r.status() !== 200) throw new Error(`${no} PDF → ${r.status()}`); }
});
// ── 合作维修 (flow v4, 2026-11-08): partner profile → route → partner PRTH → quote → PO → 外送 → track → 取回 → retest → payable → rating ──
let partnerCode, pOrderNo;
await step("partner-supplier-profile", async () => {
  await page.goto(`${BASE}/suppliers/new`); await page.fill("[name=nameEn]", `Rayong Rewind ${stamp}`); await page.fill("[name=leadTimeDays]", "7");
  await save(); await page.waitForURL(/\/suppliers\?/); await page.click(`a:has-text("Rayong Rewind ${stamp}")`); await page.waitForURL(/\/suppliers\/STH/); partnerCode = page.url().split("/").pop().split("?")[0];
  const f = page.locator("form").filter({ has: page.locator("[name=isPartner]") }); await f.locator("[name=isPartner]").check(); await f.locator("input[name=cap][value=MOTOR]").check(); await f.locator("[name=extraCapabilities]").fill("CNC");
  await submit(f); await noFlashError(); await expectText("Repair partner"); if (!(await page.locator("input[name=cap][value=MOTOR]").isChecked())) throw new Error("capability not saved");
  if ((await page.locator("[name=paymentMode]").inputValue()) !== "MONTHLY") throw new Error("Thai partner should default to monthly terms");
});
await step("partner-route-from-inth", async () => {
  await page.goto(`${BASE}/service-orders/new?asset=${motorCode}`); await page.fill("[name=reportedSymptom]", "motor overheats"); await page.fill("[name=customerRef]", `PO-SECRET-${stamp}`);
  await page.selectOption("[name=assigneeCode]", { index: 1 }); await page.locator("button[name=assign]").click(); await page.waitForURL(/\/service-orders\/QTTH/); pOrderNo = page.url().split("/").pop().split("?")[0];
  await page.goto(`${BASE}/service-orders/${pOrderNo}/inspect`); await page.fill("[name=conditions]", "isolated and locked out"); await page.fill("[name=findings]", "winding insulation 0.3 MOhm"); await page.fill("[name=probableCause]", "stator winding"); await page.fill("[name=recommendation]", "rewind");
  await save(); await page.waitForURL(new RegExp(`/service-orders/${pOrderNo}\\?`)); await noFlashError();
  // 转合作维修 (2026-11-09): the repair order is closed and a new 合作维修 order carries the machine, INTH and files
  const repairNo = pOrderNo; await page.locator("summary:has-text('Reopen as partner repair')").click();
  const f = page.locator("form").filter({ has: page.locator("[name=reason]") }); await f.locator("[name=reason]").fill("rewinding is not our trade"); await submit(f);
  await page.waitForURL(/\/partner/); await noFlashError(); pOrderNo = page.url().split("/service-orders/")[1].split("/")[0];
  if (pOrderNo === repairNo) throw new Error("reopen kept the same order number");
  await expectText("never deals with the customer"); await expectText("Recommended partners"); await expectText("Partner repair"); // the new partner (0 jobs) may rank below the test DB's rated ones
  await page.goto(`${BASE}/service-orders/${repairNo}`); await expectText("continued as partner repair"); await expectText(pOrderNo);
  await page.goto(`${BASE}/service-orders/${pOrderNo}`); await expectText(`Reopened from ${repairNo}`); await expectText("winding insulation 0.3 MOhm");
  await page.goto(`${BASE}/service-orders/${pOrderNo}/partner`);
});
await step("partner-inquiry-quote-compare", async () => {
  await page.locator("button:has-text('Send partner inquiry')").click(); await page.waitForURL(/\/purchasing\/inquiries\/PRTH/); await expectText("Partner warranty (days)"); await expectText(`Repair`);
  const q = page.locator("form#q"); await selectByText(q, "[name=supplierId]", `Rayong Rewind ${stamp}`); await q.locator("[name=warrantyDays]").fill("60"); await q.locator("[name=solution]").fill("full rewind class F"); await q.locator("[name=leadTime]").fill("10"); await q.locator("[name=p0]").fill("6000");
  await q.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("full rewind class F");
  await page.locator("form").filter({ has: page.locator("[name=quoteId]") }).locator("button").click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("Compared");
  const pr = await ctx.request.get(`${BASE}/api/documents/${page.url().split("/").pop().split("?")[0]}/render?format=pdf`); if (pr.status() !== 200) throw new Error(`partner PRTH PDF → ${pr.status()}`);
});
await step("partner-quote-33pct-and-po", async () => {
  await page.goto(`${BASE}/service-orders/${pOrderNo}/quote`); if ((await page.inputValue("[name=c0]")) !== "6000") throw new Error(`partner cost not prefilled: ${await page.inputValue("[name=c0]")}`);
  await page.fill("[name=d0]", "Motor repair (rewind)"); await page.fill("[name=p0]", "9500"); await page.fill("[name=warrantyDays]", "60");
  await save(); await noFlashError(); await expectText("floor 33 %"); await expectText("36.8");
  await page.goto(`${BASE}/service-orders/${pOrderNo}/confirm`); await save(); await noFlashError();
  await page.goto(`${BASE}/service-orders/${pOrderNo}/partner`); await expectText("POTH"); await expectText("60 d");
});
await step("partner-dispatch-track-return-retest", async () => {
  const d = page.locator("form[id^=d-]"); await d.locator("[name=accessories]").fill("Fan cover × 1"); await d.locator("[name=condition]").fill("burnt smell"); await d.locator("[name=carriedBy]").fill("Art");
  await d.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("At the partner"); await expectText("OBTH");
  const m = page.locator("form[id^=m-]"); await m.locator("[name=stage]").selectOption("COMPLETED"); await m.locator("[name=note]").fill("test report RR-1"); await m.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("test report RR-1");
  const r = page.locator("form[id^=r-]"); await r.locator("[name=returned]").fill(""); await r.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await expectText("Items missing"); // nothing came back → refused
  const r2 = page.locator("form[id^=r-]"); await r2.locator("[name=returned]").fill("Fan cover × 1"); await r2.locator("[name=partnerSigned]").fill("Somchai"); await r2.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("Back, awaiting retest");
  const t = page.locator("form[id^=t-]"); await t.locator("[name=note]").fill("vibration 1.1 mm/s"); await t.locator("button[name=passed][value='1']").click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("Retest passed");
  const docs = (await page.locator("body").innerText()).match(/(OBTH|IBTH)\d{9}/g) ?? []; if (docs.length < 2) throw new Error("dispatch / return numbers not shown");
  for (const no of [...new Set(docs)]) { const x = await ctx.request.get(`${BASE}/api/documents/${no}/render?format=pdf`); if (x.status() !== 200) throw new Error(`${no} PDF → ${x.status()}`); }
});
await step("partner-payable-and-rating", async () => {
  const i = page.locator("form[id^=inv-]"); await i.locator("[name=invoiceNo]").fill(`RR-INV-${stamp}`); await i.locator("button").last().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText(`RR-INV-${stamp}`);
  const g = page.locator("form").filter({ has: page.locator("[name=cooperation]") }); await g.locator("[name=quality]").selectOption("5"); await submit(g); await noFlashError(); await expectText("Update rating");
  await page.goto(`${BASE}/finance/payables`); await expectText(`RR-INV-${stamp}`); await expectText("180.00"); // WHT 3 % of 6000
  const f = page.locator("form").filter({ has: page.locator("[name=paymentRef]") }).first(); await f.locator("[name=paymentRef]").fill("KBANK-E2E"); await submit(f); await noFlashError(); await expectText("PVTH");
  await page.goto(`${BASE}/suppliers/${partnerCode}`); await expectText("Ratings"); await expectText(`RR-INV-${stamp}`);
  await page.goto(`${BASE}/service-orders/${pOrderNo}`); await expectText("Partner repair"); await expectText("Sent to partner");
});
// ── 国内贸易 (business modes 2026-11-09): customer + SKU lines, no ATH; shortages raise a PRTH; the quote starts from the lines ──
await step("trade-order-from-inquiry", async () => {
  await page.goto(`${BASE}/service-orders/new?customer=${customerCode}`);
  await page.locator("input[name=mode][value=DOMESTIC_TRADE]").click(); await page.waitForURL(/mode=DOMESTIC_TRADE/); await page.waitForLoadState("networkidle");
  if (await page.locator("[name=assetCodes]").count()) throw new Error("the trade form still asks for an asset");
  await page.fill("[name=customerRef]", `RFQ-TR-${stamp}`); await page.fill("[name=ld0]", `Brake resistor 100 ohm ${stamp}`); await page.fill("[name=lq0]", "4");
  await save(); await page.waitForURL(/\/service-orders\/QTTH/); await noFlashError();
  const tNo = page.url().split("/service-orders/")[1].split(/[/?]/)[0];
  await expectText("Domestic trade"); await expectText("Customer and inquiry"); await expectText("Supplier inquiry"); await expectText(`Brake resistor 100 ohm ${stamp}`); await expectText("PRTH");
  await page.goto(`${BASE}/service-orders/${tNo}/quote`); if ((await page.inputValue("[name=d0]")) !== `Brake resistor 100 ohm ${stamp}`) throw new Error("quote not prefilled from the inquiry lines");
  const r = await ctx.request.get(`${BASE}/api/documents/${tNo}/render?format=pdf&template=30`); if (r.status() !== 200) throw new Error(`quotation PDF → ${r.status()}`);
  if (!/_(Quotation|ใบเสนอราคา|报价单)\.pdf/.test(decodeURIComponent(r.headers()["content-disposition"] ?? ""))) throw new Error(`quotation download name: ${r.headers()["content-disposition"]}`);
});

await step("quote-declined-returned", async () => {
  // 客户拒绝报价 (2026-11-09): no plain cancel, the reply is required, fee charged, machine back on a DNTH marked unrepaired, fee invoiced, close
  await page.goto(`${BASE}/service-orders/new?asset=${assetCode}`);
  await page.fill("[name=reportedSymptom]", `decline test ${stamp}`); await page.selectOption("[name=assigneeCode]", { index: 1 });
  await page.locator("button[name=assign]").click(); await page.waitForURL(/\/service-orders\/QTTH/);
  const dNo = page.url().split("/service-orders/")[1].split(/[/?]/)[0];
  const g = async (s) => { await page.goto(`${BASE}/service-orders/${dNo}/${s}`); await expectText(dNo); };
  await g("receive"); await page.fill("[name=sender]", "customer truck"); await page.fill("[name=accessories]", "keypad × 1"); await save(); await noFlashError();
  await g("quote"); await page.fill("[name=d0]", "Replace IGBT module"); await page.fill("[name=l0]", "เปลี่ยนโมดูล IGBT"); await page.fill("[name=q0]", "1"); await page.fill("[name=p0]", "38500"); await save(); await noFlashError();
  await page.goto(`${BASE}/service-orders/${dNo}`); await expectText("Customer declines the quote");
  if (await page.locator("button[value=CANCELLED]").count()) throw new Error("a quote for a machine can still be cancelled");
  await g("decline"); await save(); await expectText("Upload the customer's reply");
  await page.locator("[data-upload-box] input[type=file][multiple]").setInputFiles({ name: `reply-${stamp}.txt`, mimeType: "text/plain", buffer: Buffer.from("Sorry, over budget. We will buy a new drive.") });
  await expectText(`reply-${stamp}.txt`);
  await page.fill(`[name=fee_${assetCode}]`, "1500"); await save(); await noFlashError();
  await expectText("Quote declined"); await expectText("Return pending"); await expectText("Before the order closes");
  if (!(await page.locator("button:has-text('Close service order')").isDisabled())) throw new Error("close should wait for the return and the fee");
  await g("deliver"); await expectText("Machine — returned unrepaired"); await page.selectOption("[name=contactId]", { index: 1 });
  await save(); await page.waitForURL(/\/deliver\/DNTH/);
  await page.fill("[name=signedBy]", "Khun Somchai"); await save(); await page.waitForURL(new RegExp(`/service-orders/${dNo}\\?`)); await noFlashError();
  await g("invoice"); await expectText("Inspection-fee invoice"); await expectText("1605.00"); await save(); await noFlashError(); await expectText("TITH2611");
  await page.goto(`${BASE}/service-orders/${dNo}`); await page.click("button:has-text('Close service order')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError();
  await expectText("Declined — closed");
});
await step("dashboard-build", async () => { await page.goto(`${BASE}/dashboard`); await page.fill("input[placeholder*=\"Describe\"]", "本月维修看板：工单、收入、工程师"); await page.click("form button:has-text('AI')"); await page.waitForURL(/\/dashboard\/[a-z0-9]+/, { timeout: 15000 }); });
await step("employee-create-md-only", async () => {
  await page.goto(`${BASE}/people`); await page.click("a:has-text('New employee')"); await page.waitForURL(/\/people\/new/);
  await page.fill("[name=name]", `Engineer ${stamp}`); await page.fill("[name=email]", `eng-${stamp.toLowerCase()}@ducheng-industrial.com`); await page.fill("[name=password]", "engineer1"); await page.selectOption("[name=locale]", "en");
  await page.fill("[name=position]", "Field service"); await page.fill("[name=phone]", "+66 81 111 2222"); await page.fill("[name=lineId]", "eng_line");
  await page.fill("[name=cf0]", "2020-01"); await page.fill("[name=cc0]", "Old Employer Ltd"); await page.fill("[name=workPermitNo]", `WP-${stamp}`); await page.fill("[name=workPermitExpiresAt]", new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10));
  await save(); await page.waitForURL(/\/people\/ETH/); await noFlashError(); engCode = page.url().split("/").pop().split("?")[0];
  if ((await page.inputValue("[name=cc0]")) !== "Old Employer Ltd") throw new Error("career row not saved"); await expectText("Work permit"); await expectText("expires in");
  await page.goto(`${BASE}/people`); await expectText(`Engineer ${stamp}`); await expectText("+66 ** *** **22"); // contacts masked in the list
});
await step("employee-salary-and-review", async () => {
  await page.goto(`${BASE}/people/${engCode}`); await expectText("Salary records");
  await page.click("summary:has-text('Add salary record')");
  await page.fill("[name=effectiveFrom]", "2026-11-01"); await page.fill("[name=baseSalary]", "25000"); await page.fill("[name=an0]", "transport"); await page.fill("[name=aa0]", "1500"); await page.fill("[name=reason]", "hire");
  await page.click("form button:has-text('Add salary record')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError();
  await expectText("**,***"); // masked until the password is re-entered
  await page.locator("form").filter({ has: page.locator("button:has-text('Show in full')") }).locator("[name=password]").fill(PASSWORD); await page.click("button:has-text('Show in full')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle");
  await expectText("26,500.00"); await expectText("875.00"); // gross; SSO employee 5 % of the 17,500 ceiling
  await page.fill("[name=period]", "2026 Q4"); await page.fill("[name=score]", "90"); await page.fill("[name=grade]", "A"); await page.fill("[name=conclusion]", "good start");
  await page.click("button:has-text('Add review')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError(); await expectText("good start");
});
await step("salary-adjustment-notice", async () => {
  await page.goto(`${BASE}/people/${engCode}`); await page.click("summary:has-text('Add salary record')");
  await page.fill("[name=effectiveFrom]", "2026-12-01"); await page.fill("[name=baseSalary]", "28000"); await page.fill("[name=reason]", "annual review");
  await page.click("form button:has-text('Add salary record')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError();
  await expectText("Salary adjustment notice"); await expectText("+12.0%");
  const f = page.locator("#letter form"); await f.locator("[name=praiseEn]").fill("Great site work."); await f.locator("[name=praiseZh]").fill("现场工作很出色。"); await f.locator("[name=praiseTh]").fill("งานหน้างานยอดเยี่ยม");
  await f.locator("button").first().click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError();
  const href = await page.locator("#letter a:has-text('Download PDF')").getAttribute("href");
  const r = await ctx.request.get(`${BASE}${href}`); if (r.status() !== 200 || !(r.headers()["content-type"] ?? "").includes("pdf")) throw new Error(`notice PDF → ${r.status()}`);
  if ((r.headers()["x-unfilled-placeholders"] ?? "") !== "") throw new Error(`unfilled: ${r.headers()["x-unfilled-placeholders"]}`);
});
await step("non-md-sees-only-own-file", async () => {
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await c2.newPage();
  await p2.goto(`${BASE}/login`); await p2.fill("[name=email]", `eng-${stamp.toLowerCase()}@ducheng-industrial.com`); await p2.fill("[name=password]", "engineer1"); await p2.click("form button[type=submit]"); await p2.waitForURL(/\/(dashboard|assets)/); await p2.click("text=EN"); await p2.waitForTimeout(800);
  if ((await p2.locator("aside a[href='/people']").count()) > 0) throw new Error("employee list link visible to an engineer");
  await p2.goto(`${BASE}/people`); await p2.waitForURL(new RegExp(`/people/${engCode}`)); let b = await p2.locator("body").innerText();
  if (b.includes("ETH2611001") && !b.includes(engCode)) throw new Error("engineer can read the employee list");
  if (/Add salary record|26,500|\*\*,\*\*\*/.test(b)) throw new Error("salary visible to the person"); if (!b.includes("good start")) throw new Error("visible review conclusion missing on own file");
  await p2.fill("[name=wechatId]", "eng_wx"); await p2.click("button:has-text('Save contact details')"); await p2.waitForTimeout(900); await p2.waitForLoadState("networkidle"); if ((await p2.inputValue("[name=wechatId]")) !== "eng_wx") throw new Error("own contact change not saved");
  await p2.goto(`${BASE}/people/ETH2611001`); b = await p2.locator("body").innerText(); if (!/permission|Forbidden|403|无权|ไม่มีสิทธิ์/i.test(b)) throw new Error("engineer can open the MD's file"); await c2.close();
});
// ── 加班 (2026-11-09): engineer applies → MD approves → actual hours → month preview, closed month ──
await step("overtime-request-approve-month", async () => {
  const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p3 = await c3.newPage();
  await p3.goto(`${BASE}/login`); await p3.fill("[name=email]", `eng-${stamp.toLowerCase()}@ducheng-industrial.com`); await p3.fill("[name=password]", "engineer1"); await p3.click("form button[type=submit]"); await p3.waitForURL(/\/(dashboard|assets)/); await p3.click("text=EN"); await p3.waitForTimeout(800);
  await p3.goto(`${BASE}/people/${engCode}`); await p3.click("a:has-text('Overtime')"); await p3.waitForURL(/\/people\/overtime/);
  if ((await p3.locator("text=Overtime month end").count()) > 0) throw new Error("engineer sees the month-end pay");
  await p3.fill("[name=reason]", `E2E retest ${stamp}`); await p3.locator("form").filter({ has: p3.locator("[name=reason]") }).locator("button").click(); await p3.waitForTimeout(900); await p3.waitForLoadState("networkidle");
  const b3 = await p3.locator("body").innerText(); if (/Error|错误/.test(await p3.locator("[role=alert], .text-alert-ink").first().innerText().catch(() => ""))) throw new Error("request refused");
  if (!b3.includes(`E2E retest ${stamp}`) || !b3.includes("Pending")) throw new Error("request not listed as pending");
  await page.goto(`${BASE}/people/overtime`); await expectText("Waiting for my approval"); await expectText(`E2E retest ${stamp}`);
  const row = page.locator("tr").filter({ hasText: `E2E retest ${stamp}` }).first(); await row.locator("button[name=decision][value=APPROVED]").click(); await page.waitForTimeout(900); await page.waitForLoadState("networkidle"); await noFlashError();
  await p3.reload(); const mine = p3.locator("tr").filter({ hasText: `E2E retest ${stamp}` }).first(); if (!(await mine.innerText()).includes("Approved")) throw new Error("not approved for the engineer");
  await mine.locator("[name=actualEnd]").fill("20:00"); await mine.locator("button:has-text('Confirm actual')").click(); await p3.waitForTimeout(900); await p3.waitForLoadState("networkidle");
  const after = await p3.locator("tr").filter({ hasText: `E2E retest ${stamp}` }).first().innerText(); if (!after.includes("2.5") || !after.includes("Approved")) throw new Error(`actual hours not recorded: ${after}`);
  await c3.close();
  await page.reload(); await expectText("Overtime month end"); await expectText("so far (not closed)"); if (!(await page.locator("tr").filter({ hasText: engCode }).count())) throw new Error("engineer missing from the month preview");
  const closed = page.locator("a[href^='/people/overtime/20']").first(); if (await closed.count()) { await closed.click(); await page.waitForURL(/\/people\/overtime\/20\d\d-\d\d/); await expectText("Overtime pay per person"); }
});
await step("finance-and-blth", async () => { await page.goto(`${BASE}/finance`); await expectText("IVTH"); await page.goto(`${BASE}/customers/${customerCode}`); await page.click("button:has-text('BLTH')"); await page.waitForTimeout(800); await page.waitForLoadState("networkidle"); const b = await page.locator("body").innerText(); if (!/BLTH2611|nothing to bill/.test(b)) throw new Error("BLTH neither issued nor correctly refused"); blNo = (b.match(/BLTH\d{10}/) || [])[0]; });
await step("blth-detail-and-ti-void-ui", async () => {
  if (blNo) { await page.goto(`${BASE}/customers/${customerCode}`); await page.click(`a[href='/statements/${blNo}']`); await page.waitForURL(/\/statements\/BLTH/); await expectText("Statement lines"); await expectText("Ageing"); }
  else { const any = await page.request.get(`${BASE}/statements/BLTH00000000`); if (any.status() !== 404) throw new Error(`unknown statement should 404, got ${any.status()}`); console.log("      (no BLTH issued for this customer — detail page checked for 404 only)"); }
  await page.goto(`${BASE}/service-orders/${orderNo}/invoice`); await expectText("Tax invoices issued"); await expectText("valid"); await expectText("already has the valid tax invoice");
  await page.fill("input[name=reason]", "test void"); await page.click("button:has-text('Request void')"); await page.waitForTimeout(900); await page.waitForLoadState("networkidle");
  await expectText("already has payments"); // paid TITH cannot be voided — the rule shows as a flash error
});
await step("knowledge-base", async () => {
  // 2026-11-10: a code is written in our words, approved, made public and published; the public page and API show
  // it and nothing internal
  const code = `K${stamp}`.slice(0, 12), title = `过电流 ${stamp}`;
  await page.goto(`${BASE}/fault-codes/new`);
  const f = page.locator("form#f"); await f.locator("[name=seriesId]").selectOption({ label: "ABB ACS880" }); await f.locator("[name=code]").fill(code);
  await f.locator("[name=title_zh]").fill(title); await f.locator("[name=meaning_zh]").fill("输出电流超过跳闸限值"); await f.locator("[name=internalNotes]").fill(`INTERNAL ${stamp}`);
  await submit(f); await noFlashError(); await page.waitForURL(/\/fault-codes\/c/);
  await page.locator("aside button").filter({ hasText: /^(Approve|审核通过|อนุมัติ)$/ }).click(); await page.waitForURL(/ok=1/); await noFlashError();
  await page.locator("aside button").filter({ hasText: /^(Make public|设为对外|ตั้งเป็นสาธารณะ)$/ }).click(); await page.locator("aside button").filter({ hasText: /^(Make internal|设为仅内部|ตั้งเป็นภายใน)$/ }).waitFor(); await noFlashError();
  const back = page.url().split("?")[0];
  await page.goto(`${BASE}/fault-codes`); await submit(page.locator("form#publish")); await page.waitForURL(/ok=/); await page.waitForLoadState("networkidle"); await noFlashError();
  await page.goto(back); const href = await page.locator("a[href^='/faults/']").first().getAttribute("href");
  if (!href) throw new Error("no public link after publishing");
  await page.goto(`${BASE}${href}?lang=zh`); await expectText(title); await expectText("输出电流超过跳闸限值");
  if ((await page.locator("body").innerText()).includes(`INTERNAL ${stamp}`)) throw new Error("internal notes on the public page");
  const api = await (await page.request.get(`${BASE}/api/public/v1/codes/${href.replace("/faults/", "")}?lang=zh`)).json();
  if (api.title !== title || JSON.stringify(api).includes("INTERNAL")) throw new Error(`public API: ${JSON.stringify(api).slice(0, 200)}`);
  await page.goto(`${BASE}/faults?q=${encodeURIComponent(code)}`); await expectText(title);
  await page.goto(`${BASE}/fault-codes`); // back inside the app for the next step
});
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
