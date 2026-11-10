import { describe, expect, it } from "vitest";
import { cleanBirthday, daysToBirthday, daysUntil, orderDue, sortNotices } from "./notify";

const today = new Date(2026, 10, 10); // 10 Nov 2026

describe("message centre date rules", () => {
  it("counts calendar days, negative when overdue", () => {
    expect(daysUntil(new Date("2026-11-13T00:00:00Z"), today)).toBe(3);
    expect(daysUntil(new Date("2026-11-08T00:00:00Z"), today)).toBe(-2);
  });
  it("finds the next birthday across the year end and on 29 Feb", () => {
    expect(daysToBirthday("11-15", today)).toBe(5);
    expect(daysToBirthday("11-10", today)).toBe(0);
    expect(daysToBirthday("01-02", today)).toBe(53);
    expect(daysToBirthday("02-29", new Date(2027, 1, 27))).toBe(1);
    expect(daysToBirthday(new Date("1990-11-12T00:00:00Z"), today)).toBe(2);
    expect(daysToBirthday("13-40", today)).toBeNull();
  });
  it("stores birthdays as MM-DD", () => {
    expect(cleanBirthday("3/7")).toBe("03-07");
    expect(cleanBirthday("1988-11-25")).toBe("11-25");
    expect(cleanBirthday(" ")).toBeNull();
    expect(() => cleanBirthday("25 Nov")).toThrow(/BAD_BIRTHDAY/);
  });
  it("takes an order's earliest customer date; late messages come first", () => {
    expect(orderDue({ requestLines: [{ neededBy: "2026-12-15" }, { neededBy: "2026-12-01" }, {}] })?.toISOString().slice(0, 10)).toBe("2026-12-01");
    expect(orderDue({ project: { dueDate: "2027-01-31" } })?.toISOString().slice(0, 10)).toBe("2027-01-31");
    expect(orderDue({})).toBeNull();
    const n = (days: number, kind: string) => ({ id: kind + days, kind, level: "soon" as const, days, ref: "x", href: "/" });
    expect(sortNotices([n(3, "a"), n(-2, "b"), n(0, "c")]).map((x) => x.days)).toEqual([-2, 0, 3]);
  });
});
