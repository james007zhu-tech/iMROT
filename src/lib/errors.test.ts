import { describe, expect, it } from "vitest";
import { errorCode } from "./errors";
import { shortDate } from "./dates";
import { nextSteps } from "./order-steps";

describe("errorCode", () => {
  it("keeps stable codes", () => expect(errorCode(new Error("SERIAL_EXISTS:X:ATH1:")).toString()).toBe("SERIAL_EXISTS:X:ATH1:"));
  it("turns zod issues into field names", () => expect(errorCode({ issues: [{ path: ["plants"], message: "at least one plant" }, { path: ["contacts", 0, "email"], message: "bad" }] })).toBe("INVALID_INPUT:plants, contacts.email"));
  it("turns a unique violation into DUPLICATE", () => expect(errorCode({ code: "P2002", meta: { target: ["sku"] }, message: "Invalid `prisma.part.create()` invocation" })).toBe("DUPLICATE:sku"));
  it("hides raw prisma text", () => expect(errorCode(new Error("\nInvalid `prisma.part.create()` invocation:\n…"))).toBe("SAVE_FAILED"));
});

describe("shortDate", () => {
  const now = new Date(2026, 10, 7);
  it("drops the year within the year", () => expect(shortDate(new Date(2026, 10, 3), now)).toBe("11-03"));
  it("keeps the year across years", () => expect(shortDate(new Date(2025, 11, 30), now)).toBe("2025-12-30"));
});

describe("next steps after the 2026-11-05 trial", () => {
  const base = { hasInspection: false, hasQuote: false, hasJob: false, jobFinished: false, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false };
  it("paid maintenance is quoted, not inspected", () => expect(nextSteps({ ...base, status: "ASSIGNED", kind: "MAINTENANCE" }).primary).toBe("quote"));
  it("an undispatched repair can still be inspected or quoted", () => expect(nextSteps({ ...base, status: "RECEIVED", kind: "REPAIR" }).also).toEqual(["inspect", "quote"]));
});
