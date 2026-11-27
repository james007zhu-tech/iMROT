import { describe, expect, it } from "vitest";
import { MODES, kindFor, marginFloorFor, modeFromKind, modeNeedsAsset, reopenBlocker, isConsultingMode, isItemMode, isTradeMode, quoteJustCancels } from "./modes";
import { CHAINS } from "./doc-chain";
import { nextSteps } from "./order-steps";
import { marginApprovalFor } from "./margin";

describe("business modes (2026-11-09)", () => {
  it("floors as decided, MD overrides win", () => {
    expect(MODES.map((m) => marginFloorFor(m))).toEqual([0.5, 0.33, 0.5, 0.2, 0.2, 0.1, 0.5]);
    expect(marginFloorFor("DOMESTIC_TRADE", { DOMESTIC_TRADE: 0.25 })).toBe(0.25);
    expect(marginApprovalFor(0.33, marginFloorFor("PARTNER_REPAIR"))).toBe("NOT_NEEDED");
    expect(marginApprovalFor(0.32, marginFloorFor("PARTNER_REPAIR"))).toBe("PENDING");
    expect(marginApprovalFor(0.35, marginFloorFor("REPAIR"))).toBe("PENDING");
    expect(marginApprovalFor(0.1, marginFloorFor("INTERNATIONAL_TRADE"))).toBe("NOT_NEEDED");
  });
  it("only 维保 has sub-types; other modes force theirs", () => {
    expect(kindFor("MAINTENANCE", "OVERHAUL")).toBe("OVERHAUL");
    expect(kindFor("MAINTENANCE")).toBe("MAINTENANCE");
    expect(kindFor("REPAIR", "CONTRACT")).toBe("REPAIR");
    expect(kindFor("DOMESTIC_TRADE")).toBe("PARTS_SALE");
  });
  it("trade carries SKUs only", () => {
    expect(modeNeedsAsset("DOMESTIC_TRADE")).toBe(false);
    expect(modeNeedsAsset("INTERNATIONAL_TRADE")).toBe(false);
    expect(modeNeedsAsset("PARTNER_REPAIR")).toBe(true);
  });
  it("old orders map from their kind", () => {
    expect(["REPAIR", "MAINTENANCE", "OVERHAUL", "CONTRACT", "PARTS_SALE"].map(modeFromKind)).toEqual(["REPAIR", "MAINTENANCE", "MAINTENANCE", "MAINTENANCE", "DOMESTIC_TRADE"]);
  });
  it("转合作维修 only from a repair order before the quote went out", () => {
    const base = { mode: "REPAIR", status: "DIAGNOSING", lockedAt: null, quoteSentAt: null };
    expect(reopenBlocker(base)).toBeNull();
    expect(reopenBlocker({ ...base, mode: "MAINTENANCE" })).toBe("NOT_REPAIR_ORDER");
    expect(reopenBlocker({ ...base, quoteSentAt: new Date() })).toBe("QUOTE_ALREADY_SENT");
    expect(reopenBlocker({ ...base, status: "IN_PROGRESS" })).toBe("TRANSFER_TOO_LATE");
    expect(reopenBlocker({ ...base, transferredTo: { id: "x" } })).toBe("ALREADY_TRANSFERRED");
  });
  it("服务咨询: no machine, no goods, 50 % floor, a turned-down quote is simply cancelled", () => {
    expect(MODES).toContain("SERVICE_CONSULTING");
    expect(modeNeedsAsset("SERVICE_CONSULTING")).toBe(false);
    expect(marginFloorFor("SERVICE_CONSULTING")).toBe(0.5);
    expect(isConsultingMode("SERVICE_CONSULTING") && isItemMode("SERVICE_CONSULTING") && !isTradeMode("SERVICE_CONSULTING")).toBe(true);
    expect(quoteJustCancels("SERVICE_CONSULTING")).toBe(true);
    expect(CHAINS.SERVICE_CONSULTING.map((x) => x.key)).toEqual(["QT", "CPO", "AC", "TI", "IV", "RC"]);
    const sh = { kind: "REPAIR", hasInspection: false, hasQuote: true, hasJob: false, jobFinished: false, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false, consulting: true };
    expect(nextSteps({ ...sh, status: "QUOTE_PENDING" }).primary).toBe("confirm");
    expect(nextSteps({ ...sh, status: "IN_PROGRESS" })).toEqual({ primary: "accept", also: [] });
    expect(nextSteps({ ...sh, status: "ACCEPTED" }).primary).toBe("invoice");
  });
});
