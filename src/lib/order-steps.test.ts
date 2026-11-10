import { describe, expect, it } from "vitest";
import { nextSteps, reportsFor } from "./order-steps";

const base = { kind: "REPAIR", hasInspection: true, hasQuote: true, hasJob: true, jobFinished: true, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false };

describe("next step", () => {
  it("repair vs maintenance are separate forms", () => {
    expect(nextSteps({ ...base, status: "IN_PROGRESS" }).primary).toBe("repair");
    expect(nextSteps({ ...base, kind: "MAINTENANCE", status: "IN_PROGRESS" }).primary).toBe("maintain");
  });
  it("workshop jobs deliver (DNTH) before acceptance", () => {
    expect(nextSteps({ ...base, status: "ACCEPTANCE_PENDING", workshop: true }).primary).toBe("deliver");
    expect(nextSteps({ ...base, status: "ACCEPTANCE_PENDING", workshop: true, deliveriesSigned: 1 }).primary).toBe("accept");
    expect(nextSteps({ ...base, status: "ACCEPTANCE_PENDING" }).primary).toBe("accept");
  });
  it("contract maintenance goes straight to the PMTH form", () => {
    expect(nextSteps({ ...base, kind: "CONTRACT", status: "ASSIGNED" }).primary).toBe("maintain");
  });
  it("quote waits for the customer PO", () => {
    expect(nextSteps({ ...base, status: "QUOTE_PENDING" }).primary).toBe("confirm");
  });
  it("reports carry names, not template numbers", () => {
    expect(reportsFor({ type: "QT", templateCode: null }, true).map((r) => r.key)).toEqual(["rpt04", "rpt06", "rpt12", "rpt13"]);
    expect(reportsFor({ type: "RP", templateCode: "10" }, false)[0].key).toBe("rpt10");
    expect(reportsFor({ type: "QT", templateCode: "30" }, false).map((r) => r.key)).toEqual(["rpt30", "rpt31"]); // 贸易
    expect(reportsFor({ type: "DN", templateCode: "19" }, false)[0].key).toBe("rpt19");
  });
  it("trade orders: quote, PO, stock out, delivery — no inspection, no acceptance step", () => {
    const t = { kind: "PARTS_SALE", hasInspection: false, hasQuote: false, hasJob: false, jobFinished: false, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false, trade: true };
    expect(nextSteps({ ...t, status: "RECEIVED" }).primary).toBe("quote");
    expect(nextSteps({ ...t, status: "QUOTE_PENDING" }).primary).toBe("confirm");
    expect(nextSteps({ ...t, status: "IN_PROGRESS", stockOuts: 0 }).primary).toBe("stockOut");
    expect(nextSteps({ ...t, status: "IN_PROGRESS", stockOuts: 2 }).primary).toBe("deliver");
    expect(nextSteps({ ...t, status: "ACCEPTED" }).primary).toBe("invoice");
  });
  it("international trade: stock out, then the shipment (CI + PL), then payment — no DNTH signature, no TITH", () => {
    const t = { kind: "PARTS_SALE", hasInspection: false, hasQuote: true, hasJob: false, jobFinished: false, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false, trade: true, intl: true };
    expect(nextSteps({ ...t, status: "IN_PROGRESS", stockOuts: 0 }).primary).toBe("stockOut");
    expect(nextSteps({ ...t, status: "IN_PROGRESS", stockOuts: 2 }).primary).toBe("ship");
    expect(nextSteps({ ...t, status: "IN_PROGRESS", stockOuts: 2, deliveriesOpen: 1, invoicesUnpaid: 1 })).toEqual({ primary: "ship", also: ["payment", "stockOut"] });
    expect(nextSteps({ ...t, status: "INVOICED", invoicesUnpaid: 1 }).primary).toBe("payment");
    expect(reportsFor({ type: "IV", templateCode: "33" }, false)[0].key).toBe("rpt33");
    expect(reportsFor({ type: "DN", templateCode: "34" }, false)[0].key).toBe("rpt34");
  });
  it("automation project: plan, quote, PO, then the project page; paying milestones before payment", () => {
    const p = { kind: "REPAIR", hasInspection: false, hasQuote: false, hasJob: false, jobFinished: false, workshop: false, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false };
    expect(nextSteps({ ...p, status: "RECEIVED", project: { planned: false, invoiceDue: 0 } }).primary).toBe("plan");
    expect(nextSteps({ ...p, status: "DIAGNOSING", project: { planned: true, invoiceDue: 0 } }).primary).toBe("quote");
    expect(nextSteps({ ...p, status: "IN_PROGRESS", project: { planned: true, invoiceDue: 1 } }).primary).toBe("project");
    expect(nextSteps({ ...p, status: "ACCEPTED", project: { planned: true, invoiceDue: 1 } }).primary).toBe("project");
    expect(nextSteps({ ...p, status: "INVOICED", invoicesUnpaid: 2, project: { planned: true, invoiceDue: 0 } }).primary).toBe("payment");
  });
});
