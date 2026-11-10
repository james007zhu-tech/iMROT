/**
 * LLM assistance (Phase 1 scope): drafts only — nothing here writes to the database.
 * Provider is switchable (decision: Claude API primary, others per specialty); calls go through one `complete()`.
 * Every output carries the record numbers it was built from, so a person can check before saving.
 */
import { prisma } from "@/lib/db";
import { ACTION_TOOLS, documentChain, runAction } from "@/server/ai-actions";
import { offlineAssist } from "./ai-offline";
import { maskNamesInText } from "@/lib/mask";

type Msg = { role: "user"; content: unknown };

/** Default model (2026-11-08: claude-sonnet-4-5 no longer answers on DCiT's key — 404 not_found_error). Override with ANTHROPIC_MODEL. */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/**
 * One Messages API call. If the configured model is unknown (an old name copied from .env.example into .env),
 * the call is repeated once with DEFAULT_MODEL instead of failing every AI feature.
 */
export async function callClaude(body: Record<string, unknown>): Promise<Response> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const send = (model: string) => fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ ...body, model }),
    signal: AbortSignal.timeout(120000),
  });
  const wanted = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
  const res = await send(wanted);
  if (res.status === 404 && wanted !== DEFAULT_MODEL) {
    const text = await res.text();
    if (/not_found_error/.test(text) && /model/i.test(text)) {
      console.warn(`[ai] model ${wanted} not available, using ${DEFAULT_MODEL}; update ANTHROPIC_MODEL in .env`);
      return send(DEFAULT_MODEL);
    }
    return new Response(text, { status: 404 });
  }
  return res;
}

export async function complete(system: string, messages: Msg[], maxTokens = 1500): Promise<string> {
  const res = await callClaude({ max_tokens: maxTokens, system, messages });
  if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { content: { type: string; text?: string }[] };
  return data.content.filter((c) => c.type === "text").map((c) => c.text).join("");
}

export function json<T>(text: string): T {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("model returned no JSON");
  return JSON.parse(m[0]) as T;
}

export interface NameplateReading { brand?: string; series?: string; model?: string; serialNumber?: string; ratedPowerKw?: number; ratedVoltageV?: number; ratedCurrentA?: number; confidence: number; notes?: string; matchedModelId?: string }

/** 建档辅助: read a nameplate photo, propose brand/series/model/serial, and match against the model library. */
export async function readNameplate(imageBase64: string, mediaType: "image/jpeg" | "image/png" = "image/jpeg"): Promise<NameplateReading> {
  const text = await complete(
    "You read industrial equipment nameplates (VFDs, motors, PLCs). Return only JSON: {brand, series, model, serialNumber, ratedPowerKw, ratedVoltageV, ratedCurrentA, confidence (0-1), notes}. Copy the model and serial exactly as printed; do not guess missing characters — leave the field null and lower confidence.",
    [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } }, { type: "text", text: "Read this nameplate." }] }],
  );
  const r = json<NameplateReading>(text);
  if (r.model) {
    const m = await prisma.model.findFirst({ where: { code: { equals: r.model, mode: "insensitive" } }, include: { series: { include: { brand: true } } } });
    if (m) { r.matchedModelId = m.id; r.brand = m.series.brand.name; r.series = m.series.name; }
  }
  return r;
}

export interface InspectionDraft { conditions?: string; findings?: string; probableCause?: string; recommendation?: string; tests?: { test: string; criterion?: string; result?: string }[]; missing: string[] }

/** 现场记录整理: turn an engineer's voice-note transcript or loose notes into the INTH fields; lists what is still missing. */
export async function draftInspection(notes: string, locale = "zh"): Promise<InspectionDraft> {
  const text = await complete(
    `You structure a field engineer's raw notes about a VFD/motor inspection into a diagnostic report. Write in ${locale === "th" ? "Thai" : locale === "en" ? "English" : "Chinese"}. Return only JSON: {conditions, findings, probableCause, recommendation, tests:[{test,criterion,result}], missing:[...]} where "missing" names the mandatory items the notes do not contain (measured values, instrument, safety isolation, customer authorization). Never invent measurements.`,
    [{ role: "user", content: notes }],
  );
  return json<InspectionDraft>(text);
}

