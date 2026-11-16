/**
 * 统一角色权限表 (需求清单 v3 第 1 节, 朱总 2026-11-16). One table for what each role may see and do; every page, server
 * action, PDF, export and the assistant ask here. Enforced on the server: a number a role may not see is never sent.
 *
 *   MD        everything
 *   FINANCE   money documents, tax, payables, reports, payroll review; sees price, cost, margin, bank
 *   HR        staff files, pay, attendance, payroll computing; no sales money, no bank, no invoices, no payments
 *   SALES     customers, orders, quotes: sees and edits price, sees cost and margin; no payments, no issuing
 *   ADMIN     内勤: clerical — sees price (cannot change it); no cost, margin, bank, other people's pay
 *   ENGINEER  the work assigned to them; no price, cost, margin, supplier price, bank
 *   MANAGER   主管: their team's work and its approvals; money exactly as the engineer (MD 2026-11-16 08:12)
 *   WAREHOUSE quantities in and out; no price, cost, margin
 */
export type Role = "MD" | "FINANCE" | "HR" | "SALES" | "ADMIN" | "ENGINEER" | "MANAGER" | "WAREHOUSE";

const is = (...roles: Role[]) => (role: string) => (roles as string[]).includes(role);

export const can = {
  /** see what the customer is charged */
  price: is("MD", "FINANCE", "SALES", "ADMIN"),
  /** set or change what the customer is charged; send a quote to the customer; confirm or refuse the customer's PO */
  editPrice: is("MD", "SALES"),
  confirmPo: is("MD", "SALES", "ADMIN"),
  /** cost, purchase price, unit cost, last cost, margin, margin thresholds, supplier prices */
  cost: is("MD", "FINANCE", "SALES"),
  /** the company's bank accounts, /admin legal entities, exchange rates */
  bank: is("MD", "FINANCE"),
  /** issue tax invoices and invoices, record receipts, credit notes, close an order */
  invoice: is("MD", "FINANCE"),
  /** see that an order has been invoiced and paid (status and numbers, no issuing) */
  invoiceStatus: is("MD", "FINANCE", "SALES", "ADMIN"),
  /** every order of the company; the others see the ones assigned to them (MANAGER: to their team) */
  allOrders: is("MD", "FINANCE", "SALES", "ADMIN"),
  /** create customers and edit their master data */
  customers: is("MD", "FINANCE", "SALES", "ADMIN"),
  /** suppliers, purchase orders */
  purchasing: is("MD", "FINANCE", "SALES", "ADMIN", "WAREHOUSE", "MANAGER"),
  /** everyone's staff file and pay */
  staff: is("MD", "HR"),
  /** staff pay figures (finance reviews the payroll) */
  pay: is("MD", "HR", "FINANCE"),
  /** money cards on the dashboard, the finance pages */
  finance: is("MD", "FINANCE"),
  /** a team to approve for */
  team: is("MD", "MANAGER"),
};

/** Roles that work on the shop floor and see their own (or their team's) orders only. */
export const scoped = (role: string) => !can.allOrders(role) && role !== "HR";

/**
 * The menu each role gets, by nav key (src/lib/nav.ts). Not in the list = not in the menu and the page behind it is
 * refused. The MD may hide more for a role on 权限管理, never show more.
 */
