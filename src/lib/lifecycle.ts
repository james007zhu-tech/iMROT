/**
 * Pure state machines, shared by server code and tests.
 *  - Asset lifecycle: the only way back to IN_SERVICE is through ACCEPTANCE.
 *  - Service order: the nine words the customer sees, plus CANCELLED.
 */

export const ASSET_STATUSES = ["ONBOARDED", "IN_SERVICE", "MAINTENANCE", "REPAIR", "OVERHAUL", "ACCEPTANCE", "SPARE", "RETIRED"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_TRANSITIONS: Record<AssetStatus, readonly AssetStatus[]> = {
  ONBOARDED: ["IN_SERVICE", "SPARE", "RETIRED"],
  IN_SERVICE: ["MAINTENANCE", "REPAIR", "OVERHAUL", "RETIRED"],
  MAINTENANCE: ["ACCEPTANCE"],
  REPAIR: ["ACCEPTANCE"],
  OVERHAUL: ["ACCEPTANCE"],
  ACCEPTANCE: ["IN_SERVICE", "SPARE", "REPAIR"],
  SPARE: ["ONBOARDED", "REPAIR", "RETIRED"],
  RETIRED: [],
};

export function canTransitionAsset(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

export const ORDER_STATUSES = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS", "ACCEPTANCE_PENDING", "ACCEPTED", "INVOICED", "CLOSED", "CANCELLED"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  RECEIVED: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["DIAGNOSING", "CANCELLED"],
  DIAGNOSING: ["QUOTE_PENDING", "IN_PROGRESS", "CANCELLED"],
  QUOTE_PENDING: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["ACCEPTANCE_PENDING"],
  ACCEPTANCE_PENDING: ["ACCEPTED", "DIAGNOSING"],
  ACCEPTED: ["INVOICED", "CLOSED"],
  INVOICED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/** Which asset status an order step implies, by service kind. */
export function assetStatusForWork(kind: "REPAIR" | "MAINTENANCE" | "OVERHAUL" | "CONTRACT" | "PARTS_SALE"): AssetStatus | null {
  switch (kind) {
    case "REPAIR": return "REPAIR";
    case "MAINTENANCE": return "MAINTENANCE";
    case "CONTRACT": return "MAINTENANCE";
    case "OVERHAUL": return "OVERHAUL";
    default: return null;
  }
}

/** The customer-facing progress bar: index of the status among the nine visible words (CANCELLED → -1). */
export function portalStep(status: OrderStatus): number {
  const visible = ORDER_STATUSES.filter((s) => s !== "CANCELLED");
  return visible.indexOf(status);
}
