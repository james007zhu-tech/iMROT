import { describe, expect, it } from "vitest";
import { leaveDays, leaveDeduction, quotaOf, settleLeave } from "./leave";

describe("请假 (v4 V4-P0-12)", () => {
  it("counts working days: Sundays and company holidays are left out, one day may be a half", () => {
    expect(leaveDays("2026-11-13", "2026-11-17", ["2026-11-16"]).map((d) => d.day)).toEqual(["2026-11-13", "2026-11-14", "2026-11-17"]); // Fri, Sat, (Sun), (holiday Mon), Tue
    expect(leaveDays("2026-11-17", "2026-11-17", [], { half: true })).toEqual([{ day: "2026-11-17", part: 0.5 }]);
    expect(leaveDays("2026-11-13", "2026-11-17", [], { calendar: true })).toHaveLength(5);
  });
  it("annual leave starts after a full year of service", () => {
    expect(quotaOf("ANNUAL", 2026, new Date("2026-03-01"))).toBe(0);
    expect(quotaOf("ANNUAL", 2026, new Date("2025-03-01"))).toBe(6);
    expect(quotaOf("SICK", 2026)).toBe(30);
  });
  it("one sick day is paid; one unpaid day costs 20,000 ÷ 30 = 666.67", () => {
    const s = settleLeave([{ type: "SICK", days: [{ day: "2026-11-17", part: 1 }] }, { type: "UNPAID", days: [{ day: "2026-11-18", part: 1 }] }], 2026);
    expect(s.left.SICK).toBe(29); expect(s.unpaidByMonth).toEqual({ "2026-11": 1 });
    expect(leaveDeduction(20000, 1)).toBe(666.67);
  });
  it("business leave beyond 3 days a year is unpaid, in the month it falls", () => {
    const s = settleLeave([{ type: "PERSONAL", days: ["2026-03-02", "2026-03-03", "2026-06-10", "2026-11-05", "2026-11-06"].map((day) => ({ day, part: 1 })) }], 2026);
    expect(s.left.PERSONAL).toBe(0); expect(s.unpaidByMonth).toEqual({ "2026-11": 2 });
  });
});
