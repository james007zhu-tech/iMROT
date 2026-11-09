import { describe, expect, it } from "vitest";
import { capHours, hourlyWage, localToday, monthKeyOf, monthRange, overtimeHours, overtimePay, weekRange } from "./overtime";

describe("overtime rules (Thai LPA s.61–63)", () => {
  it("counts hours, past midnight and minus a break", () => {
    expect(overtimeHours("18:00", "21:30")).toBe(3.5);
    expect(overtimeHours("22:00", "02:00")).toBe(4);
    expect(overtimeHours("08:00", "17:00", 60)).toBe(8);
    expect(overtimeHours("18:00", "18:20")).toBe(0.25); // quarter hours
    expect(() => overtimeHours("18:00", "18:30", 30)).toThrow(/OT_NO_HOURS/);
    expect(() => overtimeHours("25:00", "26:00")).toThrow(/BAD_TIME/);
  });
  it("hourly wage of a monthly employee is salary ÷ 30 ÷ 8", () => {
    expect(hourlyWage(12000)).toBe(50);
    expect(hourlyWage(25000)).toBe(104.17);
  });
  it("pays 1.5× workday OT, 1× holiday work, 3× holiday OT", () => {
    const p = overtimePay({ baseSalary: 12000, hours: { WORKDAY_OT: 10, HOLIDAY_WORK: 8, HOLIDAY_OT: 2 } });
    expect(p.amounts).toEqual({ WORKDAY_OT: 750, HOLIDAY_WORK: 400, HOLIDAY_OT: 300 });
    expect(p.total).toBe(1450);
    expect(p.totalHours).toBe(20);
  });
  it("holiday work in normal hours does not count against the 36-hour cap", () => {
    expect(capHours("HOLIDAY_WORK", 8)).toBe(0);
    expect(capHours("WORKDAY_OT", 3)).toBe(3);
    expect(capHours("HOLIDAY_OT", 2)).toBe(2);
  });
  it("months and weeks", () => {
    expect(monthKeyOf(new Date("2026-11-30T00:00:00Z"))).toBe("2026-11");
    expect(monthRange("2026-12").to.toISOString().slice(0, 10)).toBe("2027-01-01");
    const w = weekRange(new Date("2026-11-08T00:00:00Z")); // a Sunday
    expect(w.from.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(w.to.toISOString().slice(0, 10)).toBe("2026-11-09");
  });
  it("judges month end on Bangkok time", () => {
    expect(localToday(new Date("2026-11-30T17:30:00Z"))).toEqual({ date: "2026-12-01", month: "2026-12", previousMonth: "2026-11" });
    expect(localToday(new Date("2027-01-01T03:00:00Z")).previousMonth).toBe("2026-12");
  });
});
