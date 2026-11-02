import { describe, expect, it } from "vitest";
import { ASSET_STATUSES, ASSET_TRANSITIONS, canTransitionAsset, canTransitionOrder, portalStep } from "./lifecycle";

describe("asset lifecycle", () => {
  it("only ACCEPTANCE leads back to IN_SERVICE", () => {
    for (const s of ASSET_STATUSES) {
      if (s === "ACCEPTANCE" || s === "ONBOARDED") continue;
      expect(canTransitionAsset(s, "IN_SERVICE")).toBe(false);
    }
    expect(canTransitionAsset("ACCEPTANCE", "IN_SERVICE")).toBe(true);
  });
  it("work states must go through acceptance", () => {
    for (const s of ["MAINTENANCE", "REPAIR", "OVERHAUL"] as const) expect(ASSET_TRANSITIONS[s]).toEqual(["ACCEPTANCE"]);
  });
  it("retired is terminal", () => expect(ASSET_TRANSITIONS.RETIRED).toEqual([]));
});

describe("order lifecycle", () => {
  it("rejected acceptance goes back to diagnosis", () => expect(canTransitionOrder("ACCEPTANCE_PENDING", "DIAGNOSING")).toBe(true));
  it("cannot invoice before acceptance", () => expect(canTransitionOrder("IN_PROGRESS", "INVOICED")).toBe(false));
  it("portal shows nine steps", () => {
    expect(portalStep("RECEIVED")).toBe(0);
    expect(portalStep("CLOSED")).toBe(8);
    expect(portalStep("CANCELLED")).toBe(-1);
  });
});
