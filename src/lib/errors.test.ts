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

import { openJob } from "./drafts";
describe("errorCode with coded schema messages", () => {
  it("prefers a stable code given as the message", () => expect(errorCode({ issues: [{ path: ["code"], message: "ENTITY_CODE" }] })).toBe("ENTITY_CODE"));
});

describe("openJob (which draft 'save draft' continues)", () => {
  const t = (d: number) => new Date(2026, 10, d);
  const jobs = [
    { no: "RP-old-draft", assetId: "a", kind: "REPAIR", startedAt: t(1), finishedAt: null },
    { no: "RP-done", assetId: "a", kind: "REPAIR", startedAt: t(2), finishedAt: t(3) },
    { no: "RP-rework", assetId: "a", kind: "REPAIR", startedAt: t(4), finishedAt: null },
    { no: "PM-draft", assetId: "a", kind: "MAINTENANCE", startedAt: t(5), finishedAt: null },
  ];
  it("skips a draft abandoned before a finished job", () => expect(openJob(jobs, { maintenance: false, orderStatus: "IN_PROGRESS", assetId: "a" })?.no).toBe("RP-rework"));
  it("keeps repair and maintenance apart", () => expect(openJob(jobs, { maintenance: true, orderStatus: "IN_PROGRESS" })?.no).toBe("PM-draft"));
  it("never reopens once the order went to acceptance", () => expect(openJob(jobs, { maintenance: false, orderStatus: "ACCEPTANCE_PENDING" })).toBeUndefined());
  it("only the given asset", () => expect(openJob(jobs, { maintenance: false, orderStatus: "IN_PROGRESS", assetId: "b" })).toBeUndefined());
});