/** 相似案例检索: closed orders on the same series/model with similar symptom, ranked by the model, each with its record numbers. */
export async function similarCases(opts: { modelId?: string; seriesId?: string; symptom: string; alarm?: string; limit?: number }) {
  const candidates = await prisma.serviceOrder.findMany({
    where: { status: { in: ["ACCEPTED", "INVOICED", "CLOSED"] }, assets: { some: { asset: opts.modelId ? { modelId: opts.modelId } : { model: { seriesId: opts.seriesId } } } } },
    include: { inspections: { where: { draft: false } }, repairJobs: true, assets: { include: { asset: { select: { code: true } } } } },
    orderBy: { reportedAt: "desc" }, take: 40,
  });
  if (candidates.length === 0) return [];
  const summary = candidates.map((c) => ({ no: c.no, symptom: c.reportedSymptom, alarm: c.reportedAlarm, cause: c.repairJobs.map((j) => j.rootCause).filter(Boolean).join("; ") || c.inspections.map((i) => i.probableCause).filter(Boolean).join("; "), work: c.repairJobs.map((j) => j.workPerformed).filter(Boolean).join("; "), docs: [...c.inspections.map((i) => i.no), ...c.repairJobs.map((j) => j.no)] }));
  const text = await complete(
    "You rank past service cases by relevance to a new fault report. Return only JSON: {ranked:[{no, relevance (0-1), why}]} with at most the requested number of entries, most relevant first. Judge on symptom and alarm similarity and whether the recorded cause would explain the new symptom.",
    [{ role: "user", content: JSON.stringify({ newCase: { symptom: opts.symptom, alarm: opts.alarm }, pastCases: summary, limit: opts.limit ?? 5 }) }],
  );
  const { ranked } = json<{ ranked: { no: string; relevance: number; why: string }[] }>(text);
  return ranked.map((r) => ({ ...r, ...summary.find((s) => s.no === r.no)! }));
}

/** 三语报告: translate report field values th/zh/en while keeping numbers, codes and document numbers untouched. */
export async function translateFields(values: Record<string, string>, target: "th" | "zh" | "en"): Promise<Record<string, string>> {
  const text = await complete(
    `Translate the JSON values into ${target === "th" ? "Thai" : target === "zh" ? "Simplified Chinese" : "English"} for a technical service report. Keep keys, numbers, units, model codes, serial numbers and document numbers exactly as they are. Return only the JSON object.`,
    [{ role: "user", content: JSON.stringify(values) }], 3000,
  );
  return json<Record<string, string>>(text);
}

// ───────────────────────── Dashboard builder ─────────────────────────

import { METRICS, sanitizeSpec, type DashboardSpec } from "@/lib/metrics";
import { createDashboard, updateDashboard } from "@/server/dashboards";

/** Keyword fallback so dashboards can be built even without an API key (and in tests). */
export function heuristicSpec(prompt: string): DashboardSpec {
  const p = prompt.toLowerCase();
  const pick = (ids: string[], chart: "kpi" | "bar" | "line" | "donut" | "table", w: 1 | 2 = 2) => ids.map((metric) => ({ metric, chart, w }));
  const widgets: DashboardSpec["widgets"] = [];
  if (/revenue|收入|营收|รายได้|invoice|开票|cny/.test(p)) widgets.push(...pick(["revenue_cny_per_month"], "line"), ...pick(["receivables_outstanding"], "kpi", 1));
  if (/order|工单|服务单|งาน|repair|维修/.test(p)) widgets.push(...pick(["open_orders"], "kpi", 1), ...pick(["orders_per_month"], "bar"), ...pick(["orders_by_status"], "donut"), ...pick(["orders_by_engineer"], "bar"));
  if (/asset|设备|อุปกรณ์|customer|客户|ลูกค้า|brand|品牌/.test(p)) widgets.push(...pick(["assets_in_service", "assets_total"], "kpi", 1), ...pick(["assets_by_customer"], "bar"), ...pick(["assets_by_brand"], "donut"), ...pick(["assets_by_status"], "donut"));
  if (/part|备件|อะไหล่|spare/.test(p)) widgets.push(...pick(["parts_replaced_top"], "bar"));
  if (/engineer|工程师|วิศวกร/.test(p)) widgets.push(...pick(["orders_by_engineer"], "bar"), ...pick(["avg_days_report_to_accept"], "kpi", 1));
  if (widgets.length === 0) widgets.push(...pick(["open_orders", "assets_in_service", "receivables_outstanding", "avg_days_report_to_accept"], "kpi", 1), ...pick(["orders_per_month"], "bar"), ...pick(["orders_by_status"], "donut"));
  return sanitizeSpec({ widgets });
}

