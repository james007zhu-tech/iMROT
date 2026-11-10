/**
 * Menu of DCiT OS (朱总 2026-11-10): nine modules, each with its second level. `soon` entries have no page yet and
 * open /soon/<key>, which says so plainly. Labels: messages "nav" namespace, key = the item key.
 */
export interface NavItem { key: string; href: string; soon?: boolean; mdOnly?: boolean }
export interface NavGroup { key: string; items: NavItem[] }

const soon = (key: string): NavItem => ({ key, href: `/soon/${key}`, soon: true });

export const NAV: NavGroup[] = [
  { key: "home", items: [{ key: "chat", href: "/home" }, { key: "dash", href: "/dashboard" }, { key: "shortcuts", href: "/shortcuts" }] },
  { key: "alm", items: [{ key: "series", href: "/series" }, { key: "assets", href: "/assets" }, { key: "knowledge", href: "/fault-codes" }] },
  { key: "crm", items: [{ key: "customers", href: "/customers" }, { key: "opportunities", href: "/service-orders" }] },
  { key: "lean", items: [{ key: "inspectionReports", href: "/service-reports?kind=inspection" }, { key: "repairReports", href: "/service-reports?kind=repair" }, { key: "maintenanceReports", href: "/service-reports?kind=maintenance" }, { key: "projects", href: "/service-orders?mode=AUTOMATION_PROJECT" }] },
  { key: "scm", items: [{ key: "suppliers", href: "/suppliers" }, { key: "inquiries", href: "/purchasing/inquiries" }, { key: "purchaseOrders", href: "/purchasing/orders" }, { key: "stock", href: "/parts" }, { key: "movements", href: "/parts/movement" }] },
  { key: "fin", items: [{ key: "ledger", href: "/finance" }, soon("finReports"), soon("expenses")] },
  { key: "to", items: [{ key: "billing", href: "/tax?doc=iv" }, { key: "receipts", href: "/tax?doc=rc" }, { key: "taxInvoices", href: "/tax?doc=ti" }] },
  { key: "opd", items: [{ key: "talent", href: "/people" }, soon("training"), { key: "payroll", href: "/people/overtime", mdOnly: true }] },
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