const HOME = ["dash", "shortcuts", "documents"], SELF = ["talent", "overtime", "payroll", "training", "expenses"];
const ALM = ["series", "assets", "knowledge"], LEAN = ["receiving", "inspectionReports", "repairReports", "maintenanceReports", "projects", "deliveryNotes", "acceptance"];
export const ROLE_MENU: Record<Exclude<Role, "MD">, string[]> = {
  FINANCE: [...HOME, ...SELF, ...ALM, "customers", "opportunities", "suppliers", "purchaseOrders", "stock", "stockIn", "stockOut", "ledger", "paymentVouchers", "statements", "cashPlan", "finReports", "proforma", "billing", "taxInvoices", "receipts", "entities"],
  HR: [...HOME, ...SELF],
  SALES: [...HOME, ...SELF, ...ALM, ...LEAN, "customers", "opportunities", "suppliers", "inquiries", "purchaseOrders", "stock", "stockIn", "stockOut", "proforma"],
  ADMIN: [...HOME, ...SELF, ...ALM, ...LEAN, "customers", "opportunities", "suppliers", "inquiries", "purchaseOrders", "stock", "stockIn", "stockOut", "dictionary"],
  ENGINEER: [...HOME, ...SELF, ...ALM, ...LEAN, "customers", "opportunities", "inquiries", "stock", "stockIn", "stockOut"],
  MANAGER: [...HOME, ...SELF, ...ALM, ...LEAN, "customers", "opportunities", "suppliers", "inquiries", "purchaseOrders", "stock", "stockIn", "stockOut"],
  WAREHOUSE: [...HOME, ...SELF, ...ALM, "receiving", "deliveryNotes", "inquiries", "purchaseOrders", "stock", "stockIn", "stockOut"],
};
export const menuAllows = (role: string, key: string) => role === "MD" || (ROLE_MENU[role as Exclude<Role, "MD">] ?? HOME).includes(key);

/** Pages that are not menu entries of their own but belong to a capability. First match decides. */
const PATH_RULES: [RegExp, (role: string) => boolean][] = [
  [/^\/customers\/new/, can.customers],
  [/^\/suppliers\/new/, is("MD", "FINANCE", "SALES", "ADMIN")],
  [/^\/purchasing\/orders\/new/, is("MD", "FINANCE", "SALES", "ADMIN")],
  [/^\/service-orders\/[^/]+\/(invoice|payment)/, can.invoiceStatus],
  [/^\/finance\/(payables|cash-plan|reports)/, can.finance],
  [/^\/finance\/expenses/, () => true],
  [/^\/finance/, can.finance],
  [/^\/tax/, can.finance],
  [/^\/admin\/permissions/, is("MD")],
  [/^\/admin\/dictionary/, is("MD", "ADMIN")],
  [/^\/admin/, can.bank],
  [/^\/people\/new/, can.staff],
  [/^\/statements/, can.invoiceStatus],
];
export function pathAllows(role: string, path: string): boolean {
  if (role === "MD") return true;
  for (const [re, ok] of PATH_RULES) if (re.test(path)) return ok(role);
  return true;
}

// ── What leaves the server (API answers, the assistant's look-ups) ──────────────────────────────────────────────

const PRICE_KEYS = new Set(["unitPrice", "amount", "subtotal", "vatAmount", "total", "totalCny", "fxRateToCny", "amountDue", "paidAmount", "whtAmount", "cashAmount", "settledAmount", "payable", "creditLimit", "price", "fee", "fees", "payPct"]);
const COST_KEYS = new Set(["unitCost", "costRef", "costTotal", "marginPct", "marginApproval", "marginNote", "marginApprovedAt", "marginApprovedById", "lastCost", "lastCostCurrency", "costPerHour", "travelCost"]);
const BANK_KEYS = new Set(["bankAccount", "bankAccounts", "bankName", "bankBranch", "swift", "accountNo", "accountName"]);
/** Asset events whose summary and payload speak of money. */
export const MONEY_EVENTS = ["QUOTED", "INVOICED", "PAID", "ORDER_CONFIRMED", "QUOTE_DECLINED"];

/**
 * A copy of `value` without the figures this role may not see — by field name, at any depth, so a look-up written
 * tomorrow is covered too. Dates and Decimals pass through untouched.
 */
export function stripMoney<T>(value: T, role: string): T {
  const price = can.price(role), cost = can.cost(role), bank = can.bank(role);
  if (price && cost && bank) return value;
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object" || v instanceof Date || typeof (v as { toFixed?: unknown }).toFixed === "function") return v;
    const o = v as Record<string, unknown>;
    const moneyEvent = !price && typeof o.type === "string" && MONEY_EVENTS.includes(o.type) && ("summary" in o || "payload" in o);
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(o)) {
      if ((!price && PRICE_KEYS.has(k)) || (!cost && COST_KEYS.has(k)) || (!bank && BANK_KEYS.has(k))) continue;
      if (moneyEvent && (k === "summary" || k === "payload")) continue;
      out[k] = walk(x);
    }
    return out;
  };
  return walk(value) as T;
}