export async function buildDashboardFromPrompt(prompt: string, employeeCode: string, locale = "zh", dashboardId?: string) {
  let spec: DashboardSpec;
  let name = prompt.slice(0, 40);
  if (process.env.ANTHROPIC_API_KEY) {
    const catalog = METRICS.map((m) => ({ id: m.id, title: m.title.en, charts: m.charts, params: m.params }));
    const text = await complete(
      `You design dashboards for an industrial service company. Choose only metrics from the catalog. Return only JSON: {"name": "<short title in ${locale === "th" ? "Thai" : locale === "en" ? "English" : "Chinese"}>", "widgets":[{"metric": id, "chart": one of the metric's charts, "w": 1 or 2, "params": {...}}]}. KPIs use w=1, charts w=2. 4 to 10 widgets, most important first.`,
      [{ role: "user", content: JSON.stringify({ request: prompt, catalog }) }],
    );
    const j = json<{ name?: string; widgets: unknown }>(text);
    spec = sanitizeSpec(j);
    if (j.name) name = j.name;
    if (spec.widgets.length === 0) spec = heuristicSpec(prompt);
  } else {
    spec = heuristicSpec(prompt);
  }
  if (dashboardId) return updateDashboard(dashboardId, { spec });
  return createDashboard(name, spec, employeeCode);
}

// ───────────────────────── Assistant with tools ─────────────────────────

type ToolResult = object | unknown[] | string;
interface Tool { name: string; description: string; input_schema: Record<string, unknown>; run: (input: Record<string, unknown>, ctx: AssistContext) => Promise<ToolResult> }
export interface AssistContext { employeeCode?: string; contactId?: string; customerId?: string; locale: string; path?: string; fields?: string[] }
export interface AssistAction { type: "navigate" | "fill_form" | "dashboard" | "confirm" | "done"; href?: string; fields?: Record<string, string>; id?: string; summary?: string }
export interface AssistFile { name: string; url: string; mediaType: string; bytes: Buffer }

