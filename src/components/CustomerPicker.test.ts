import { describe, expect, it } from "vitest";
import { matchCustomers, normName } from "./CustomerPicker";
import { RECOGNIZE } from "../lib/recognize";

const all = [
  { id: "1", code: "CTH001", name: "Siam Steel Co., Ltd.", nameLocal: "บริษัท สยามสตีล จำกัด" },
  { id: "2", code: "CTH002", name: "Siam Cement PCL", nameLocal: null },
  { id: "3", code: "CVN001", name: "Hanoi Machinery Company Limited", nameLocal: null },
];

describe("customer search on a new order", () => {
  it("ignores company suffixes and punctuation", () => {
    expect(normName("SIAM STEEL CO.,LTD.")).toBe("siam steel");
    expect(normName("บริษัท สยามสตีล จำกัด")).toBe("สยามสตีล");
  });
  it("finds by any part of the code or either name; exact name first", () => {
    expect(matchCustomers("siam", all).map((c) => c.id)).toEqual(["1", "2"]);
    expect(matchCustomers("Siam Cement", all).map((c) => c.id)).toEqual(["2"]);
    expect(matchCustomers("cvn", all).map((c) => c.id)).toEqual(["3"]);
    expect(matchCustomers("HANOI MACHINERY CO., LTD", all).map((c) => c.id)).toEqual(["3"]);
    expect(matchCustomers("สยามสตีล", all).map((c) => c.id)).toEqual(["1"]);
    expect(matchCustomers("unknown gmbh", all)).toEqual([]);
  });
  it("the order upload box reads any document and asks for customer, terms and lines with HS code", () => {
    const s = RECOGNIZE.service;
    expect(s.strict).toBeFalsy();
    expect(RECOGNIZE.customer.strict).toBe(true);
    for (const f of ["customerName", "contactName", "customerRef", "tIncoterm", "tDestPort", "tPaymentTerms"]) expect(Object.keys(s.fields)).toContain(f);
    expect(Object.keys(s.lines!)).toEqual(expect.arrayContaining(["sku", "description", "qty", "hsCode"]));
  });
});
