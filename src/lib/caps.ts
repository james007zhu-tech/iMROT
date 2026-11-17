/**
 * 六角色权限表 (需求清单 v3 第 1 节, 朱总 2026-11-16 16:31 定稿 — 取代旧的七角色表). One table for what each role may see
 * and do; every page, server action, PDF, export and the assistant ask here. Enforced on the server: a number a role may
 * not see is never sent.
 *
 *   MD          everything; releases payments above THB 50,000; approves the payroll. Does not make payments.
 *   HR          组织发展: staff files, hiring, attendance, overtime, computes the payroll, training. No customer price,
 *               cost, margin, company bank; no invoices, no payments, no payroll approval.
 *   FINANCE     (FIN) everything about money: invoices, receipts, receivables, payables, payments, cash plan, reports,
 *               rates, legal entities and bank, payroll review. Does not compute or approve payroll, does not change quotes.
 *   PURCHASING  (PUR) 采购和供应链: requisitions, POTH, suppliers, inquiries, stock in and out, parts. Sees purchase
 *               cost; never the customer's price or the margin; no invoices, payments, pay.
 *   SALES       customers and orders through to collection: quotes, customer PO, delivery, acceptance, receivables
 *               follow-up. Sees price, cost and margin. Cannot issue invoices or record money.
 *   ENGINEER    (ENG) inspection, repair, maintenance, site hours, parts issue and return, asset files, knowledge
 *               drafts. No price, cost, margin, supplier price, bank.
 *
 * A person may hold several roles (Employee.role + extraRoles): what they may do is the union.
 * 主管 is not a role: it is an ENGINEER with `approver` — they approve their team's overtime, leave, expenses, reports
 * and knowledge entries, and see money exactly as any engineer.
 * The old roles 内勤 ADMIN, 仓库 WAREHOUSE, 经理 MANAGER are gone (ADMIN → SALES, WAREHOUSE → PURCHASING,
 * MANAGER → ENGINEER + approver; scripts/dev/backfill.ts). They stay in the database enum only so old audit rows read.
 */
export type Role = "MD" | "HR" | "FINANCE" | "PURCHASING" | "SALES" | "ENGINEER";
export const ROLES6: Role[] = ["MD", "HR", "FINANCE", "PURCHASING", "SALES", "ENGINEER"];
/** How the six are written on screen, in every language (朱总's own names). */
export const ROLE_SHORT: Record<Role, string> = { MD: "MD", HR: "HR", FINANCE: "FIN", PURCHASING: "PUR", SALES: "Sales", ENGINEER: "ENG" };
const OLD: Record<string, Role> = { ADMIN: "SALES", WAREHOUSE: "PURCHASING", MANAGER: "ENGINEER" };

/** Who is asking: a role, a list of roles, or a person (their role, extra roles and whether they approve for a team). */
export type Who = string | readonly string[] | { role: string; extraRoles?: readonly string[] | null; approver?: boolean | null };
export function rolesOf(who: Who): Role[] {
  const raw = typeof who === "string" ? [who] : Array.isArray(who) ? who : [(who as { role: string }).role, ...((who as { extraRoles?: readonly string[] | null }).extraRoles ?? [])];
  return [...new Set((raw as string[]).map((r) => OLD[r] ?? (r as Role)))];
}
export const hasRole = (who: Who, ...roles: string[]) => rolesOf(who).some((r) => roles.includes(r));
/** 本组审批人: the MD, or a person marked as approver for the people who report to them. */
export const isApprover = (who: Who) => hasRole(who, "MD") || (typeof who === "object" && !Array.isArray(who) && !!(who as { approver?: boolean | null }).approver);

const is = (...roles: Role[]) => (who: Who) => hasRole(who, ...roles);

