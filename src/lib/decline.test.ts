import { describe, expect, it } from "vitest";
import { declineBlocker, declineCloseBlockers, declineInputError, feeLineText, feeTotal, undoDeclineBlocker } from "./decline";
import { canTransitionOrder, portalStep } from "./lifecycle";
import { nextSteps } from "./order-steps";

const shape = { status: "DECLINED", feeDue: true, invoiced: false, returnNeeded: true, returnSigned: false, returnIssued: false };
const order = { kind: "REPAIR", hasInspection: true, hasQuote: true, hasJob: false, jobFinished: false, workshop: true, deliveriesSigned: 0, deliveriesOpen: 0, invoicesUnpaid: 0, hasAcceptance: false };

describe("客户拒绝报价 (2026-11-09)", () => {
  it("only machine orders waiting for the customer's answer are declined; trade quotes are cancelled", () => {
    expect(declineBlocker({ mode: "REPAIR", status: "QUOTE_PENDING" })).toBeNull();
    expect(declineBlocker({ mode: "PARTNER_REPAIR", status: "QUOTE_PENDING" })).toBeNull();
    expect(declineBlocker({ mode: "MAINTENANCE", status: "DIAGNOSING" })).toBe("DECLINE_NEEDS_QUOTE_PENDING");
    expect(declineBlocker({ mode: "DOMESTIC_TRADE", status: "QUOTE_PENDING" })).toBe("TRADE_QUOTE_CANCEL");
  });
  it("needs a reason, the customer's reply, and a fee per machine or a waiver reason", () => {
    const ok = { reason: "PRICE", attachments: 1, waived: false, fees: [{ assetCode: "A", amount: 1500 }], assetCodes: ["A"] };
    expect(declineInputError(ok)).toBeNull();
    expect(declineInputError({ ...ok, reason: "" })).toBe("DECLINE_REASON_REQUIRED");
    expect(declineInputError({ ...ok, attachments: 0 })).toBe("DECLINE_REPLY_REQUIRED");
    expect(declineInputError({ ...ok, assetCodes: ["A", "B"] })).toBe("FEE_REQUIRED:B");
    expect(declineInputError({ ...ok, fees: [{ assetCode: "A", amount: 0 }] })).toBe("FEE_REQUIRED:A");
    expect(declineInputError({ ...ok, waived: true, fees: [] })).toBe("FEE_WAIVE_REASON_REQUIRED");
    expect(declineInputError({ ...ok, waived: true, waivedReason: "老客户", fees: [] })).toBeNull();
    expect(feeTotal([{ assetCode: "A", amount: 1500 }, { assetCode: "B", amount: 999.995 }])).toBe(2500);
  });
  it("closes once the machine is back and the fee invoiced or waived", () => {
    expect(declineCloseBlockers(shape)).toEqual(["RETURN_DNTH", "FEE_TITH"]);
    expect(declineCloseBlockers({ ...shape, returnSigned: true, invoiced: true })).toEqual([]);
    expect(declineCloseBlockers({ ...shape, feeDue: false, returnSigned: true })).toEqual([]);
    expect(declineCloseBlockers({ ...shape, returnNeeded: false })).toEqual(["FEE_TITH"]); // inspected on site
  });
  it("undo only before a DNTH or TITH went out", () => {
    expect(undoDeclineBlocker(shape)).toBeNull();
    expect(undoDeclineBlocker({ ...shape, returnIssued: true })).toBe("DECLINE_DOCS_ISSUED");
    expect(undoDeclineBlocker({ ...shape, invoiced: true, status: "INVOICED" })).toBe("NOT_DECLINED");
  });
  it("state machine and progress bar", () => {
    expect(canTransitionOrder("QUOTE_PENDING", "DECLINED")).toBe(true);
    expect(canTransitionOrder("DECLINED", "INVOICED")).toBe(true);
    expect(canTransitionOrder("DECLINED", "IN_PROGRESS")).toBe(false);
    expect(portalStep("DECLINED")).toBe(-1);
  });
  it("next steps: return first, then the fee; decline offered beside the PO", () => {
    expect(nextSteps({ ...order, status: "QUOTE_PENDING" }).also).toContain("decline");
    expect(nextSteps({ ...order, status: "DECLINED", declineOpen: ["RETURN_DNTH", "FEE_TITH"] })).toEqual({ primary: "deliver", also: ["invoice"] });
    expect(nextSteps({ ...order, status: "DECLINED", declineOpen: ["FEE_TITH"] }).primary).toBe("invoice");
    expect(nextSteps({ ...order, status: "DECLINED", declineOpen: [] }).primary).toBeNull();
    expect(nextSteps({ ...order, status: "INVOICED", invoicesUnpaid: 1, declineOpen: ["RETURN_DNTH"] })).toEqual({ primary: "payment", also: ["deliver"] });
  });
  it("the fee line names the machine, Thai first", () => {
    expect(feeLineText({ code: "ATH26110001", brand: "SIEMENS", model: "SINAMICS S120 6SL3120-2TE41-0AA1", serial: "XAN431002347" })).toEqual({
      descriptionLocal: "ค่าตรวจเช็คและวิเคราะห์อาการเสีย — SIEMENS SINAMICS S120 6SL3120-2TE41-0AA1 S/N XAN431002347",
      descriptionEn: "Inspection & diagnosis fee — SIEMENS SINAMICS S120 6SL3120-2TE41-0AA1 S/N XAN431002347",
    });
  });
});
