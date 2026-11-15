import { describe, expect, it } from "vitest";
import { dayIn, lastDay, nextMonth, prevMonth, recursIn, runningBalance, sortLines, totalsOf, type CashLine } from "./cash-plan";

const L = (date: string, dir: "OUT" | "IN", amount: number, extra: Partial<CashLine> = {}): CashLine => ({ date, dir, kind: dir === "OUT" ? "SUPPLIER" : "RECEIVABLE", party: "x", what: "y", amount, currency: "THB", ...extra });

describe("cash plan arithmetic", () => {
  it("knows the months", () => {
    expect(lastDay("2027-02")).toBe(28);
    expect(dayIn("2027-02", 31)).toBe("2027-02-28");
    expect(dayIn("2026-12", 5)).toBe("2026-12-05");
    expect(prevMonth("2027-01")).toBe("2026-12");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
  it("a fixed payment runs from its first month to its last", () => {
    const r = { startMonth: "2026-11", endMonth: "2027-01", active: true };
    expect([recursIn(r, "2026-10"), recursIn(r, "2026-11"), recursIn(r, "2027-01"), recursIn(r, "2027-02")]).toEqual([false, true, true, false]);
    expect(recursIn({ ...r, active: false }, "2026-12")).toBe(false);
    expect(recursIn({ startMonth: "2026-11", active: true }, "2030-01")).toBe(true);
  });
  it("totals leave other currencies out and say so", () => {
    const t = totalsOf([L("2026-12-05", "OUT", 100, { fixed: true }), L("2026-12-07", "OUT", 50, { overdue: true }), L("2026-12-10", "IN", 400), L("2026-12-12", "OUT", 999, { currency: "USD" })]);
    expect(t).toMatchObject({ out: 150, in: 400, net: 250, fixedOut: 100, overdueOut: 50 });
    expect(t.foreign).toEqual([{ currency: "USD", out: 999, in: 0 }]);
  });
  it("orders by day, money out before money in, and carries the balance", () => {
    const lines = sortLines([L("2026-12-10", "IN", 400), L("2026-12-05", "OUT", 100), L("2026-12-10", "OUT", 250)]);
    expect(lines.map((l) => `${l.date} ${l.dir}`)).toEqual(["2026-12-05 OUT", "2026-12-10 OUT", "2026-12-10 IN"]);
    expect(runningBalance(lines, 1000)).toEqual([{ date: "2026-12-05", out: 100, in: 0, balance: 900 }, { date: "2026-12-10", out: 250, in: 400, balance: 1050 }]);
  });
});
