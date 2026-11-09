import { describe, expect, it } from "vitest";
import { MODES, kindFor, marginFloorFor, modeFromKind, modeNeedsAsset, reopenBlocker } from "./modes";
import { marginApprovalFor } from "./margin";

describe("business modes (2026-11-09)", () => {
  it("floors as decided, MD overrides win", () => {
    expect(MODES.map((m) => marginFloorFor(m))).toEqual([0.5, 0.33, 0.5, 0.2, 0.2, 0.1]);
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
});