const TOOLS: Tool[] = [
  { name: "get_asset", description: "Full record of one asset by DCiT code (ATH…): header, events timeline, linked orders, model knowledge.", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
    run: async ({ code }, ctx) => { const a = await prisma.asset.findFirst({ where: { code: String(code), customerId: ctx.customerId ?? undefined }, include: { model: { include: { series: { include: { brand: true } } } }, customer: { select: { name: true } }, events: { orderBy: { occurredAt: "desc" }, take: 30 }, orderLinks: { include: { serviceOrder: { select: { no: true, status: true, total: true, currency: true, reportedAt: true } } } } } }); return a ?? "not found"; } },
  { name: "search_assets", description: "Search assets by code, serial, location, customer name or model.", input_schema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
    run: async ({ q }, ctx) => prisma.asset.findMany({ where: { customerId: ctx.customerId ?? undefined, OR: [{ code: { contains: String(q), mode: "insensitive" } }, { serialNumber: { contains: String(q), mode: "insensitive" } }, { location: { contains: String(q), mode: "insensitive" } }, { customer: { name: { contains: String(q), mode: "insensitive" } } }, { model: { code: { contains: String(q), mode: "insensitive" } } }] }, select: { code: true, serialNumber: true, status: true, location: true, customer: { select: { name: true } }, model: { select: { code: true } } }, take: 20 }) },
  { name: "get_order", description: "One service order (QTTH…) with assets, lines, inspections, repair jobs, acceptance, invoices.", input_schema: { type: "object", properties: { no: { type: "string" } }, required: ["no"] },
    run: async ({ no }, ctx) => { const o = await prisma.serviceOrder.findFirst({ where: { no: String(no), customerId: ctx.customerId ?? undefined }, include: { customer: { select: { name: true } }, assets: { include: { asset: { select: { code: true, serialNumber: true, location: true } } } }, lines: true, inspections: { where: { draft: false } }, repairJobs: true, acceptance: true, invoices: true } }); return o ?? "not found"; } },
  { name: "list_orders", description: "List service orders, optionally by status or customer name.", input_schema: { type: "object", properties: { status: { type: "string" }, customer: { type: "string" }, limit: { type: "number" } } },
    run: async ({ status, customer, limit }, ctx) => prisma.serviceOrder.findMany({ where: { status: status ? (String(status) as never) : undefined, customerId: ctx.customerId ?? undefined, customer: customer ? { name: { contains: String(customer), mode: "insensitive" } } : undefined }, select: { no: true, status: true, kind: true, reportedAt: true, reportedSymptom: true, total: true, currency: true, customer: { select: { name: true } }, assignee: { select: { name: true } } }, orderBy: { reportedAt: "desc" }, take: Number(limit ?? 20) }) },
  { name: "similar_cases", description: "Past cases on the same model/series with a similar symptom.", input_schema: { type: "object", properties: { assetCode: { type: "string" }, symptom: { type: "string" }, alarm: { type: "string" } }, required: ["assetCode", "symptom"] },
    run: async ({ assetCode, symptom, alarm }) => { const a = await prisma.asset.findUnique({ where: { code: String(assetCode) }, include: { model: true } }); if (!a?.model) return "asset has no model"; return similarCases({ modelId: a.modelId!, seriesId: a.model.seriesId, symptom: String(symptom), alarm: alarm ? String(alarm) : undefined }); } },
  { name: "draft_inspection", description: "Turn raw engineer notes into structured inspection fields (conditions, findings, probableCause, recommendation, tests) and list missing items. The user confirms before saving.", input_schema: { type: "object", properties: { notes: { type: "string" } }, required: ["notes"] },
    run: async ({ notes }, ctx) => draftInspection(String(notes), ctx.locale) },
  { name: "build_dashboard", description: "Create a dashboard from a description; returns its id. Use when the user asks for a dashboard, chart, overview or report of numbers.", input_schema: { type: "object", properties: { description: { type: "string" } }, required: ["description"] },
    run: async ({ description }, ctx) => { if (!ctx.employeeCode) return "dashboards are for staff"; const d = await buildDashboardFromPrompt(String(description), ctx.employeeCode, ctx.locale); return { id: d.id, name: d.name, href: `/dashboard/${d.id}` }; } },
  { name: "metric", description: "Read one metric from the catalog (ids: " + METRICS.map((m) => m.id).join(", ") + ").", input_schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
    run: async ({ id }) => { const m = METRICS.find((x) => x.id === String(id)); return m ? await m.run(prisma, {}) : "unknown metric"; } },
];

const CHAIN_TOOL: Tool = { name: "order_chain", description: "The document chain of one order: every numbered document (quote, inspection, delivery note, invoice, tax invoice, receipt …) with dates, plus supplier inquiries and purchase orders.", input_schema: { type: "object", properties: { no: { type: "string" } }, required: ["no"] }, run: async ({ no }) => documentChain(String(no)) };

export const PORTAL_TOOLS = new Set(["get_asset", "search_assets", "get_order", "list_orders"]);

