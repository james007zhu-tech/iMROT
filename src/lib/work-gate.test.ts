import { describe, expect, it } from "vitest";
import { finishGap, workGap } from "./work-gate";

describe("workGap", () => {
  const r = (status: string, kind = "REPAIR") => ({ status, kind });
  it("blocks a repair until the customer's PO", () => {
    expect(workGap(r("RECEIVED"), { maintenance: false })).toBe("inspect");
    expect(workGap(r("DIAGNOSING"), { maintenance: false })).toBe("quote");
    expect(workGap(r("QUOTE_PENDING"), { maintenance: false })).toBe("confirm");
    expect(workGap(r("IN_PROGRESS"), { maintenance: false })).toBeNull();
    expect(workGap(r("ACCEPTED"), { maintenance: false })).toBe("over");
  });
  it("lets in-contract maintenance start without a quote, paid maintenance not", () => {
    expect(workGap(r("ASSIGNED", "CONTRACT"), { maintenance: true })).toBeNull();
    expect(workGap(r("ASSIGNED", "MAINTENANCE"), { maintenance: true })).toBe("quote");
    expect(workGap(r("ASSIGNED", "CONTRACT"), { maintenance: false })).toBe("inspect");
  });
  it("lets a rejected acceptance be reworked", () => expect(workGap(r("DIAGNOSING"), { maintenance: false, rework: true })).toBeNull());
});

describe("finishGap", () => {
  it("needs one run test with a result that passed", () => {
    expect(finishGap([])).toBe("NEEDS_TEST");
    expect(finishGap([{ key: "visual", result: "clean", pass: true }])).toBe("NEEDS_TEST");
    expect(finishGap([{ key: "noLoad", result: "", pass: true }])).toBe("NEEDS_TEST");
    expect(finishGap([{ key: "noLoad", result: "50 Hz 3.1 A", pass: true }])).toBeNull();
  });
  it("refuses while any test failed", () => expect(finishGap([{ key: "noLoad", result: "ok", pass: true }, { key: "load", result: "trip OC", pass: false }])).toBe("FAILED"));
});
