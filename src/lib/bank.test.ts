import { describe, expect, it } from "vitest";
import { bankCurrencies, bankLines, cleanBankDetails } from "./bank";

const dcit = { bank: "BANK OF CHINA (THAI) PCL", branch: "RAYONG BRANCH", bankCode: "052", branchCode: "0003", accountName: "DUCHENG INDUSTRIAL (THAILAND)CO., LTD.", swift: "BKCHTHBKXXX", accounts: { THB: "100000301445119", USD: "100000301445131", RMB: "100000301445120", EUR: "100000301445142" } };

describe("legal-entity bank details", () => {
  it("cleans the form: RMB → CNY, SWIFT upper-case, empty → null", () => {
    const b = cleanBankDetails({ ...dcit, swift: " bkchthbkxxx ", accounts: { ...dcit.accounts, JPY: "  " } })!;
    expect(b.swift).toBe("BKCHTHBKXXX");
    expect(b.accounts).toEqual({ THB: "100000301445119", USD: "100000301445131", CNY: "100000301445120", EUR: "100000301445142" });
    expect(cleanBankDetails({ bank: " ", accounts: { THB: "" } })).toBeNull();
  });
  it("keeps leading zeros and rejects nonsense", () => {
    expect(cleanBankDetails({ bank: "KBANK", accounts: { THB: "012-3-45678-9" } })!.accounts!.THB).toBe("012-3-45678-9");
    expect(() => cleanBankDetails({ bank: "X", swift: "BKCH" })).toThrow(/BAD_SWIFT/);
    expect(() => cleanBankDetails({ bank: "X", accounts: { THB: "12/34" } })).toThrow(/BAD_ACCOUNT:THB/);
    expect(() => cleanBankDetails({ accounts: { THB: "123" } })).toThrow(/BANK_ACCOUNT_NO_BANK/);
  });
  it("prints the invoice currency and THB; an old RMB key matches a CNY invoice", () => {
    expect(bankLines(dcit, "CNY")).toBe("BANK OF CHINA (THAI) PCL, RAYONG BRANCH (052-0003)\nTHB 100000301445119\nCNY 100000301445120\nAccount name: DUCHENG INDUSTRIAL (THAILAND)CO., LTD.\nSWIFT BKCHTHBKXXX");
    expect(bankLines(dcit, "THB").split("\n")).toHaveLength(4);
    expect(bankLines(null, "THB")).toBe("");
  });
  it("offers the entity's currency first", () => {
    expect(bankCurrencies("VND", null)).toEqual(["VND", "THB", "USD", "CNY", "EUR"]);
    expect(bankCurrencies("THB", { accounts: { RMB: "1", JPY: "2" } })).toEqual(["THB", "USD", "CNY", "EUR", "JPY"]);
  });
});