const SYSTEM = (ctx: AssistContext) => `You are the DCiT OS assistant inside an equipment-service system (ALM assets, SLM service orders, CRM, SCM, FIN). Answer in ${ctx.locale === "th" ? "Thai" : ctx.locale === "en" ? "English" : "Chinese"}, briefly, with the record numbers (ATH…, QTTH…, INTH…) you relied on. Use tools to look things up; never guess numbers. ${ctx.customerId ? "The user is a customer contact: only their own assets and orders are visible; do not discuss costs, margins or other customers." : "The user is DCiT staff."} The user is on page ${ctx.path ?? "/"}.${ctx.fields?.length ? ` The form on this page has these field names: ${ctx.fields.join(", ")}.` : ""} When the user dictates or asks you to fill in a record, draft the values and finish with a line 'FORM:' followed by a JSON object of field name → value (only names from the list) so the app can fill the form; the user reviews and saves. When you create a dashboard, finish with 'GOTO:' and its href. ${ctx.customerId ? "" : "When the user wants to start a piece of work that has a page, take them there: finish with 'GOTO:' and the path. Pages: /assets/new (new machine), /customers/new (new customer; add ?overseas=1 for a foreign company), /service-orders/new?mode=REPAIR | PARTNER_REPAIR | MAINTENANCE | AUTOMATION_PROJECT | DOMESTIC_TRADE | INTERNATIONAL_TRADE (new business order of that type), /service-orders/<QTTH no> (one order: quote, inspection, repair, delivery, invoice and payment are steps on it), /service-orders?status=<STATUS> (list), /suppliers/new, /purchasing/inquiries/new, /purchasing/orders/new, /parts (stock), /parts/movement (stock in / out), /fault-codes (knowledge base, ?q= searches), /series (brands and models), /finance, /finance/payables, /tax?doc=iv|rc|ti (invoices, receipts, tax invoices), /people/overtime, /people/<ETH code> (an employee file), /dashboard. You can also DO the work with the action tools (create_customer, add_contact, create_asset, update_employee_profile, add_employee_document, create_order, assign_order, set_quote, confirm_customer_po, request_supplier_quotes, issue_delivery, sign_delivery, issue_proforma, issue_tax_invoice, record_payment). House style (the MD's decision): act, do not ask for permission — when the user states what they want or hands you a document, carry it through as far as the facts allow, several actions in a row (e.g. inquiry PDF → find or create the customer → create the order with all lines and terms → request supplier quotes), then report what you did with the record numbers. Ask only for facts you cannot find and must not invent: prices, quantities, tax IDs, serial numbers, who signed. Never invent a number, a name or a date; copy document numbers and part numbers verbatim. issue_tax_invoice and record_payment are not executed by you: they produce a confirmation card the user presses, so say 'please confirm below', never that it is done. If an action returns an error, say so plainly and what is missing. Use order_chain to show an order's document chain. Attached files are saved and stay attached for the whole conversation (their name and url are listed with the message); you have read them — do not doubt that later. Pass {name, url} where an action takes a file (add_employee_document.file). 'My personal information / 我的个人信息' means the signed-in person's own employee file (/people/<their code>): write the facts with update_employee_profile and file the document itself with add_employee_document. Ignore the page's search box when deciding what you can do."}`;

