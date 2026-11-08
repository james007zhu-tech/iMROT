import { describe, expect, it } from "vitest";
import { englishAmount, englishInteger, thaiBaht, thaiInteger } from "./amount-words";

describe("Thai baht in words", () => {
  it("handles the special digits เอ็ด / ยี่สิบ / สิบ", () => {
    expect(thaiInteger(11)).toBe("สิบเอ็ด");
    expect(thaiInteger(21)).toBe("ยี่สิบเอ็ด");
    expect(thaiInteger(10)).toBe("สิบ");
    expect(thaiInteger(1)).toBe("หนึ่ง");
    expect(thaiInteger(101)).toBe("หนึ่งร้อยเอ็ด");
    expect(thaiInteger(120)).toBe("หนึ่งร้อยยี่สิบ");
  });
  it("matches the mockup totals", () => {
    expect(thaiBaht(32100)).toBe("สามหมื่นสองพันหนึ่งร้อยบาทถ้วน");
    expect(thaiBaht(31200)).toBe("สามหมื่นหนึ่งพันสองร้อยบาทถ้วน");
    expect(thaiBaht(12465.5)).toBe("หนึ่งหมื่นสองพันสี่ร้อยหกสิบห้าบาทห้าสิบสตางค์");
  });
  it("handles millions and zero", () => {
    expect(thaiInteger(1_000_000)).toBe("หนึ่งล้าน");
    expect(thaiInteger(2_500_000)).toBe("สองล้านห้าแสน");
    expect(thaiInteger(1_000_001)).toBe("หนึ่งล้านเอ็ด");
    expect(thaiBaht(0)).toBe("ศูนย์บาทถ้วน");
    expect(thaiBaht(0.25)).toBe("ยี่สิบห้าสตางค์");
  });
});

describe("English amount in words", () => {
  it("matches the mockup totals", () => {
    expect(englishAmount(32100)).toBe("Thirty-two thousand one hundred baht only");
    expect(englishAmount(31200)).toBe("Thirty-one thousand two hundred baht only");
    expect(englishAmount(12465.5)).toBe("Twelve thousand four hundred sixty-five baht and fifty satang only");
  });
  it("handles large numbers and other currencies", () => {
    expect(englishInteger(1_234_567)).toBe("one million two hundred thirty-four thousand five hundred sixty-seven");
    expect(englishAmount(1500.05, "USD")).toBe("One thousand five hundred US dollars and five cents only");
    expect(englishAmount(0)).toBe("Zero baht only");
  });
});
