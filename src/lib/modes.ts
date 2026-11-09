/**
 * 业务模式 (朱总 2026-11-09). The mode is picked first when an order is created and never changes; it decides the
 * documents, the margin floor and the inquiry/quote route. Pure — src/server/modes.ts reads the MD's floors.
 */
export const MODES = ["REPAIR", "PARTNER_REPAIR", "MAINTENANCE", "AUTOMATION_PROJECT", "DOMESTIC_TRADE", "INTERNATIONAL_TRADE"] as const;
export type Mode = (typeof MODES)[number];
export type Kind = "REPAIR" | "MAINTENANCE" | "OVERHAUL" | "CONTRACT" | "PARTS_SALE";

/** Floors decided 2026-11-09; the MD can change them on /admin (ModeRule). A quote below its floor needs the MD. */
export const DEFAULT_MARGIN_FLOOR: Record<Mode, number> = {
  REPAIR: 0.5, PARTNER_REPAIR: 0.33, MAINTENANCE: 0.5, AUTOMATION_PROJECT: 0.2, DOMESTIC_TRADE: 0.2, INTERNATIONAL_TRADE: 0.1,
};

/** Sub-types a mode allows; the first is the default. 维保 is the only mode with a choice. */
export const MODE_KINDS: Record<Mode, Kind[]> = {
  REPAIR: ["REPAIR"], PARTNER_REPAIR: ["REPAIR"], MAINTENANCE: ["MAINTENANCE", "OVERHAUL", "CONTRACT"],
  AUTOMATION_PROJECT: ["REPAIR"], DOMESTIC_TRADE: ["PARTS_SALE"], INTERNATIONAL_TRADE: ["PARTS_SALE"],
};

/** Modes that can be opened today. Automation projects and international trade wait for their flow (decision doc 2026-11-09). */
export const OPEN_MODES: readonly Mode[] = ["REPAIR", "PARTNER_REPAIR", "MAINTENANCE"];

/** Trade orders carry SKUs only — no ATH (decided 2026-11-09; the one exception to "every record carries an asset"). */
export const modeNeedsAsset = (m: Mode): boolean => m !== "DOMESTIC_TRADE" && m !== "INTERNATIONAL_TRADE";
export const isPartnerMode = (m: string | null | undefined): boolean => m === "PARTNER_REPAIR";

/** The sub-type an order gets: the asked one when the mode allows it, else the mode's default. */
export function kindFor(mode: Mode, asked?: string | null): Kind {
  const allowed = MODE_KINDS[mode];
  return allowed.includes(asked as Kind) ? (asked as Kind) : allowed[0];
}

/** Orders created before modes existed: their kind says which mode they belong to. */
export function modeFromKind(kind: string): Mode {
  if (kind === "MAINTENANCE" || kind === "OVERHAUL" || kind === "CONTRACT") return "MAINTENANCE";
  if (kind === "PARTS_SALE") return "DOMESTIC_TRADE";
  return "REPAIR";
}

/** The MD's floor when one is set, the decided default otherwise. */
export function marginFloorFor(mode: string | null | undefined, rules?: Partial<Record<Mode, number>>): number {
  const m = (MODES as readonly string[]).includes(mode ?? "") ? (mode as Mode) : "REPAIR";
  return rules?.[m] ?? DEFAULT_MARGIN_FLOOR[m];
}

/** 转合作维修: only a REPAIR order, before a quote went out and before the acceptance lock. */
export const REOPEN_STATUSES = ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING"] as const;
export function reopenBlocker(o: { mode: string; status: string; lockedAt: Date | null; quoteSentAt: Date | null; transferredTo?: unknown }): string | null {
  if (o.mode !== "REPAIR") return "NOT_REPAIR_ORDER";
  if (o.transferredTo) return "ALREADY_TRANSFERRED";
  if (o.lockedAt) return "ORDER_LOCKED";
  if (o.quoteSentAt) return "QUOTE_ALREADY_SENT";
  if (!(REOPEN_STATUSES as readonly string[]).includes(o.status)) return "TRANSFER_TOO_LATE";
  return null;
}
