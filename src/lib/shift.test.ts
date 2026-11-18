import { describe, expect, it } from "vitest";
import { dayKindOf, overlaps, splitWork } from "./shift";
import { overtimePay } from "./overtime";

const pay = (segs: { kind: "WORKDAY_OT" | "HOLIDAY_WORK" | "HOLIDAY_OT"; hours: number }[]) => overtimePay({ baseSalary: 20000, hours: segs.reduce((h, s) => ({ ...h, [s.kind]: (h[s.kind] ?? 0) + s.hours }), {} as Record<string, number>) });

describe("班次拆分 (v3 P1-35, shift 08:30–17:30, lunch 1 h)", () => {
  it("working day 08:00–20:00 → 0.5 h before + 2.5 h after = 3 h × 1.5 = 375.00", () => {
    const d = splitWork({ dayKind: "WORKDAY", start: "08:00", end: "20:00" });
    expect(d.normal).toBe(8); expect(d.segments.map((s) => [s.kind, s.start, s.end, s.hours])).toEqual([["WORKDAY_OT", "08:00", "08:30", 0.5], ["WORKDAY_OT", "17:30", "20:00", 2.5]]);
    expect(pay(d.segments).total).toBe(375);
  });
  it("Sunday 08:00–19:00 → 8 h × 1 (666.67) + 2 h × 3 (500.00)", () => {
    const d = splitWork({ dayKind: "REST", start: "08:00", end: "19:00" });
    expect(d.segments.map((s) => [s.kind, s.hours])).toEqual([["HOLIDAY_OT", 0.5], ["HOLIDAY_WORK", 8], ["HOLIDAY_OT", 1.5]]); // inside the shift ×1, before and after ×3
    const p = pay(d.segments); expect(p.amounts.HOLIDAY_WORK).toBe(666.67); expect(p.amounts.HOLIDAY_OT).toBe(500);
  });
  it("Sunday 08:00–20:30 (RPTH26111601) → 8 h × 1 + 3.5 h × 3, never 工作日 ×1.5", () => {
    const d = splitWork({ dayKind: "REST", start: "08:00", end: "20:30" });
    expect(d.segments.map((s) => [s.kind, s.hours])).toEqual([["HOLIDAY_OT", 0.5], ["HOLIDAY_WORK", 8], ["HOLIDAY_OT", 3]]);
  });
  it("H-R69: a Sunday or holiday worked only outside the shift is ×3; inside the shift it is holiday work", () => {
    expect(splitWork({ dayKind: "REST", start: "18:00", end: "20:00" }).segments.map((s) => [s.kind, s.hours])).toEqual([["HOLIDAY_OT", 2]]);
    expect(splitWork({ dayKind: "HOLIDAY", start: "08:30", end: "17:30" }).segments.map((s) => [s.kind, s.hours])).toEqual([["HOLIDAY_WORK", 8]]);
  });
  it("a normal day inside the shift makes no overtime; a recorded rest comes off the overtime only", () => {
    expect(splitWork({ dayKind: "WORKDAY", start: "08:30", end: "17:30" }).segments).toEqual([]);
    const d = splitWork({ dayKind: "WORKDAY", start: "08:30", end: "20:30", otBreakMinutes: 20 });
    expect(d.segments).toEqual([{ kind: "WORKDAY_OT", start: "17:30", end: "20:30", breakMinutes: 20, hours: 2.75 }]);
  });
  it("a short holiday visit is all ×1; past midnight stays with the day", () => {
    expect(splitWork({ dayKind: "HOLIDAY", start: "09:00", end: "12:00" }).segments.map((s) => [s.kind, s.hours])).toEqual([["HOLIDAY_WORK", 3]]);
    expect(splitWork({ dayKind: "WORKDAY", start: "17:30", end: "01:30" }).segments.map((s) => s.hours)).toEqual([8]);
  });
  it("the calendar decides the day", () => {
    expect(dayKindOf("2026-11-08", [])).toBe("REST"); expect(dayKindOf("2026-11-12", [])).toBe("WORKDAY"); expect(dayKindOf("2026-11-12", ["2026-11-12"])).toBe("HOLIDAY");
    expect(dayKindOf("2026-11-14", [], [0, 6])).toBe("REST");
    expect(overlaps("17:30", "19:30", "19:00", "20:00")).toBe(true); expect(overlaps("07:30", "08:30", "17:30", "19:30")).toBe(false);
  });
});