/** Tool-use loop against the Anthropic Messages API. Returns the final text and any UI actions parsed from it. */
export async function assist(messages: { role: "user" | "assistant"; content: string }[], ctx: AssistContext, files: AssistFile[] = []): Promise<{ text: string; actions: AssistAction[]; toolsUsed: string[] }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return offlineAssist(messages, ctx); // keyword fallback: look-ups by record number, history, dictated new asset
  // Portal contacts get only the four customer-filtered read tools; similar_cases and metric read across all customers.
  if (!ctx.employeeCode && !ctx.customerId) throw new Error("assistant needs a staff or customer scope");
  const actionTools: Tool[] = ctx.employeeCode ? ACTION_TOOLS.map((a) => ({ name: a.name, description: a.description, input_schema: a.input_schema, run: async (input) => runAction(a.name, input, { employeeCode: ctx.employeeCode! }) })) : [];
  const allowed = ctx.employeeCode ? [...TOOLS, CHAIN_TOOL, ...actionTools] : TOOLS.filter((t) => PORTAL_TOOLS.has(t.name));
  const cards: AssistAction[] = [];
  const tools = allowed.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
  const convo: unknown[] = messages.map((m) => ({ role: m.role, content: m.content }));
  if (files.length && messages.at(-1)?.role === "user") {
    // the person's files go to the model as they are (PDF, picture, text); anything else is named only
    const blocks: unknown[] = [];
    for (const f of files) {
      if (f.mediaType === "application/pdf") blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.bytes.toString("base64") } });
      else if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.mediaType)) blocks.push({ type: "image", source: { type: "base64", media_type: f.mediaType, data: f.bytes.toString("base64") } });
      else if (f.mediaType.startsWith("text/") || /\.(txt|csv|eml|md)$/i.test(f.name)) blocks.push({ type: "text", text: `--- ${f.name} ---\n${f.bytes.toString("utf8").slice(0, 30000)}` });
    }
    blocks.push({ type: "text", text: `${messages.at(-1)!.content || "(no message — work out what this document is and do what it calls for)"}\n\nAttached files (saved): ${JSON.stringify(files.map((f) => ({ name: f.name, url: f.url })))}` });
    convo[convo.length - 1] = { role: "user", content: blocks };
  }
  const used: string[] = [];
  for (let round = 0; round < 14; round++) {
    const res = await callClaude({ max_tokens: 3000, system: SYSTEM(ctx), tools, messages: convo });
    if (!res.ok) throw new Error(`LLM call failed: ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { stop_reason: string; content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[] };
    convo.push({ role: "assistant", content: data.content });
    if (data.stop_reason !== "tool_use") {
      const text = data.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
      return { text: text.replace(/\n?(FORM|GOTO):[\s\S]*$/, "").trim(), actions: [...cards, ...parseActions(text)], toolsUsed: used };
    }
    const results: { type: "tool_result"; tool_use_id: string | undefined; content: string }[] = [];
    const names = await personNames(); // customer people are masked for the model too, so it cannot repeat full names (rule 13)
    for (const c of data.content) {
      if (c.type !== "tool_use") continue;
      const tool = allowed.find((t) => t.name === c.name);
      used.push(c.name!);
      let out: ToolResult;
      try { out = tool ? await tool.run(c.input ?? {}, ctx) : "unknown tool"; } catch (e) { out = `error: ${(e as Error).message}`; }
      const r = out as { ok?: boolean; pending?: string; summary?: string; href?: string };
      if (r && typeof r === "object" && r.pending) cards.push({ type: "confirm", id: r.pending, summary: r.summary });
      else if (r && typeof r === "object" && r.ok && r.summary && ACTION_TOOLS.some((a) => a.name === c.name)) cards.push({ type: "done", summary: r.summary, href: r.href });
      results.push({ type: "tool_result", tool_use_id: c.id, content: maskNamesInText(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? Number(v) : v)), names).slice(0, 20000) });
    }
    convo.push({ role: "user", content: results });
  }
  return { text: "Stopped after too many tool calls.", actions: [], toolsUsed: used };
}

/** Names of customer people (contacts, delivery signers, acceptance signatories) — masked wherever the assistant shows records. */
export async function personNames(): Promise<string[]> {
  const [contacts, notes, accepts] = await Promise.all([
    prisma.contact.findMany({ select: { name: true } }),
    prisma.deliveryNote.findMany({ where: { signedBy: { not: null } }, select: { signedBy: true } }),
    prisma.acceptance.findMany({ where: { customerSignatory: { not: null } }, select: { customerSignatory: true } }),
  ]);
  return [...new Set([...contacts.map((c) => c.name), ...notes.map((n) => n.signedBy ?? ""), ...accepts.map((a) => a.customerSignatory ?? "")].map((n) => n.trim()).filter((n) => n.length >= 2))];
}

export function parseActions(text: string): AssistAction[] {
  const actions: AssistAction[] = [];
  const form = /FORM:\s*(\{[\s\S]*?\})\s*$/m.exec(text);
  if (form) { try { actions.push({ type: "fill_form", fields: JSON.parse(form[1]) }); } catch { /* ignore */ } }
  const go = /GOTO:\s*(\/\S+)/.exec(text);
  if (go) actions.push({ type: "navigate", href: go[1] });
  return actions;
}
