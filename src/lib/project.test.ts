import { describe, expect, it } from "vitest";
import { PHASE_NAME, allInvoiced, checkPaySplit, defaultMilestones, invoiceDue, milestoneAmount, milestoneBlockers, nextMilestone, paymentScheduleLines } from "./project";

const ms = defaultMilestones().map((m) => ({ ...m, doneAt: null as Date | null, taxInvoiceNo: null as string | null }));

describe("automation project milestones", () => {
  it("nine milestones, 30 / 60 / 10 by default, the split must add up to 100 %", () => {
    expect(ms.map((m) => m.phase)).toEqual(["CONTRACT", "DESIGN", "PROCUREMENT", "BUILD", "FAT", "DELIVERY", "COMMISSIONING", "SAT", "HANDOVER"]);
    expect(() => checkPaySplit(ms)).not.toThrow();
    expect(() => checkPaySplit([{ payPct: 0.3 }, { payPct: 0.6 }])).toThrow("PAY_SPLIT:90");
    expect(() => checkPaySplit([{ payPct: 1.2 }, { payPct: -0.2 }])).toThrow("PAY_SPLIT:range");
  });
  it("milestones run in order; FAT and SAT need a test record; delivery needs a signed DNTH", () => {
    const ctx = { files: 0, signedDeliveries: 0, orderStatus: "IN_PROGRESS" };
    expect(nextMilestone(ms)?.phase).toBe("CONTRACT");
    expect(milestoneBlockers(ms[1], ms, ctx)).toEqual(["EARLIER_OPEN"]);
    const upToBuild = ms.map((m) => (m.seq <= 4 ? { ...m, doneAt: new Date() } : m));
    expect(milestoneBlockers(upToBuild[4], upToBuild, ctx)).toEqual(["TEST_RECORD_REQUIRED"]);
    expect(milestoneBlockers(upToBuild[4], upToBuild, { ...ctx, files: 1 })).toEqual([]);
    const upToFat = upToBuild.map((m) => (m.seq <= 5 ? { ...m, doneAt: new Date() } : m));
    expect(milestoneBlockers(upToFat[5], upToFat, ctx)).toEqual(["DELIVERY_NOT_SIGNED"]);
    expect(milestoneBlockers(ms[0], ms, { ...ctx, orderStatus: "QUOTE_PENDING" })).toEqual(["NO_CUSTOMER_PO"]);
  });
  it("instalments add up to the contract to the satang; the last one takes the remainder", () => {
    const sub = 1_000_000.01;
    const a = ms.filter((m) => m.payPct).map((m) => milestoneAmount(m, ms, sub));
    expect(a).toEqual([300000, 600000.01, 100000]);
    expect(Math.round(a.reduce((s, x) => s + x, 0) * 100) / 100).toBe(sub);
    expect(milestoneAmount(ms[1], ms, sub)).toBe(0);
  });
  it("knows which done milestones still need their invoice", () => {
    const done = ms.map((m) => (m.phase === "CONTRACT" ? { ...m, doneAt: new Date() } : m));
    expect(invoiceDue(done).map((m) => m.phase)).toEqual(["CONTRACT"]);
    expect(allInvoiced(done)).toBe(false);
    expect(paymentScheduleLines(ms, PHASE_NAME).split("\n")[0]).toBe("30%  on contract / PO  เมื่อทำสัญญา");
  });
});
