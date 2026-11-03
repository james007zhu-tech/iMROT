import { describe, expect, it } from "vitest";
import { isClosedStatus, isThaiTaxId, parseDbd } from "./dbd";

describe("DBD lookup parsing", () => {
  it("validates Thai tax ID checksum", () => {
    expect(isThaiTaxId("0205568072149")).toBe(true); // DCiT's own
    expect(isThaiTaxId("0205568072148")).toBe(false);
  });
  it("finds fields at any depth", () => {
    const r = parseDbd({ data: [{ "cd:OrganizationJuristicPerson": { "cd:OrganizationJuristicNameTH": "บริษัท ทดสอบ จำกัด", "cd:OrganizationJuristicNameEN": "TEST CO., LTD.", "cd:OrganizationJuristicRegisterCapital": "5,000,000", "cd:OrganizationJuristicRegisterDate": "20130618", "cd:OrganizationJuristicStatus": "ยังดำเนินกิจการอยู่", "cd:OrganizationJuristicAddress": { "cr:AddressType": { "cd:Address": "99/9", "cd:Road": "ถนนสุขุมวิท", "cd:City": { "cr:CitySubDivisionName": "มาบตาพุด" } } } } }] });
    expect(r.nameTh).toBe("บริษัท ทดสอบ จำกัด");
    expect(r.nameEn).toBe("TEST CO., LTD.");
    expect(r.registeredCapital).toBe(5000000);
    expect(r.addressTh).toContain("ถนนสุขุมวิท");
    expect(isClosedStatus(r.status)).toBe(false);
    expect(isClosedStatus("เลิกกิจการ")).toBe(true);
  });
});