export const can = {
  /** see what the customer is charged */
  price: is("MD", "FINANCE", "SALES"),
  /** set or change what the customer is charged; send a quote to the customer */
  editPrice: is("MD", "SALES"),
  /** confirm or refuse the customer's PO, deliver, accept */
  confirmPo: is("MD", "SALES"),
  /** purchase price, unit cost, last cost, supplier prices */
  cost: is("MD", "FINANCE", "PURCHASING"), // Sales never sees what we paid (MD 2026-11-17 18:29): they estimate the cost of their own quote
  /** margin, margin thresholds, and cost where it stands next to the customer's price (quotes, orders, plans) */
  margin: is("MD", "FINANCE", "SALES"),
  /** the company's bank accounts, /admin legal entities; maintain exchange rates */
  bank: is("MD", "FINANCE"),
  /** issue tax invoices and invoices, record receipts, credit notes, close an order */
  invoice: is("MD", "FINANCE"),
  /** see that an order has been invoiced and paid (status and numbers, no issuing) */
  invoiceStatus: is("MD", "FINANCE", "SALES"),
  /** every order of the company; engineers see the ones assigned to them (approvers: to their team); HR none */
  allOrders: is("MD", "FINANCE", "PURCHASING"), // Sales: the customers they are responsible for (需求清单 v4 V4-P0-02)
  /** create customers and edit their master data */
  customers: is("MD", "SALES"),
  /** every customer with tax id, terms, receivables */
  customersAll: is("MD", "FINANCE"),
  /** who the customer of an order is (name on lists and papers): not for PUR and HR */
  customerNames: is("MD", "FINANCE", "SALES", "ENGINEER"),
  /** tax id, terms and receivables of the customers one may see at all */
  customerMoney: is("MD", "FINANCE", "SALES"),
  /** see suppliers and purchase orders (Sales: arrival status) */
  purchasing: is("MD", "FINANCE", "PURCHASING", "SALES"),
  /** suppliers, inquiries, purchase orders, receiving, parts master: create and change */
  purchase: is("MD", "PURCHASING"),
  /** everyone's staff file and pay */
  staff: is("MD", "HR"),
  /** staff pay figures (finance reviews the payroll) */
  pay: is("MD", "HR", "FINANCE"),
  /** money cards on the dashboard, the finance pages */
  finance: is("MD", "FINANCE"),
  /** a team to approve for */
  team: isApprover,
  /** inspection / repair / maintenance reports */
  reports: is("MD", "SALES", "ENGINEER"),
  /** the knowledge base and fault codes */
  knowledge: is("MD", "PURCHASING", "SALES", "ENGINEER"),
};

/** People who work on the shop floor and see their own (or their team's) orders only. */
export const scoped = (who: Who) => !can.allOrders(who) && hasRole(who, "ENGINEER");
/** People who see no order at all (HR alone). */
export const noOrders = (who: Who) => !can.allOrders(who) && !hasRole(who, "ENGINEER", "SALES");

/**
 * The menu each role gets, by nav key (src/lib/nav.ts). Not in the list = not in the menu and the page behind it is
 * refused. Several roles: the union. The MD may hide more for a role on 权限管理, never show more.
 */
const HOME = ["dash", "shortcuts"], DOCS = ["documents"], SELF = ["talent", "overtime", "leave", "payroll", "training", "expenses"];
const ALM = ["series", "assets", "knowledge"], REPORTS = ["inspectionReports", "repairReports", "maintenanceReports"];
// 六角色的默认权限写在这里 (需求清单 v4 V4-P0-04): a new employee has them the moment a role is chosen — nobody ticks boxes.
export const ROLE_MENU: Record<Exclude<Role, "MD">, string[]> = {
  HR: [...HOME, ...SELF],
  FINANCE: [...HOME, ...DOCS, ...SELF, "customers", "opportunities", "deliveryNotes", "acceptance", "suppliers", "inquiries", "purchaseOrders", "stock", "stockIn", "stockOut",
    "ledger", "paymentVouchers", "statements", "cashPlan", "finReports", "proforma", "billing", "taxInvoices", "receipts", "entities"],
  PURCHASING: [...HOME, ...DOCS, ...SELF, "knowledge", "opportunities", "deliveryNotes", "suppliers", "inquiries", "purchaseOrders", "stock", "stockIn", "stockOut", "dictionary"],
  SALES: [...HOME, ...DOCS, ...SELF, ...ALM, ...REPORTS, "receiving", "deliveryNotes", "acceptance", "projects", "customers", "opportunities", "inquiries", "purchaseOrders", "stock",
    "statements", "proforma", "billing", "taxInvoices", "receipts"],
  ENGINEER: [...HOME, ...DOCS, ...SELF, ...ALM, ...REPORTS, "receiving", "acceptance", "projects", "customers", "opportunities", "inquiries", "stock", "stockOut"],
};
export const menuAllows = (who: Who, key: string) => rolesOf(who).some((r) => r === "MD" || (ROLE_MENU[r as Exclude<Role, "MD">] ?? HOME).includes(key));
/** The roles a menu entry belongs to — for 「无权限，此功能属于 XX 角色」. */
export const menuOwners = (key: string): Role[] => ROLES6.filter((r) => r !== "MD" && menuAllows(r, key));

