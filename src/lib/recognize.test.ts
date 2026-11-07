import { describe, expect, it } from "vitest";
import { normalizeDate, normalizeFields, normalizeLines, normalizeNumber, recognizeText, RECOGNIZE, uncertainFields } from "./recognize";

describe("recognize normalisation", () => {
  it("dates in Thai, Chinese and English forms → YYYY-MM-DD", () => {
    expect(normalizeDate("07/11/2026")).toBe("2026-11-07");
    expect(normalizeDate("2026年11月7日")).toBe("2026-11-07");
    expect(normalizeDate("7 Nov 2026")).toBe("2026-11-07");
    expect(normalizeDate("Nov 7, 2026")).toBe("2026-11-07");
    expect(normalizeDate("07/11/2569")).toBe("2026-11-07"); // Buddhist year
    expect(normalizeDate("7 พ.ย. 2569")).toBe("2026-11-07");
    expect(normalizeDate("2026-11-07")).toBe("2026-11-07");
    expect(normalizeDate("next week")).toBe("next week"); // untouched
  });
  it("numbers lose separators and currency, VAT rate becomes a decimal", () => {
    expect(normalizeNumber("9,383.90 THB")).toBe("9383.9");
    expect(normalizeNumber("฿ 8,770")).toBe("8770");
    expect(normalizeNumber("7%", "vatRate")).toBe("0.07");
    expect(normalizeNumber("7", "vatRate")).toBe("0.07");
    expect(normalizeNumber("0.07", "vatRate")).toBe("0.07");
  });
  it("enums and ids are cleaned", () => {
    expect(normalizeFields({ productionImpact: "stopped — line down", taxId: "0 1055 55555 55 5", reportedAlarm: "f30001", currency: "rmb" })).toEqual({ productionImpact: "STOPPED", taxId: "0105555555555", reportedAlarm: "F30001", currency: "CNY" });
  });
  it("lines keep only known columns and drop empty rows", () => {
    const lines = normalizeLines(RECOGNIZE.purchase, [{ vendorPartNo: "QY82P", description: "Output module", qty: "1", unitPrice: "8,770.00", junk: "x" }, {}, null]);
    expect(lines).toEqual([{ vendorPartNo: "QY82P", description: "Output module", qty: "1", unitPrice: "8770" }]);
  });
});

describe("uncertain fields", () => {
  it("flags low confidence and codes absent from the document text", () => {
    const fields = { serialNumber: "XAB123456", customerRef: "PO-2026-0042", reportedSymptom: "trips on start" };
    const text = "Purchase order PO-2026-0042 for drive S/N XAB-123456, trips on start";
    expect(uncertainFields(fields, { reportedSymptom: 0.5 }, text).sort()).toEqual(["reportedSymptom"]);
    expect(uncertainFields({ serialNumber: "ZZZ999" }, undefined, text)).toEqual(["serialNumber"]);
    expect(uncertainFields({ serialNumber: "ZZZ999" }, undefined, undefined)).toEqual([]); // no text to check against
  });
});

describe("offline fallback", () => {
  it("reads a Mitsubishi quote number and a PO number from pasted text", () => {
    expect(recognizeText("purchase", "MITSUBISHI ELECTRIC FACTORY AUTOMATION\nQuotation No. FA26101674\nQY82P x1 8,770.00").fields.quoteNo).toBe("FA26101674");
    expect(recognizeText("service", "PO No: XCGDD2610140001\nDrive trips F30001 on start, S/N XAB123456").fields).toMatchObject({ customerRef: "XCGDD2610140001", reportedAlarm: "F30001", serialNumber: "XAB123456" });
  });
});
