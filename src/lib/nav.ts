/**
 * Menu of DCiT OS (朱总 2026-11-10): nine modules, each with its second level. `soon` entries have no page yet and
 * open /soon/<key>, which says so plainly. Labels: messages "nav" namespace, key = the item key.
 */
export interface NavItem { key: string; href: string; soon?: boolean; mdOnly?: boolean }
export interface NavGroup { key: string; href?: string; items: NavItem[] }

const soon = (key: string): NavItem => ({ key, href: `/soon/${key}`, soon: true });

const doc = (key: string, type: string): NavItem => ({ key, href: `/documents?type=${type}` });

/**
 * 朱总 2026-11-10: every numbered document has one place of its own in the menu, under its own name (not merged
 * behind tabs); 首页 itself opens the conversation; 单据中心 lists every document.
 */
export const NAV: NavGroup[] = [
  { key: "home", href: "/home", items: [{ key: "dash", href: "/dashboard" }, { key: "shortcuts", href: "/shortcuts" }, { key: "documents", href: "/documents" }] },
  { key: "alm", items: [{ key: "series", href: "/series" }, { key: "assets", href: "/assets" }, { key: "knowledge", href: "/fault-codes" }] },
  { key: "crm", items: [{ key: "customers", href: "/customers" }, { key: "opportunities", href: "/service-orders" }] },
  { key: "lean", items: [doc("receiving", "ER"), { key: "inspectionReports", href: "/service-reports?kind=inspection" }, { key: "repairReports", href: "/service-reports?kind=repair" }, { key: "maintenanceReports", href: "/service-reports?kind=maintenance" }, doc("deliveryNotes", "DN"), doc("acceptance", "AC"), { key: "projects", href: "/service-orders?mode=AUTOMATION_PROJECT" }] },
  { key: "scm", items: [{ key: "suppliers", href: "/suppliers" }, { key: "inquiries", href: "/purchasing/inquiries" }, { key: "purchaseOrders", href: "/purchasing/orders" }, { key: "stock", href: "/parts" }, doc("stockIn", "IB"), doc("stockOut", "OB")] },
  { key: "fin", items: [{ key: "ledger", href: "/finance" }, doc("paymentVouchers", "PV"), doc("statements", "BL"), soon("finReports"), soon("expenses")] },
  { key: "to", items: [doc("proforma", "PF"), { key: "billing", href: "/tax?doc=iv" }, { key: "taxInvoices", href: "/tax?doc=ti" }, { key: "receipts", href: "/tax?doc=rc" }] },
  { key: "opd", items: [{ key: "talent", href: "/people" }, { key: "overtime", href: "/people/overtime" }, { ...soon("payroll"), mdOnly: true }, soon("training")] },
  { key: "admin", items: [soon("permissions"), soon("dictionary"), { key: "entities", href: "/admin" }] },
];

/** Is `href` (path + optional query) the current page? A child with a query wins over its sibling without one. */
export function navMatch(href: string, path: string, query: URLSearchParams): number {
  const [p, q] = href.split("?");
  if (!(path === p || path.startsWith(`${p}/`))) return 0;
  if (!q) return p.length;
  for (const [k, v] of new URLSearchParams(q)) if (query.get(k) !== v) return 0;
  return p.length + 1000;
}

/** 常用功能 — entries a person can pin. Label: messages "shortcut" namespace. */
export const SHORTCUTS: { key: string; href: string; group: string }[] = [
  { key: "newAsset", href: "/assets/new", group: "alm" },
  { key: "newSeries", href: "/series/new", group: "alm" },
  { key: "newFaultCode", href: "/fault-codes/new", group: "alm" },
  { key: "newCustomer", href: "/customers/new", group: "crm" },
  { key: "newOrder", href: "/service-orders/new", group: "crm" },
  { key: "newRepair", href: "/service-orders/new?mode=REPAIR", group: "crm" },
  { key: "newTrade", href: "/service-orders/new?mode=DOMESTIC_TRADE", group: "crm" },
  { key: "newExport", href: "/service-orders/new?mode=INTERNATIONAL_TRADE", group: "crm" },
  { key: "newProject", href: "/service-orders/new?mode=AUTOMATION_PROJECT", group: "crm" },
  { key: "quotesWaiting", href: "/service-orders?status=QUOTE_PENDING", group: "crm" },
  { key: "newSupplier", href: "/suppliers/new", group: "scm" },
  { key: "newInquiry", href: "/purchasing/inquiries/new", group: "scm" },
  { key: "newPurchaseOrder", href: "/purchasing/orders/new", group: "scm" },
  { key: "newPart", href: "/parts/new", group: "scm" },
  { key: "stockMovement", href: "/parts/movement", group: "scm" },
  { key: "newInvoice", href: "/service-orders?status=ACCEPTED", group: "to" },
  { key: "payables", href: "/finance/payables", group: "fin" },
  { key: "overtime", href: "/people/overtime", group: "opd" },
  { key: "newReceiving", href: "/documents?type=ER&new=1", group: "lean" },
  { key: "newDelivery", href: "/documents?type=DN&new=1", group: "lean" },
  { key: "allDocuments", href: "/documents", group: "home" },
];

/** What a new person sees before pinning anything. */
export function defaultShortcuts(role: string): string[] {
  if (role === "ENGINEER" || role === "WAREHOUSE") return ["newAsset", "newRepair", "stockMovement", "newFaultCode", "overtime"];
  if (role === "SALES") return ["newCustomer", "newOrder", "quotesWaiting", "newAsset"];
  return ["newCustomer", "newAsset", "newOrder", "newInquiry", "newInvoice", "payables"];
}

export function shortcutsOf(saved: unknown, role: string) {
  const keys = Array.isArray(saved) ? saved.filter((k): k is string => typeof k === "string") : defaultShortcuts(role);
  return keys.map((k) => SHORTCUTS.find((s) => s.key === k)).filter((s): s is (typeof SHORTCUTS)[number] => !!s);
}