/** Pages that are not menu entries of their own but belong to a capability. First match decides. */
const PATH_RULES: [RegExp, (who: Who) => boolean][] = [
  [/^\/customers\/new/, can.customers],
  [/^\/suppliers\/new/, can.purchase],
  [/^\/purchasing\/orders\/new/, can.purchase],
  [/^\/purchasing\/inquiries\/new/, is("MD", "PURCHASING", "SALES", "ENGINEER")],
  [/^\/parts\/new/, can.purchase],
  [/^\/parts\/movement/, is("MD", "PURCHASING", "ENGINEER")],
  [/^\/service-orders\/new/, is("MD", "SALES", "ENGINEER")],
  [/^\/service-orders\/[^/]+\/(invoice|payment)/, can.invoiceStatus],
  [/^\/service-reports/, can.reports],
  [/^\/finance\/expenses/, () => true],
  [/^\/finance/, can.finance],
  [/^\/tax/, can.invoiceStatus],
  [/^\/admin\/permissions/, is("MD")],
  [/^\/admin\/dictionary/, can.purchase],
  [/^\/admin/, can.bank],
  [/^\/people\/new/, can.staff],
  [/^\/statements\/?$/, can.finance], // the list: finance and the MD (派修单 v3 第 7 条)
  [/^\/statements/, can.invoiceStatus],
];
export function pathAllows(who: Who, path: string): boolean {
  if (hasRole(who, "MD")) return true;
  for (const [re, ok] of PATH_RULES) if (re.test(path)) return ok(who);
  return true;
}
/** The roles a path belongs to, when a rule above decides it. */
export function pathOwners(path: string): Role[] {
  for (const [re, ok] of PATH_RULES) if (re.test(path)) return ROLES6.filter((r) => r !== "MD" && ok(r));
  return [];
}

// ── What leaves the server (API answers, the assistant's look-ups) ──────────────────────────────────────────────

const PRICE_KEYS = new Set(["unitPrice", "amount", "subtotal", "vatAmount", "total", "totalCny", "fxRateToCny", "amountDue", "paidAmount", "whtAmount", "cashAmount", "settledAmount", "payable", "creditLimit", "price", "fee", "fees", "payPct"]);
const COST_KEYS = new Set(["costRef", "lastCost", "lastCostCurrency", "costPerHour", "travelCost"]); // what we paid: MD, FIN, PUR
const QUOTE_COST_KEYS = new Set(["unitCost", "costTotal"]); // the cost written on a quote: those who see its margin (MD, FIN, Sales)
const MARGIN_KEYS = new Set(["marginPct", "marginApproval", "marginNote", "marginApprovedAt", "marginApprovedById"]);
const BANK_KEYS = new Set(["bankAccount", "bankAccounts", "bankName", "bankBranch", "swift", "accountNo", "accountName"]);
/** Asset events whose summary and payload speak of money. */
export const MONEY_EVENTS = ["QUOTED", "INVOICED", "PAID", "ORDER_CONFIRMED", "QUOTE_DECLINED"];

/**
 * A copy of `value` without the figures this role may not see — by field name, at any depth, so a look-up written
 * tomorrow is covered too. Dates and Decimals pass through untouched.
 */
export function stripMoney<T>(value: T, who: Who): T {
  const price = can.price(who), cost = can.cost(who), margin = can.margin(who), bank = can.bank(who);
  const names = can.customerNames(who);
  if (price && cost && margin && bank && names) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object" || v instanceof Date || typeof (v as { toFixed?: unknown }).toFixed === "function") return v;
    const o = v as Record<string, unknown>;
    const moneyEvent = !price && typeof o.type === "string" && MONEY_EVENTS.includes(o.type) && ("summary" in o || "payload" in o);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if ((!price && PRICE_KEYS.has(k)) || (!cost && COST_KEYS.has(k)) || (!margin && (MARGIN_KEYS.has(k) || QUOTE_COST_KEYS.has(k))) || (!bank && BANK_KEYS.has(k))) continue;
      if (moneyEvent && (k === "summary" || k === "payload")) continue;
      // PUR and HR work by order number: of the customer only the code travels (派修单 v2 第 4 条)
      if (!names && k === "customer" && x && typeof x === "object") { out[k] = { code: (x as { code?: unknown }).code }; continue; }
      if (!names && (k === "customerName" || k === "customerId")) continue;
      out[k] = walk(x);
    }
    return out;
  };
  return walk(value) as T;
}
